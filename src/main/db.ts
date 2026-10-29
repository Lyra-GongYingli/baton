import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { AGENTS } from '../shared/agents'
import { pickColor } from '../shared/colors'
import { today as todayStr } from '../shared/dates'
import { expandPrompt, previousOf, referencedSubtasks } from '../shared/prompt'
import type {
  Assignee,
  CalendarBoard,
  CalendarItem,
  Dashboard,
  HookAgent,
  LineBoard,
  LiveItem,
  LiveState,
  ProcessBoard,
  Project,
  ProjectTree,
  Status,
  Subtask,
  SubtaskBrief,
  Task,
  TaskDetail,
  TaskSummary
} from '../shared/types'

type Row = Record<string, SQLInputValue>

let db: DatabaseSync

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '',
  position   REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL,
  goal          TEXT NOT NULL DEFAULT '',
  done_criteria TEXT NOT NULL DEFAULT '',
  prompt        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active',
  breakpoint    TEXT, -- 旧版的 AI 断点卡，已不再使用
  position      REAL NOT NULL DEFAULT 0,
  next_ref      INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- 子任务和子子任务放在同一张表：子子任务的 parent_id 是它的上级子任务
CREATE TABLE IF NOT EXISTS subtasks (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  parent_id  TEXT NOT NULL DEFAULT '',
  ref        INTEGER NOT NULL,
  position   REAL NOT NULL,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'todo',
  agent      TEXT NOT NULL DEFAULT '',
  tool       TEXT NOT NULL DEFAULT '', -- 旧版「用到的软件」，已不再使用
  prompt     TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '', -- 旧版「备注」，已不再使用
  chained    INTEGER NOT NULL DEFAULT 0,
  scheduled_on TEXT NOT NULL DEFAULT '', -- 安排在哪天做，YYYY-MM-DD
  done_at    INTEGER NOT NULL DEFAULT 0, -- 完成的时间（毫秒），没完成是 0；由触发器维护
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 旧版的「产物」和「记录」，已不再使用，保留表以免丢数据
CREATE TABLE IF NOT EXISTS artifacts (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  subtask_id TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'text',
  title      TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS logs (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL
);

-- Claude Code、Codex 通过 hooks 报上来的会话：这会儿在干嘛、认出来在做哪一项。存下来，Baton 重启后还认得
CREATE TABLE IF NOT EXISTS agent_sessions (
  agent      TEXT NOT NULL,
  session_id TEXT NOT NULL,
  item_id    TEXT NOT NULL DEFAULT '', -- 认出来的任务 / 子任务 / 子子任务；空 = 还没认出来
  state      TEXT NOT NULL DEFAULT 'idle', -- running / waiting / idle
  cwd        TEXT NOT NULL DEFAULT '',
  snippet    TEXT NOT NULL DEFAULT '', -- 第一句话的开头
  pid        INTEGER NOT NULL DEFAULT 0, -- 跑 hook 的进程
  pid_ok     INTEGER NOT NULL DEFAULT 0, -- 连着两次报的是同一个 pid，才拿它判断会话还在不在
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (agent, session_id)
);
`

const INDEXES = `
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id, position);
CREATE INDEX IF NOT EXISTS subtasks_task ON subtasks(task_id, parent_id, position);

-- 记下子任务完成的时间（总看板的「每天完成」靠它）。不管从界面、连带、还是 AI 改的状态都算
CREATE TRIGGER IF NOT EXISTS subtasks_done_at AFTER UPDATE OF status ON subtasks
WHEN NEW.status = 'done' AND OLD.status != 'done'
BEGIN UPDATE subtasks SET done_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS subtasks_undone_at AFTER UPDATE OF status ON subtasks
WHEN NEW.status != 'done' AND OLD.status = 'done'
BEGIN UPDATE subtasks SET done_at = 0 WHERE id = NEW.id; END;
`

export function openDb(file: string): void {
  db = new DatabaseSync(file)
  renameOldTables()
  db.exec(SCHEMA)
  addMissingColumns()
  db.exec(INDEXES)
  putOrphansInProject()
  // 状态只表达进度：老的「我在做」「AI 在跑」「等我审核」都算进行中（谁在做记在 agent 上）
  db.exec("UPDATE subtasks SET status = 'active' WHERE status IN ('doing', 'ai_running', 'review')")
  // 启动时把所有任务的状态和子任务进度对齐一次，S 编号也按顺序排一遍（以前拖动、删除后会乱）
  for (const r of db.prepare('SELECT id FROM tasks').all() as Row[]) {
    renumberSubtasks(r.id as string)
    syncTaskStatus(r.id as string)
  }
}

// ---------- 老数据迁移 ----------

function tableNames(): Set<string> {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]
  return new Set(rows.map((r) => r.name as string))
}

function columns(table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((r) => r.name as string)
}

/** 第一版叫「线程 / 步骤」，改名成「任务 / 子任务」 */
function renameOldTables(): void {
  const tables = tableNames()
  if (!tables.has('threads') || tables.has('tasks')) return
  db.exec(`
    BEGIN;
    DROP INDEX IF EXISTS steps_thread;
    DROP INDEX IF EXISTS artifacts_step;
    DROP INDEX IF EXISTS logs_thread;
    ALTER TABLE threads RENAME TO tasks;
    ALTER TABLE steps RENAME TO subtasks;
    ALTER TABLE tasks RENAME COLUMN next_step_ref TO next_ref;
    ALTER TABLE subtasks RENAME COLUMN thread_id TO task_id;
    ALTER TABLE artifacts RENAME COLUMN thread_id TO task_id;
    ALTER TABLE artifacts RENAME COLUMN step_id TO subtask_id;
    ALTER TABLE logs RENAME COLUMN thread_id TO task_id;
    COMMIT;
  `)
}

function addMissingColumns(): void {
  const taskCols = columns('tasks')
  if (!taskCols.includes('project_id')) {
    db.exec("ALTER TABLE tasks ADD COLUMN project_id TEXT NOT NULL DEFAULT ''")
  }
  if (!taskCols.includes('position')) {
    db.exec('ALTER TABLE tasks ADD COLUMN position REAL NOT NULL DEFAULT 0')
    // 沿用原来的顺序：最近更新的在前
    const rows = db.prepare('SELECT id FROM tasks ORDER BY updated_at DESC').all() as Row[]
    rows.forEach((r, i) => db.prepare('UPDATE tasks SET position = ? WHERE id = ?').run(i, r.id))
  }
  if (!taskCols.includes('prompt')) {
    db.exec("ALTER TABLE tasks ADD COLUMN prompt TEXT NOT NULL DEFAULT ''")
  }

  const subCols = columns('subtasks')
  if (!subCols.includes('parent_id')) {
    db.exec("ALTER TABLE subtasks ADD COLUMN parent_id TEXT NOT NULL DEFAULT ''")
    db.exec('DROP INDEX IF EXISTS subtasks_task')
  }
  if (!subCols.includes('agent')) {
    db.exec("ALTER TABLE subtasks ADD COLUMN agent TEXT NOT NULL DEFAULT ''")
    // 原来的「用什么做」里写了 Claude / Codex / Muse / 手动 的，转成执行者
    const rows = db.prepare('SELECT id, tool FROM subtasks').all() as Row[]
    for (const r of rows) {
      const tool = String(r.tool).toLowerCase()
      const agent = tool.includes('claude')
        ? 'claude'
        : tool.includes('codex')
          ? 'codex'
          : tool.includes('muse')
            ? 'muse'
            : tool.includes('手动') || tool === '我'
              ? 'me'
              : ''
      if (agent) db.prepare('UPDATE subtasks SET agent = ? WHERE id = ?').run(agent, r.id)
    }
  }
  if (!subCols.includes('chained')) {
    db.exec('ALTER TABLE subtasks ADD COLUMN chained INTEGER NOT NULL DEFAULT 0')
    // 提示词引用了紧挨着的上一步的，算接力子任务
    const rows = db
      .prepare('SELECT id, task_id, ref, prompt FROM subtasks ORDER BY task_id, position')
      .all() as Row[]
    rows.forEach((r, i) => {
      const prev = rows[i - 1]
      if (prev && prev.task_id === r.task_id && referencedSubtasks(String(r.prompt)).includes(Number(prev.ref))) {
        db.prepare('UPDATE subtasks SET chained = 1 WHERE id = ?').run(r.id)
      }
    })
  }
  if (!subCols.includes('scheduled_on')) {
    db.exec("ALTER TABLE subtasks ADD COLUMN scheduled_on TEXT NOT NULL DEFAULT ''")
  }
  if (!subCols.includes('done_at')) {
    db.exec('ALTER TABLE subtasks ADD COLUMN done_at INTEGER NOT NULL DEFAULT 0')
    // 以前完成的没有记时间，拿最后修改时间凑合
    db.exec("UPDATE subtasks SET done_at = updated_at WHERE status = 'done'")
  }
}

/** 没有项目的任务（比如老数据）放进「未分组」 */
function putOrphansInProject(): void {
  const orphans = db
    .prepare('SELECT id FROM tasks WHERE project_id NOT IN (SELECT id FROM projects)')
    .all() as Row[]
  if (orphans.length === 0) return
  const inbox = db.prepare("SELECT id FROM projects WHERE title = '未分组'").get() as Row | undefined
  const inboxId = inbox ? (inbox.id as string) : createProject({ title: '未分组' })
  for (const r of orphans) db.prepare('UPDATE tasks SET project_id = ? WHERE id = ?').run(inboxId, r.id)
}

// ---------- 行 → 对象 ----------

function toProject(r: Row): Project {
  return {
    id: r.id as string,
    title: r.title as string,
    color: r.color as string,
    position: Number(r.position),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  }
}

function toTask(r: Row): Task {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    title: r.title as string,
    goal: r.goal as string,
    doneCriteria: r.done_criteria as string,
    prompt: r.prompt as string,
    status: r.status as Status,
    position: Number(r.position),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  }
}

function toSubtask(r: Row): Subtask {
  return {
    id: r.id as string,
    taskId: r.task_id as string,
    parentId: r.parent_id as string,
    ref: Number(r.ref),
    position: Number(r.position),
    title: r.title as string,
    status: r.status as Status,
    agent: r.agent as Assignee,
    prompt: r.prompt as string,
    chained: Boolean(r.chained),
    scheduledOn: (r.scheduled_on as string) ?? '',
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    children: []
  }
}

function touchTask(taskId: string): void {
  db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(Date.now(), taskId)
}

/**
 * 上一层的状态跟着下一层的进度走（任务跟子任务，子任务跟子子任务）：
 *   全部完成 → 已完成；有进行中、已暂停或完成了一部分 → 进行中；
 *   全是待办 → 不动（原来是已完成的，回到待办）。
 * 「已暂停」是手动设的，不自动改；下面还没有东西时保持原样。
 */
function rollUp(current: Status, below: Status[]): Status {
  if (current === 'paused' || below.length === 0) return current
  if (below.every((s) => s === 'done')) return 'done'
  if (below.some((s) => s !== 'todo')) return 'active'
  return current === 'done' ? 'todo' : current
}

function syncTaskStatus(taskId: string): void {
  const t = db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId) as Row | undefined
  if (!t) return
  const subs = (
    db.prepare("SELECT status FROM subtasks WHERE task_id = ? AND parent_id = ''").all(taskId) as Row[]
  ).map((r) => r.status as Status)
  const next = rollUp(t.status as Status, subs)
  if (next !== t.status) db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(next, taskId)
}

/** 子任务的状态跟着它的子子任务走 */
function syncSubtaskStatus(id: string): void {
  const s = db.prepare('SELECT status FROM subtasks WHERE id = ?').get(id) as Row | undefined
  if (!s) return
  const children = (db.prepare('SELECT status FROM subtasks WHERE parent_id = ?').all(id) as Row[]).map(
    (r) => r.status as Status
  )
  const next = rollUp(s.status as Status, children)
  if (next !== s.status) db.prepare('UPDATE subtasks SET status = ?, updated_at = ? WHERE id = ?').run(next, Date.now(), id)
}

function taskIdOf(id: string): string | null {
  const r = db.prepare('SELECT task_id FROM subtasks WHERE id = ?').get(id) as Row | undefined
  return r ? (r.task_id as string) : null
}

function update(table: string, id: string, cols: Record<string, SQLInputValue>): void {
  const keys = Object.keys(cols)
  db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
    ...keys.map((k) => cols[k]),
    id
  )
}

/** 任务的子任务（按顺序），每个子任务带上它的子子任务 */
function subtasksOf(taskId: string): Subtask[] {
  const all = (
    db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY position, created_at').all(taskId) as Row[]
  ).map(toSubtask)
  const top = all.filter((s) => !s.parentId)
  for (const s of top) s.children = all.filter((c) => c.parentId === s.id)
  return top
}

// ---------- 项目 ----------

export function listProjects(): ProjectTree[] {
  const projects = (db.prepare('SELECT * FROM projects ORDER BY position, created_at').all() as Row[]).map(
    toProject
  )
  const tasks = (db.prepare('SELECT * FROM tasks ORDER BY position, created_at').all() as Row[]).map(toTask)
  // 子任务和子子任务一起取出来，子子任务用 parent_id 挂回去
  const subRows = db
    .prepare(
      'SELECT id, task_id, parent_id, ref, title, status, agent, prompt, scheduled_on FROM subtasks ORDER BY position, created_at'
    )
    .all() as Row[]
  const brief = (s: Row, t: Task): SubtaskBrief => ({
    id: s.id as string,
    ref: Number(s.ref),
    title: s.title as string,
    status: s.status as Status,
    agent: s.agent as Assignee,
    prompt: s.prompt ? expandPrompt(String(s.prompt), t) : '',
    scheduledOn: (s.scheduled_on as string) ?? '',
    children: []
  })

  const now = todayStr()
  return projects.map((p) => ({
    project: p,
    tasks: tasks
      .filter((t) => t.projectId === p.id)
      .map((t): TaskSummary => {
        const mine = subRows.filter((s) => s.task_id === t.id && !s.parent_id)
        const current = mine.find((s) => s.status !== 'done')
        // 任务的时间 = 没做完的子任务排在哪几天
        const open = mine.filter((s) => s.status !== 'done')
        const days = open.map((s) => s.scheduled_on as string).filter(Boolean).sort()
        return {
          ...t,
          color: p.color,
          projectTitle: p.title,
          subtaskTotal: mine.length,
          subtaskDone: mine.filter((s) => s.status === 'done').length,
          current: current
            ? {
                id: current.id as string,
                ref: Number(current.ref),
                title: current.title as string,
                status: current.status as Status,
                agent: current.agent as Assignee,
                scheduledOn: current.scheduled_on as string
              }
            : null,
          statuses: mine.map((s) => s.status as Status),
          subtasks: mine.map((s) => ({
            ...brief(s, t),
            children: subRows.filter((c) => c.parent_id === s.id).map((c) => brief(c, t))
          })),
          span: days.length ? { from: days[0], to: days[days.length - 1], overdue: days[0] < now } : null,
          unscheduled: open.length - days.length
        }
      })
  }))
}

export function createProject(input: { title: string }): string {
  const id = randomUUID()
  const now = Date.now()
  const colors = (db.prepare('SELECT color FROM projects').all() as Row[]).map((r) => r.color as string)
  const max = db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM projects').get() as Row
  db.prepare(
    'INSERT INTO projects (id, title, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, input.title.trim() || '新项目', pickColor(colors), Number(max.p) + 1, now, now)
  return id
}

export function updateProject(id: string, patch: Partial<Pick<Project, 'title' | 'color'>>): void {
  const cols: Record<string, SQLInputValue> = { updated_at: Date.now() }
  if (patch.title !== undefined) cols.title = patch.title
  if (patch.color !== undefined) cols.color = patch.color
  update('projects', id, cols)
}

/** 删项目会连同里面的任务一起删 */
export function deleteProject(id: string): void {
  db.prepare('DELETE FROM tasks WHERE project_id = ?').run(id)
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
}

export function reorderProjects(ids: string[]): void {
  ids.forEach((id, i) => db.prepare('UPDATE projects SET position = ? WHERE id = ?').run(i, id))
}

// ---------- 任务 ----------

export function getTask(id: string): TaskDetail | null {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined
  if (!row) return null
  const task = toTask(row)
  const project = toProject(db.prepare('SELECT * FROM projects WHERE id = ?').get(task.projectId) as Row)
  return { project, task, subtasks: subtasksOf(id) }
}

export function createTask(input: { projectId: string; title: string; goal?: string }): string {
  const id = randomUUID()
  const now = Date.now()
  // 新任务放在项目最上面
  const min = db
    .prepare('SELECT COALESCE(MIN(position), 0) AS p FROM tasks WHERE project_id = ?')
    .get(input.projectId) as Row
  db.prepare(
    `INSERT INTO tasks (id, project_id, title, goal, status, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'todo', ?, ?, ?)`
  ).run(id, input.projectId, input.title.trim() || '未命名任务', input.goal ?? '', Number(min.p) - 1, now, now)
  return id
}

export function updateTask(
  id: string,
  patch: Partial<Pick<Task, 'title' | 'goal' | 'doneCriteria' | 'prompt' | 'status'>>
): void {
  const cols: Record<string, SQLInputValue> = { updated_at: Date.now() }
  if (patch.title !== undefined) cols.title = patch.title
  if (patch.goal !== undefined) cols.goal = patch.goal
  if (patch.doneCriteria !== undefined) cols.done_criteria = patch.doneCriteria
  if (patch.prompt !== undefined) cols.prompt = patch.prompt
  if (patch.status !== undefined) cols.status = patch.status
  update('tasks', id, cols)
  // 手动把任务标成已完成：下面的子任务、子子任务一起打勾
  if (patch.status === 'done') {
    db.prepare("UPDATE subtasks SET status = 'done', updated_at = ? WHERE task_id = ? AND status != 'done'").run(
      Date.now(),
      id
    )
  }
}

export function deleteTask(id: string): void {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
}

/** index 是在目标项目「未完成任务」里的位置（已完成的任务单独折叠，不参与排序） */
export function moveTask(id: string, projectId: string, index: number): void {
  const others = (
    db
      .prepare(
        "SELECT id FROM tasks WHERE project_id = ? AND id != ? AND status != 'done' ORDER BY position, created_at"
      )
      .all(projectId, id) as Row[]
  ).map((r) => r.id as string)
  others.splice(Math.max(0, Math.min(index, others.length)), 0, id)
  db.prepare('UPDATE tasks SET project_id = ? WHERE id = ?').run(projectId, id)
  others.forEach((tid, i) => db.prepare('UPDATE tasks SET position = ? WHERE id = ?').run(i, tid))
}

// ---------- 子任务 / 子子任务 ----------

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function createSubtask(
  taskId: string,
  input: { title: string; prompt?: string; chained?: boolean; agent?: Assignee; parentId?: string; scheduledOn?: string }
): string {
  const t = db.prepare('SELECT next_ref FROM tasks WHERE id = ?').get(taskId) as Row | undefined
  if (!t) throw new Error('任务不存在')
  const parentId = input.parentId ?? ''
  if (input.scheduledOn && !DATE.test(input.scheduledOn)) throw new Error(`日期格式应为 YYYY-MM-DD：${input.scheduledOn}`)
  // S 编号跟着顺序走，新的排在最后；子子任务不占 S 编号（显示成 S1.1、S1.2，按顺序算出来）
  const ref = parentId ? 0 : Number(t.next_ref)
  const max = db
    .prepare('SELECT COALESCE(MAX(position), 0) AS p FROM subtasks WHERE task_id = ? AND parent_id = ?')
    .get(taskId, parentId) as Row
  const position = Number(max.p) + 1
  // 子子任务是简单的清单项：不接力、不分配执行者
  const chained = !parentId && Boolean(input.chained)
  const agent = parentId ? '' : (input.agent ?? '')
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO subtasks (id, task_id, parent_id, ref, position, title, status, agent, prompt, chained, scheduled_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    taskId,
    parentId,
    ref,
    position,
    input.title.trim() || (parentId ? '新子子任务' : '新子任务'),
    'todo',
    agent,
    input.prompt ?? '',
    chained ? 1 : 0,
    // 子任务默认排在今天；子子任务是清单项，不排日子
    parentId ? '' : (input.scheduledOn ?? todayStr()),
    now,
    now
  )
  if (parentId) syncSubtaskStatus(parentId)
  else renumberSubtasks(taskId)
  touchTask(taskId)
  syncTaskStatus(taskId)
  return id
}

/**
 * S 编号就是顺序：子任务从上到下是 S1、S2、S3……
 * 拖动换了位置、删掉一个、子子任务提出来 / 子任务放进去之后都重新排；子子任务不占编号。
 * AI（MCP）认子任务用 id，不用 S 编号，所以重排不会让它改错。
 */
function renumberSubtasks(taskId: string): void {
  const rows = db
    .prepare("SELECT id, ref FROM subtasks WHERE task_id = ? AND parent_id = '' ORDER BY position, created_at")
    .all(taskId) as Row[]
  const setRef = db.prepare('UPDATE subtasks SET ref = ? WHERE id = ?')
  rows.forEach((r, i) => {
    if (Number(r.ref) !== i + 1) setRef.run(i + 1, r.id)
  })
  db.prepare("UPDATE subtasks SET ref = 0 WHERE task_id = ? AND parent_id != '' AND ref != 0").run(taskId)
  db.prepare('UPDATE tasks SET next_ref = ? WHERE id = ?').run(rows.length + 1, taskId)
}


export function updateSubtask(
  id: string,
  patch: Partial<Pick<Subtask, 'title' | 'status' | 'agent' | 'prompt' | 'chained' | 'scheduledOn'>>
): void {
  const cols: Record<string, SQLInputValue> = { updated_at: Date.now() }
  for (const k of ['title', 'status', 'agent', 'prompt'] as const) {
    if (patch[k] !== undefined) cols[k] = patch[k]
  }
  if (patch.chained !== undefined) cols.chained = patch.chained ? 1 : 0
  if (patch.scheduledOn !== undefined) {
    if (patch.scheduledOn && !DATE.test(patch.scheduledOn)) throw new Error(`日期格式应为 YYYY-MM-DD：${patch.scheduledOn}`)
    cols.scheduled_on = patch.scheduledOn
  }
  update('subtasks', id, cols)
  const info = subtaskInfo(id)
  if (!info) return
  // 手动把子任务标成已完成：下面的子子任务一起完成
  if (patch.status === 'done') {
    db.prepare("UPDATE subtasks SET status = 'done', updated_at = ? WHERE parent_id = ? AND status != 'done'").run(
      Date.now(),
      id
    )
  }
  if (patch.status !== undefined && info.parentId) syncSubtaskStatus(info.parentId)
  touchTask(info.taskId)
  syncTaskStatus(info.taskId)
}

/** 换执行者：只记谁在做，状态不跟着变 */
export function assignSubtask(id: string, agent: Assignee): void {
  updateSubtask(id, { agent })
}

/**
 * 拖动后整体重排：layout 是从上到下的顺序，每项说明它挂在哪个子任务下面（空字符串 = 本身是子任务）。
 * 排完 S 编号按新顺序重新来；子任务被拖进别的子任务时，变成简单的清单项（不接力、不分配）。
 */
export function arrangeSubtasks(taskId: string, layout: { id: string; parentId: string }[]): void {
  if (!db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId)) return
  const touchedParents = new Set<string>()
  layout.forEach(({ id, parentId }, i) => {
    const row = db
      .prepare('SELECT parent_id, ref, status, scheduled_on FROM subtasks WHERE id = ? AND task_id = ?')
      .get(id, taskId) as Row | undefined
    if (!row) return
    const cols: Record<string, SQLInputValue> = { position: i, parent_id: parentId }
    if (row.parent_id !== parentId) {
      for (const p of [row.parent_id as string, parentId]) if (p) touchedParents.add(p)
      if (!parentId) {
        cols.chained = 0
        if (!row.scheduled_on) cols.scheduled_on = todayStr()
      } else {
        // 变成子子任务：只是清单项，不接力、不分人、不排日子
        cols.chained = 0
        cols.agent = ''
        cols.scheduled_on = ''
      }
    }
    update('subtasks', id, cols)
  })
  renumberSubtasks(taskId)
  touchTask(taskId)
  for (const p of touchedParents) syncSubtaskStatus(p)
  syncTaskStatus(taskId)
}

/** 子任务 / 子子任务属于哪个任务、挂在谁下面 */
export function subtaskInfo(id: string): { taskId: string; parentId: string; title: string } | null {
  const r = db.prepare('SELECT task_id, parent_id, title FROM subtasks WHERE id = ?').get(id) as Row | undefined
  return r ? { taskId: r.task_id as string, parentId: r.parent_id as string, title: r.title as string } : null
}

export function deleteSubtask(id: string): void {
  const info = subtaskInfo(id)
  db.prepare('DELETE FROM subtasks WHERE id = ? OR parent_id = ?').run(id, id)
  if (!info) return
  if (info.parentId) syncSubtaskStatus(info.parentId)
  else renumberSubtasks(info.taskId)
  touchTask(info.taskId)
  syncTaskStatus(info.taskId)
}

// ---------- 进程视图 ----------

/** 子任务 → 进程视图 / 月历里的一张卡片 */
function processItem(s: Subtask, detail: TaskDetail): CalendarItem {
  const prev = previousOf(s, detail.subtasks)
  return {
    subtaskId: s.id,
    ref: s.ref,
    title: s.title,
    status: s.status,
    agent: s.agent,
    taskId: detail.task.id,
    taskTitle: detail.task.title,
    projectTitle: detail.project.title,
    color: detail.project.color,
    updatedAt: s.updatedAt,
    waitingFor: prev && prev.status !== 'done' ? prev.ref : null,
    promptExpanded: s.prompt ? expandPrompt(s.prompt, detail.task) : '',
    scheduledOn: s.scheduledOn
  }
}

export function processBoard(): ProcessBoard {
  const columns: ProcessBoard['columns'] = { active: [], todo: [], paused: [], done: [] }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // 待办和进行中的任务，加上今天有子任务完成的任务（最后一个子任务完成后任务也完成了）
  const rows = db
    .prepare(
      `SELECT t.id, t.status FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.status IN ('todo', 'active')
          OR t.id IN (SELECT task_id FROM subtasks WHERE parent_id = '' AND status = 'done' AND updated_at >= ?)
       ORDER BY p.position, t.position`
    )
    .all(today.getTime()) as Row[]

  for (const r of rows) {
    const detail = getTask(r.id as string)
    if (!detail) continue
    const open = r.status === 'todo' || r.status === 'active'
    for (const s of detail.subtasks) {
      if (s.status === 'done') {
        if (s.updatedAt >= today.getTime()) columns.done.push(processItem(s, detail))
      } else if (open) {
        columns[s.status].push(processItem(s, detail))
      }
    }
  }
  // 进行中、已完成：最近动过的在前
  columns.active.sort((a, b) => b.updatedAt - a.updatedAt)
  columns.done.sort((a, b) => b.updatedAt - a.updatedAt)
  return { columns }
}

/** 月历：from ~ to 之间安排了的子任务，加上还没安排日子的 */
export function calendar(from: string, to: string): CalendarBoard {
  // 按项目、任务的顺序取：安排在这段日子里的子任务所在的任务 + 所有待办、进行中的任务
  const rows = db
    .prepare(
      `SELECT t.id, t.status FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.status IN ('todo', 'active')
          OR t.id IN (SELECT task_id FROM subtasks WHERE parent_id = '' AND scheduled_on BETWEEN ? AND ?)
       ORDER BY p.position, t.position`
    )
    .all(from, to) as Row[]

  const items: CalendarItem[] = []
  const unscheduled: CalendarItem[] = []
  for (const r of rows) {
    const detail = getTask(r.id as string)
    if (!detail) continue
    const open = r.status === 'todo' || r.status === 'active'
    for (const s of detail.subtasks) {
      if (s.scheduledOn) {
        if (s.scheduledOn >= from && s.scheduledOn <= to) items.push(processItem(s, detail))
      } else if (open && s.status !== 'done') {
        unscheduled.push(processItem(s, detail))
      }
    }
  }
  // 同一天里：没做完的在前，做完的沉到后面
  items.sort((a, b) => a.scheduledOn.localeCompare(b.scheduledOn) || Number(a.status === 'done') - Number(b.status === 'done'))
  return { items, unscheduled }
}

/** 晾衣绳：进行中的任务带上全部细节；待办、已暂停、今天完成的只要摘要 */
export function lineBoard(): LineBoard {
  const tasks = listProjects().flatMap((p) => p.tasks)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const recent = (a: TaskSummary, b: TaskSummary): number => b.updatedAt - a.updatedAt
  return {
    active: tasks
      .filter((t) => t.status === 'active')
      .map((t) => getTask(t.id))
      .filter((d): d is TaskDetail => d !== null),
    todo: tasks.filter((t) => t.status === 'todo'),
    paused: tasks.filter((t) => t.status === 'paused').sort(recent),
    done: tasks.filter((t) => t.status === 'done' && t.updatedAt >= today.getTime()).sort(recent)
  }
}

// ---------- 总看板 ----------

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 本地日期 → YYYY-MM-DD */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** 这一天所在那周的周一 0 点 */
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

const zero = (): Record<Status, number> => ({ todo: 0, active: 0, paused: 0, done: 0 })

/** 只算子任务（不算子子任务）：子子任务是清单项，算进去会把忙闲放大 */
export function dashboard(): Dashboard {
  const now = new Date()
  const today = ymd(now)
  const monday = mondayOf(now)
  const weekStart = ymd(monday)
  const weekEnd = ymd(addDays(monday, 6))
  // 热力图：往前 17 周、往后 8 周，一共 26 周
  const heatStart = addDays(monday, -17 * 7)
  const heatFrom = ymd(heatStart)
  const heatTo = ymd(addDays(monday, 8 * 7 + 6))
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()

  const scheduled: Record<string, number> = {}
  for (const r of db
    .prepare(
      "SELECT scheduled_on AS day, COUNT(*) AS n FROM subtasks WHERE parent_id = '' AND scheduled_on BETWEEN ? AND ? GROUP BY scheduled_on"
    )
    .all(heatFrom, heatTo) as Row[]) {
    scheduled[r.day as string] = Number(r.n)
  }

  // 每天完成：done_at 换成本地日期再数；顺便数每周
  const twelveWeeksAgo = addDays(monday, -11 * 7)
  const since = Math.min(heatStart.getTime(), twelveWeeksAgo.getTime())
  const done: Record<string, number> = {}
  const weekly = Array.from({ length: 12 }, (_, i) => ({ week: ymd(addDays(twelveWeeksAgo, i * 7)), done: 0 }))
  let doneToday = 0
  let doneThisWeek = 0
  for (const r of db
    .prepare("SELECT done_at FROM subtasks WHERE parent_id = '' AND status = 'done' AND done_at >= ?")
    .all(since) as Row[]) {
    const at = new Date(Number(r.done_at))
    const day = ymd(at)
    done[day] = (done[day] ?? 0) + 1
    const w = Math.floor((mondayOf(at).getTime() - twelveWeeksAgo.getTime()) / (7 * 86400000) + 0.5)
    if (w >= 0 && w < 12) weekly[w].done++
    if (at.getTime() >= todayStart) doneToday++
    if (at.getTime() >= monday.getTime()) doneThisWeek++
  }

  // 项目、执行者、逾期、接下来几天：把所有任务过一遍
  const trees = listProjects()
  const agents = new Map<Assignee, { active: number; todo: number; paused: number }>(
    [...AGENTS.map((a) => a.id as Assignee), '' as Assignee].map((a) => [a, { active: 0, todo: 0, paused: 0 }])
  )
  const overdue: CalendarItem[] = []
  const upcoming: CalendarItem[] = []
  const soon = ymd(addDays(now, 6))
  let activeSubtasks = 0
  let scheduledThisWeek = 0

  const projects = trees.map(({ project, tasks }) => {
    const taskCounts = zero()
    const subCounts = zero()
    for (const t of tasks) {
      taskCounts[t.status]++
      const detail = getTask(t.id)
      if (!detail) continue
      const open = t.status !== 'done'
      for (const s of detail.subtasks) {
        subCounts[s.status]++
        if (s.scheduledOn >= weekStart && s.scheduledOn <= weekEnd) scheduledThisWeek++
        if (s.status === 'done' || !open) continue
        if (s.status === 'active' && t.status === 'active') activeSubtasks++
        const a = agents.get(s.agent)
        if (a) a[s.status]++
        if (s.scheduledOn && s.scheduledOn < today) overdue.push(processItem(s, detail))
        else if (s.scheduledOn && s.scheduledOn <= soon) upcoming.push(processItem(s, detail))
      }
    }
    return { id: project.id, title: project.title, color: project.color, tasks: taskCounts, subtasks: subCounts }
  })

  overdue.sort((a, b) => a.scheduledOn.localeCompare(b.scheduledOn))
  upcoming.sort((a, b) => a.scheduledOn.localeCompare(b.scheduledOn))

  return {
    today,
    weekStart,
    tiles: {
      activeTasks: trees.reduce((n, p) => n + p.tasks.filter((t) => t.status === 'active').length, 0),
      activeSubtasks,
      scheduledThisWeek,
      doneThisWeek,
      doneToday,
      overdue: overdue.length
    },
    heatFrom,
    heatTo,
    scheduled,
    done,
    weekly,
    projects,
    agents: [...agents.entries()].map(([agent, c]) => ({ agent, ...c })),
    overdue,
    upcoming
  }
}

// ---------- AI 会话（hooks） ----------

export interface AgentSessionRow {
  agent: HookAgent
  sessionId: string
  itemId: string
  state: LiveState
  cwd: string
  snippet: string
  pid: number
  pidOk: boolean
  startedAt: number
  updatedAt: number
}

function toAgentSession(r: Row): AgentSessionRow {
  return {
    agent: r.agent as HookAgent,
    sessionId: r.session_id as string,
    itemId: r.item_id as string,
    state: r.state as LiveState,
    cwd: r.cwd as string,
    snippet: r.snippet as string,
    pid: Number(r.pid),
    pidOk: Boolean(r.pid_ok),
    startedAt: Number(r.started_at),
    updatedAt: Number(r.updated_at)
  }
}

export function listAgentSessions(): AgentSessionRow[] {
  return (db.prepare('SELECT * FROM agent_sessions ORDER BY started_at').all() as Row[]).map(toAgentSession)
}

export function getAgentSession(agent: HookAgent, sessionId: string): AgentSessionRow | null {
  const r = db.prepare('SELECT * FROM agent_sessions WHERE agent = ? AND session_id = ?').get(agent, sessionId) as Row | undefined
  return r ? toAgentSession(r) : null
}

export function saveAgentSession(s: AgentSessionRow): void {
  db.prepare(
    `INSERT INTO agent_sessions (agent, session_id, item_id, state, cwd, snippet, pid, pid_ok, started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (agent, session_id) DO UPDATE SET
       item_id = excluded.item_id, state = excluded.state, cwd = excluded.cwd, snippet = excluded.snippet,
       pid = excluded.pid, pid_ok = excluded.pid_ok, updated_at = excluded.updated_at`
  ).run(s.agent, s.sessionId, s.itemId, s.state, s.cwd, s.snippet, s.pid, s.pidOk ? 1 : 0, s.startedAt, s.updatedAt)
}

/** 删掉一个会话；真删了返回 true */
export function deleteAgentSession(agent: HookAgent, sessionId: string): boolean {
  return Number(db.prepare('DELETE FROM agent_sessions WHERE agent = ? AND session_id = ?').run(agent, sessionId).changes) > 0
}

/** 所有填了提示词的子任务、子子任务和任务，占位符已替换。子任务排在前面：一样的话先算更具体的那个 */
export function promptCandidates(): { id: string; text: string }[] {
  const tasks = new Map((db.prepare('SELECT * FROM tasks').all() as Row[]).map((r) => [r.id as string, toTask(r)]))
  const out: { id: string; text: string }[] = []
  for (const r of db.prepare("SELECT id, task_id, prompt FROM subtasks WHERE prompt != ''").all() as Row[]) {
    const t = tasks.get(r.task_id as string)
    if (t) out.push({ id: r.id as string, text: expandPrompt(String(r.prompt), t) })
  }
  for (const t of tasks.values()) if (t.prompt) out.push({ id: t.id, text: expandPrompt(t.prompt, t) })
  return out
}

/** 一项（任务、子任务或子子任务）现在的状态和执行者，判断要不要改成进行中；找不到是 null */
export function itemState(id: string): { kind: 'task' | 'subtask'; status: Status; agent: Assignee; parentId: string } | null {
  const s = db.prepare('SELECT status, agent, parent_id FROM subtasks WHERE id = ?').get(id) as Row | undefined
  if (s) return { kind: 'subtask', status: s.status as Status, agent: s.agent as Assignee, parentId: s.parent_id as string }
  const t = db.prepare('SELECT status FROM tasks WHERE id = ?').get(id) as Row | undefined
  return t ? { kind: 'task', status: t.status as Status, agent: '', parentId: '' } : null
}

/** 会话列表里怎么写这一项：编号、标题、属于哪个任务；删掉了是 null */
export function liveItem(id: string): LiveItem | null {
  const sub = db.prepare('SELECT task_id, parent_id, ref, title, status FROM subtasks WHERE id = ?').get(id) as Row | undefined
  const taskId = sub ? (sub.task_id as string) : id
  const t = db
    .prepare('SELECT t.title, t.status, p.color FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?')
    .get(taskId) as Row | undefined
  if (!t) return null
  const base = { id, taskId, taskTitle: t.title as string, color: (t.color as string) || '#9CA3AF' }
  if (!sub) return { ...base, kind: 'task', label: '', title: t.title as string, status: t.status as Status }
  let label = `S${sub.ref}`
  if (sub.parent_id) {
    // 子子任务的编号是在上级子任务里的顺序，和界面上一样现算
    const parent = db.prepare('SELECT ref FROM subtasks WHERE id = ?').get(sub.parent_id) as Row | undefined
    const siblings = (
      db.prepare('SELECT id FROM subtasks WHERE parent_id = ? ORDER BY position, created_at').all(sub.parent_id) as Row[]
    ).map((r) => r.id)
    label = `S${parent ? Number(parent.ref) : '?'}.${siblings.indexOf(id) + 1}`
  }
  return { ...base, kind: 'subtask', label, title: sub.title as string, status: sub.status as Status }
}
