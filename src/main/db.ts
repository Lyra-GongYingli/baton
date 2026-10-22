import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { AGENTS, statusAfterAssign } from '../shared/agents'
import { pickColor } from '../shared/colors'
import { expandPrompt, previousOf, referencedSubtasks } from '../shared/prompt'
import type {
  AgentId,
  Assignee,
  ProcessBoard,
  ProcessItem,
  Project,
  ProjectTree,
  Subtask,
  SubtaskStatus,
  Task,
  TaskDetail,
  TaskStatus,
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
`

const INDEXES = `
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id, position);
CREATE INDEX IF NOT EXISTS subtasks_task ON subtasks(task_id, parent_id, position);
`

export function openDb(file: string): void {
  db = new DatabaseSync(file)
  renameOldTables()
  db.exec(SCHEMA)
  addMissingColumns()
  db.exec(INDEXES)
  putOrphansInProject()
  // 「等我审核」这个状态去掉了，老数据算「我在做」
  db.exec("UPDATE subtasks SET status = 'doing' WHERE status = 'review'")
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
    status: r.status as TaskStatus,
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
    status: r.status as SubtaskStatus,
    agent: r.agent as Assignee,
    prompt: r.prompt as string,
    chained: Boolean(r.chained),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    children: []
  }
}

function touchTask(taskId: string): void {
  db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(Date.now(), taskId)
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
  const subRows = db
    .prepare("SELECT task_id, ref, title, status, agent, prompt FROM subtasks WHERE parent_id = '' ORDER BY position")
    .all() as Row[]

  return projects.map((p) => ({
    project: p,
    tasks: tasks
      .filter((t) => t.projectId === p.id)
      .map((t): TaskSummary => {
        const mine = subRows.filter((s) => s.task_id === t.id)
        const current = mine.find((s) => s.status !== 'done')
        return {
          ...t,
          color: p.color,
          projectTitle: p.title,
          subtaskTotal: mine.length,
          subtaskDone: mine.filter((s) => s.status === 'done').length,
          current: current
            ? {
                ref: Number(current.ref),
                title: current.title as string,
                status: current.status as SubtaskStatus,
                agent: current.agent as Assignee
              }
            : null,
          statuses: mine.map((s) => s.status as SubtaskStatus),
          currentPrompt: current?.prompt ? expandPrompt(String(current.prompt), t) : ''
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
    `INSERT INTO tasks (id, project_id, title, goal, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
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

/** 接力子任务的上一棒还没完成 */
function waitingForPrevious(taskId: string, position: number, chained: boolean): boolean {
  if (!chained) return false
  const prev = db
    .prepare(
      "SELECT status FROM subtasks WHERE task_id = ? AND parent_id = '' AND position < ? ORDER BY position DESC LIMIT 1"
    )
    .get(taskId, position) as Row | undefined
  return Boolean(prev && prev.status !== 'done')
}

/** 分给谁之后的状态；还在等上一棒的，先排队 */
function assignedStatus(agent: Assignee, status: SubtaskStatus, waiting: boolean): SubtaskStatus {
  const next = statusAfterAssign(agent, status)
  return waiting && next !== 'done' ? 'todo' : next
}

export function createSubtask(
  taskId: string,
  input: { title: string; prompt?: string; chained?: boolean; agent?: Assignee; parentId?: string }
): string {
  const t = db.prepare('SELECT next_ref FROM tasks WHERE id = ?').get(taskId) as Row | undefined
  if (!t) throw new Error('任务不存在')
  const parentId = input.parentId ?? ''
  // 子子任务不占子任务的 S 编号（显示成 S1.1、S1.2，按顺序算出来）
  const ref = parentId ? 0 : Number(t.next_ref)
  const max = db
    .prepare('SELECT COALESCE(MAX(position), 0) AS p FROM subtasks WHERE task_id = ? AND parent_id = ?')
    .get(taskId, parentId) as Row
  const position = Number(max.p) + 1
  // 子子任务是简单的清单项：不接力、不分配执行者
  const chained = !parentId && Boolean(input.chained)
  const agent = parentId ? '' : (input.agent ?? '')
  const waiting = waitingForPrevious(taskId, position, chained)
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO subtasks (id, task_id, parent_id, ref, position, title, status, agent, prompt, chained, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    taskId,
    parentId,
    ref,
    position,
    input.title.trim() || (parentId ? '新子子任务' : '新子任务'),
    agent ? assignedStatus(agent, 'todo', waiting) : 'todo',
    agent,
    input.prompt ?? '',
    chained ? 1 : 0,
    now,
    now
  )
  if (parentId) touchTask(taskId)
  else db.prepare('UPDATE tasks SET next_ref = ?, updated_at = ? WHERE id = ?').run(ref + 1, now, taskId)
  return id
}

export function updateSubtask(
  id: string,
  patch: Partial<Pick<Subtask, 'title' | 'status' | 'agent' | 'prompt' | 'chained'>>
): void {
  const cols: Record<string, SQLInputValue> = { updated_at: Date.now() }
  for (const k of ['title', 'status', 'agent', 'prompt'] as const) {
    if (patch[k] !== undefined) cols[k] = patch[k]
  }
  if (patch.chained !== undefined) cols.chained = patch.chained ? 1 : 0
  update('subtasks', id, cols)
  const taskId = taskIdOf(id)
  if (taskId) touchTask(taskId)
}

export function assignSubtask(id: string, agent: Assignee): void {
  const r = db.prepare('SELECT task_id, position, chained, status FROM subtasks WHERE id = ?').get(id) as
    | Row
    | undefined
  if (!r) return
  const waiting = waitingForPrevious(r.task_id as string, Number(r.position), Boolean(r.chained))
  updateSubtask(id, { agent, status: assignedStatus(agent, r.status as SubtaskStatus, waiting) })
}

export function reorderSubtasks(taskId: string, ids: string[]): void {
  ids.forEach((id, i) =>
    db.prepare('UPDATE subtasks SET position = ? WHERE id = ? AND task_id = ?').run(i, id, taskId)
  )
  touchTask(taskId)
}

export function deleteSubtask(id: string): void {
  const taskId = taskIdOf(id)
  db.prepare('DELETE FROM subtasks WHERE id = ? OR parent_id = ?').run(id, id)
  if (taskId) touchTask(taskId)
}

// ---------- 进程视图 ----------

const LANE_ORDER: Record<SubtaskStatus, number> = { ai_running: 0, doing: 0, todo: 1, done: 2 }

/**
 * 所有进行中任务里还没完成的子任务，按「谁在做」分泳道：
 * 分给某个执行者的进 TA 的泳道；没分配的「我在做」算我的，其余进「未分配」。
 */
export function processBoard(): ProcessBoard {
  const rows = db
    .prepare(
      `SELECT t.id AS task_id, p.title AS project_title, p.color
       FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.status = 'active'
       ORDER BY p.position, t.position`
    )
    .all() as Row[]

  const lanes = Object.fromEntries(AGENTS.map((a) => [a.id, [] as ProcessItem[]])) as Record<
    AgentId,
    ProcessItem[]
  >
  const unassigned: ProcessItem[] = []

  for (const r of rows) {
    const detail = getTask(r.task_id as string)
    if (!detail) continue
    for (const s of detail.subtasks) {
      if (s.status === 'done') continue
      const prev = previousOf(s, detail.subtasks)
      const item: ProcessItem = {
        subtaskId: s.id,
        ref: s.ref,
        title: s.title,
        status: s.status,
        agent: s.agent,
        taskId: detail.task.id,
        taskTitle: detail.task.title,
        projectTitle: r.project_title as string,
        color: r.color as string,
        updatedAt: s.updatedAt,
        waitingFor: prev && prev.status !== 'done' ? prev.ref : null,
        promptExpanded: s.prompt ? expandPrompt(s.prompt, detail.task) : ''
      }
      if (s.agent) lanes[s.agent].push(item)
      else if (s.status === 'doing') lanes.me.push(item)
      else unassigned.push(item)
    }
  }

  const sort = (items: ProcessItem[]): ProcessItem[] =>
    items.sort((a, b) => LANE_ORDER[a.status] - LANE_ORDER[b.status] || a.updatedAt - b.updatedAt)
  for (const a of AGENTS) sort(lanes[a.id])
  sort(unassigned)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const done = db
    .prepare("SELECT COUNT(*) AS n FROM subtasks WHERE status = 'done' AND parent_id = '' AND updated_at >= ?")
    .get(today.getTime()) as Row

  return { lanes, unassigned, doneToday: Number(done.n) }
}
