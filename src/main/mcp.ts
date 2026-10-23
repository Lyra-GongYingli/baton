import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { AGENT_BY_ID } from '../shared/agents'
import { STATUS_LABEL, type Assignee, type Status, type TaskDetail } from '../shared/types'
import * as db from './db'

// 让 Claude Code 等 AI 工具直接操控 Baton：在本机开一个 MCP 服务（Streamable HTTP）。
// 只监听 127.0.0.1，请求必须带 Authorization: Bearer <密钥>。
// AI 改了数据会走同一个数据库，并通知界面刷新。

export const MCP_PORT = 47821
export const MCP_URL = `http://127.0.0.1:${MCP_PORT}/mcp`

let httpServer: HttpServer | null = null
let state: { running: boolean; error: string | null } = { running: false, error: null }

export function mcpState(): { running: boolean; error: string | null } {
  return state
}

const INSTRUCTIONS = `Baton 是用户的任务接力工具，用来管理同时进行的多件事和给 AI 的提示词。
结构：项目 → 任务 → 子任务（S1、S2…，可以分给 claude / codex / muse / me）→ 子子任务（子任务下面的清单项）。每一层都可以有提示词 prompt。
子任务分两种：接力（chained=true，上一个完成后才轮到它）和独立。
任务、子任务、子子任务共用一套状态，只表达进度：todo 待办 / active 进行中 / paused 已暂停 / done 已完成。谁在做记在 agent 上，和状态无关。
常用流程：
- 先用 list_projects 或 search 找到 id，再用 get_task 看细节。
- 用户让你「记到 Baton / 加个任务 / 拆一下」时，用 create_task、add_subtasks。
- 你开始做某个子任务或子子任务时，用 update_subtask 把 status 设成 active（子任务顺便把 agent 设成你自己）；做完设成 done。
- 子任务都有「哪天做」（scheduled_on，YYYY-MM-DD），新建时不指定就排在今天；用户在 Baton 的月历、任务卡片上看。用 calendar 查某段日子安排了什么，用 update_subtask 改日子。
- 上一层的状态会跟着下一层自动变化（任务跟子任务，子任务跟子子任务），一般不用手动改；把某一层标成 done 会连带下面的全部完成。`

const status = z
  .enum(['todo', 'active', 'paused', 'done'])
  .describe('todo=待办，active=进行中，paused=已暂停，done=已完成（会把下面的全部标成完成）')
const agent = z
  .enum(['claude', 'codex', 'muse', 'me', 'none'])
  .describe('谁来做：claude / codex / muse 是 AI，me 是用户自己，none 是还没分配')

const toAssignee = (a: z.infer<typeof agent>): Assignee => (a === 'none' ? '' : a)
const agentName = (a: Assignee): string => (a ? AGENT_BY_ID[a].name : '未分配')

function taskView(d: TaskDetail) {
  return {
    task_id: d.task.id,
    project_id: d.project.id,
    project: d.project.title,
    title: d.task.title,
    status: `${d.task.status}（${STATUS_LABEL[d.task.status]}）`,
    goal: d.task.goal,
    prompt: d.task.prompt,
    subtasks: d.subtasks.map((s) => ({
      subtask_id: s.id,
      label: `S${s.ref}`,
      title: s.title,
      status: `${s.status}（${STATUS_LABEL[s.status]}）`,
      agent: s.agent || 'none',
      chained: s.chained,
      scheduled_on: s.scheduledOn || null,
      prompt: s.prompt,
      children: s.children.map((c, i) => ({
        subtask_id: c.id,
        label: `S${s.ref}.${i + 1}`,
        title: c.title,
        status: `${c.status}（${STATUS_LABEL[c.status]}）`,
        prompt: c.prompt
      }))
    }))
  }
}

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true })

function requireTask(taskId: string): TaskDetail {
  const d = db.getTask(taskId)
  if (!d) throw new Error(`找不到任务 ${taskId}，先用 list_projects 或 search 查 id`)
  return d
}

function buildServer(onChange: (summary: string) => void): McpServer {
  const server = new McpServer({ name: 'baton', version: '0.1.0' }, { instructions: INSTRUCTIONS })

  // 统一包一层：出错时把原因告诉 AI，而不是让请求失败
  const tool = <T,>(fn: (args: T) => ReturnType<typeof ok>) => {
    return async (args: T) => {
      try {
        return fn(args)
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    }
  }

  server.registerTool(
    'list_projects',
    {
      title: '列出项目和任务',
      description: '列出所有项目和里面的任务：id、状态、进度、当前在做的子任务。找 id 时先调它。',
      annotations: { readOnlyHint: true }
    },
    tool(() =>
      ok(
        db.listProjects().map(({ project, tasks }) => ({
          project_id: project.id,
          project: project.title,
          tasks: tasks.map((t) => ({
            task_id: t.id,
            title: t.title,
            status: `${t.status}（${STATUS_LABEL[t.status]}）`,
            progress: `${t.subtaskDone}/${t.subtaskTotal}`,
            dates: t.span ? { from: t.span.from, to: t.span.to, overdue: t.span.overdue } : null,
            unscheduled: t.unscheduled,
            current: t.current
              ? `S${t.current.ref} ${t.current.title}（${STATUS_LABEL[t.current.status]}，${agentName(t.current.agent)}）`
              : null
          }))
        }))
      )
    )
  )

  server.registerTool(
    'get_task',
    {
      title: '查看任务',
      description: '查看一个任务的全部内容：目标、提示词、状态、子任务（含执行者、接力关系、提示词）和子子任务。',
      inputSchema: { task_id: z.string() },
      annotations: { readOnlyHint: true }
    },
    tool(({ task_id }: { task_id: string }) => ok(taskView(requireTask(task_id))))
  )

  server.registerTool(
    'search',
    {
      title: '搜索',
      description: '按关键词在项目、任务、子任务、子子任务的标题和提示词里搜索，返回匹配项和它们的 id。',
      inputSchema: { query: z.string().describe('关键词，不区分大小写') },
      annotations: { readOnlyHint: true }
    },
    tool(({ query }: { query: string }) => {
      const q = query.toLowerCase()
      const hit = (...texts: string[]) => texts.some((t) => t.toLowerCase().includes(q))
      const results: unknown[] = []
      for (const { project, tasks } of db.listProjects()) {
        if (hit(project.title)) results.push({ type: 'project', project_id: project.id, title: project.title })
        for (const t of tasks) {
          const d = db.getTask(t.id)
          if (!d) continue
          if (hit(t.title, t.goal, t.prompt)) {
            results.push({ type: 'task', task_id: t.id, project: project.title, title: t.title })
          }
          for (const s of d.subtasks) {
            if (hit(s.title, s.prompt)) {
              results.push({ type: 'subtask', subtask_id: s.id, task_id: t.id, path: `${project.title} / ${t.title} / S${s.ref}`, title: s.title })
            }
            s.children.forEach((c, i) => {
              if (hit(c.title, c.prompt)) {
                results.push({
                  type: 'child',
                  subtask_id: c.id,
                  task_id: t.id,
                  path: `${project.title} / ${t.title} / S${s.ref}.${i + 1}`,
                  title: c.title
                })
              }
            })
          }
        }
      }
      return ok(results.length ? results : '没有找到')
    })
  )

  server.registerTool(
    'process_board',
    {
      title: '查看进程',
      description: '按状态看所有在推进的子任务：进行中、待办、已暂停，以及今天完成的。每项带执行者。',
      annotations: { readOnlyHint: true }
    },
    tool(() => {
      const board = db.processBoard()
      const item = (i: (typeof board.columns.todo)[number]) => ({
        subtask_id: i.subtaskId,
        task_id: i.taskId,
        path: `${i.projectTitle} / ${i.taskTitle} / S${i.ref}`,
        title: i.title,
        agent: i.agent || 'none',
        waiting_for: i.waitingFor ? `S${i.waitingFor}` : null
      })
      return ok({
        active: board.columns.active.map(item),
        todo: board.columns.todo.map(item),
        paused: board.columns.paused.map(item),
        done_today: board.columns.done.map(item)
      })
    })
  )

  server.registerTool(
    'calendar',
    {
      title: '查看月历',
      description: '看某段日子里每天安排了哪些子任务，以及还没安排日子的子任务。日期是本地日期 YYYY-MM-DD，包含两头。',
      inputSchema: {
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
      },
      annotations: { readOnlyHint: true }
    },
    tool(({ from, to }: { from: string; to: string }) => {
      const board = db.calendar(from, to)
      const item = (i: (typeof board.items)[number]) => ({
        subtask_id: i.subtaskId,
        task_id: i.taskId,
        path: `${i.projectTitle} / ${i.taskTitle} / S${i.ref}`,
        title: i.title,
        status: `${i.status}（${STATUS_LABEL[i.status]}）`,
        agent: i.agent || 'none'
      })
      const days: Record<string, ReturnType<typeof item>[]> = {}
      for (const i of board.items) (days[i.scheduledOn] ??= []).push(item(i))
      return ok({ days, unscheduled: board.unscheduled.map(item) })
    })
  )

  server.registerTool(
    'create_project',
    {
      title: '新建项目',
      description: '新建一个项目（分组）。',
      inputSchema: { title: z.string() }
    },
    tool(({ title }: { title: string }) => {
      const id = db.createProject({ title })
      onChange(`新建了项目「${title}」`)
      return ok({ project_id: id, title })
    })
  )

  server.registerTool(
    'create_task',
    {
      title: '新建任务',
      description: '在项目里新建一个任务。传 project_id，或者传 project_title（没有这个项目就会新建）。',
      inputSchema: {
        project_id: z.string().optional(),
        project_title: z.string().optional(),
        title: z.string(),
        goal: z.string().optional(),
        prompt: z.string().optional().describe('任务本身的提示词')
      }
    },
    tool(
      (args: { project_id?: string; project_title?: string; title: string; goal?: string; prompt?: string }) => {
        let projectId = args.project_id
        if (!projectId) {
          if (!args.project_title) throw new Error('需要 project_id 或 project_title')
          const found = db.listProjects().find((p) => p.project.title === args.project_title)
          projectId = found ? found.project.id : db.createProject({ title: args.project_title })
        }
        const id = db.createTask({ projectId, title: args.title, goal: args.goal })
        if (args.prompt) db.updateTask(id, { prompt: args.prompt })
        onChange(`新建了任务「${args.title}」`)
        return ok(taskView(requireTask(id)))
      }
    )
  )

  server.registerTool(
    'update_task',
    {
      title: '修改任务',
      description: '修改任务的标题、目标、提示词或状态。任务状态平时会跟着子任务自动变化，一般不用改。',
      inputSchema: {
        task_id: z.string(),
        title: z.string().optional(),
        goal: z.string().optional(),
        prompt: z.string().optional(),
        status: status.optional()
      }
    },
    tool(
      (args: {
        task_id: string
        title?: string
        goal?: string
        prompt?: string
        status?: 'todo' | 'active' | 'paused' | 'done'
      }) => {
        const d = requireTask(args.task_id)
        db.updateTask(args.task_id, { title: args.title, goal: args.goal, prompt: args.prompt, status: args.status })
        onChange(`修改了任务「${args.title ?? d.task.title}」`)
        return ok(taskView(requireTask(args.task_id)))
      }
    )
  )

  const childInput = z.object({ title: z.string(), prompt: z.string().optional() })
  const subtaskInput = z.object({
    title: z.string(),
    prompt: z.string().optional(),
    agent: agent.optional(),
    chained: z.boolean().optional().describe('true = 接力：接着上一个子任务做，上一个完成后才轮到它'),
    scheduled_on: z
      .string()
      .regex(/^(\d{4}-\d{2}-\d{2})?$/)
      .optional()
      .describe('哪天做，本地日期 YYYY-MM-DD；不传就排在今天，传空字符串表示先不排'),
    children: z.array(childInput).optional().describe('这个子任务下面的子子任务')
  })

  server.registerTool(
    'add_subtasks',
    {
      title: '添加子任务',
      description:
        '给任务添加一个或多个子任务（按顺序加在最后），每个可以带提示词、执行者、是否接力、子子任务。' +
        '传 parent_subtask_id 时，加的是那个子任务下面的子子任务（只用 title / prompt）。',
      inputSchema: {
        task_id: z.string(),
        parent_subtask_id: z.string().optional(),
        items: z.array(subtaskInput).min(1)
      }
    },
    tool((args: { task_id: string; parent_subtask_id?: string; items: z.infer<typeof subtaskInput>[] }) => {
      const d = requireTask(args.task_id)
      for (const item of args.items) {
        const id = db.createSubtask(args.task_id, {
          title: item.title,
          prompt: item.prompt,
          parentId: args.parent_subtask_id,
          agent: args.parent_subtask_id || !item.agent ? undefined : toAssignee(item.agent),
          chained: item.chained,
          scheduledOn: args.parent_subtask_id ? undefined : item.scheduled_on
        })
        for (const c of item.children ?? []) {
          db.createSubtask(args.task_id, { title: c.title, prompt: c.prompt, parentId: id })
        }
      }
      onChange(`给「${d.task.title}」加了 ${args.items.length} 个子任务`)
      return ok(taskView(requireTask(args.task_id)))
    })
  )

  server.registerTool(
    'update_subtask',
    {
      title: '修改子任务',
      description:
        '修改子任务或子子任务：标题、提示词、状态、执行者、是否接力、安排在哪天做。' +
        '换执行者不会改状态。子子任务只能改标题、提示词、状态。',
      inputSchema: {
        subtask_id: z.string(),
        title: z.string().optional(),
        prompt: z.string().optional(),
        status: status.optional(),
        agent: agent.optional(),
        chained: z.boolean().optional(),
        scheduled_on: z
          .string()
          .regex(/^(\d{4}-\d{2}-\d{2})?$/)
          .optional()
          .describe('安排在哪天做，本地日期 YYYY-MM-DD；传空字符串表示取消安排。子子任务不能排日子')
      }
    },
    tool(
      (args: {
        subtask_id: string
        title?: string
        prompt?: string
        status?: Status
        agent?: z.infer<typeof agent>
        chained?: boolean
        scheduled_on?: string
      }) => {
        const info = db.subtaskInfo(args.subtask_id)
        if (!info) throw new Error(`找不到子任务 ${args.subtask_id}`)
        if (info.parentId && (args.agent || args.chained !== undefined || args.scheduled_on)) {
          throw new Error('子子任务不能分配执行者、不能设接力，也不能排日子')
        }
        db.updateSubtask(args.subtask_id, {
          title: args.title,
          prompt: args.prompt,
          status: args.status,
          agent: args.agent ? toAssignee(args.agent) : undefined,
          chained: args.chained,
          scheduledOn: args.scheduled_on
        })
        onChange(`修改了「${args.title ?? info.title}」`)
        return ok(taskView(requireTask(info.taskId)))
      }
    )
  )

  server.registerTool(
    'delete_subtask',
    {
      title: '删除子任务',
      description: '删除一个子任务（连同它的子子任务）或一个子子任务。',
      inputSchema: { subtask_id: z.string() },
      annotations: { destructiveHint: true }
    },
    tool(({ subtask_id }: { subtask_id: string }) => {
      const info = db.subtaskInfo(subtask_id)
      if (!info) throw new Error(`找不到子任务 ${subtask_id}`)
      db.deleteSubtask(subtask_id)
      onChange(`删除了「${info.title}」`)
      return ok(taskView(requireTask(info.taskId)))
    })
  )

  return server
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined)
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/** 启动 MCP 服务；onChange 在 AI 改了数据后调用（用来刷新界面、提示用户） */
export function startMcp(token: string, onChange: (summary: string) => void): void {
  httpServer = createServer(async (req, res) => {
    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404).end()
      return
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: '密钥不对' }))
      return
    }
    // 无状态模式：每个请求独立处理，不支持 GET 长连接
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end()
      return
    }
    let body: unknown
    try {
      body = await readJson(req)
    } catch {
      res.writeHead(400).end()
      return
    }
    const server = buildServer(onChange)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: [`127.0.0.1:${MCP_PORT}`, `localhost:${MCP_PORT}`]
    })
    res.on('close', () => {
      transport.close()
      server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (err) {
      if (!res.headersSent) res.writeHead(500).end(String(err))
    }
  })
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    state = {
      running: false,
      error: err.code === 'EADDRINUSE' ? `端口 ${MCP_PORT} 被别的程序占用了` : err.message
    }
  })
  httpServer.listen(MCP_PORT, '127.0.0.1', () => {
    state = { running: true, error: null }
  })
}

export function stopMcp(): void {
  httpServer?.close()
  httpServer = null
}
