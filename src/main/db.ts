import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type {
  Artifact,
  Breakpoint,
  Dashboard,
  DashboardItem,
  LogEntry,
  LogSource,
  Step,
  StepStatus,
  Thread,
  ThreadDetail,
  ThreadStatus,
  ThreadSummary
} from '../shared/types'

type Row = Record<string, SQLInputValue>

let db: DatabaseSync

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS threads (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  goal          TEXT NOT NULL DEFAULT '',
  done_criteria TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active',
  breakpoint    TEXT,
  next_step_ref INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS steps (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  ref        INTEGER NOT NULL,
  position   REAL NOT NULL,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'todo',
  tool       TEXT NOT NULL DEFAULT '',
  prompt     TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS steps_thread ON steps(thread_id, position);

CREATE TABLE IF NOT EXISTS artifacts (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  step_id    TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'text',
  title      TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS artifacts_step ON artifacts(step_id, created_at);

CREATE TABLE IF NOT EXISTS logs (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_thread ON logs(thread_id, created_at);
`

export function openDb(file: string): void {
  db = new DatabaseSync(file)
  db.exec(SCHEMA)
}

// ---------- 行 → 对象 ----------

function toThread(r: Row): Thread {
  return {
    id: r.id as string,
    title: r.title as string,
    goal: r.goal as string,
    doneCriteria: r.done_criteria as string,
    status: r.status as ThreadStatus,
    breakpoint: r.breakpoint ? (JSON.parse(r.breakpoint as string) as Breakpoint) : null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  }
}

function toArtifact(r: Row): Artifact {
  return {
    id: r.id as string,
    threadId: r.thread_id as string,
    stepId: r.step_id as string,
    kind: r.kind as Artifact['kind'],
    title: r.title as string,
    content: r.content as string,
    createdAt: Number(r.created_at)
  }
}

function toStep(r: Row, outputs: Artifact[]): Step {
  return {
    id: r.id as string,
    threadId: r.thread_id as string,
    ref: Number(r.ref),
    position: Number(r.position),
    title: r.title as string,
    status: r.status as StepStatus,
    tool: r.tool as string,
    prompt: r.prompt as string,
    notes: r.notes as string,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    outputs
  }
}

function toLog(r: Row): LogEntry {
  return {
    id: r.id as string,
    threadId: r.thread_id as string,
    content: r.content as string,
    source: r.source as LogSource,
    createdAt: Number(r.created_at)
  }
}

function touchThread(threadId: string): void {
  db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(Date.now(), threadId)
}

function threadIdOf(table: 'steps' | 'artifacts' | 'logs', id: string): string | null {
  const r = db.prepare(`SELECT thread_id FROM ${table} WHERE id = ?`).get(id) as Row | undefined
  return r ? (r.thread_id as string) : null
}

// ---------- 线程 ----------

export function listThreads(): ThreadSummary[] {
  const threads = (db.prepare('SELECT * FROM threads ORDER BY updated_at DESC').all() as Row[]).map(
    toThread
  )
  const stepRows = db
    .prepare('SELECT thread_id, ref, title, status FROM steps ORDER BY position')
    .all() as Row[]

  return threads.map((t) => {
    const mine = stepRows.filter((s) => s.thread_id === t.id)
    const current = mine.find((s) => s.status !== 'done')
    return {
      ...t,
      stepTotal: mine.length,
      stepDone: mine.filter((s) => s.status === 'done').length,
      reviewCount: mine.filter((s) => s.status === 'review').length,
      currentStep: current
        ? {
            ref: Number(current.ref),
            title: current.title as string,
            status: current.status as StepStatus
          }
        : null
    }
  })
}

export function getThread(id: string): ThreadDetail | null {
  const row = db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as Row | undefined
  if (!row) return null
  const artifacts = (
    db.prepare('SELECT * FROM artifacts WHERE thread_id = ? ORDER BY created_at').all(id) as Row[]
  ).map(toArtifact)
  const steps = (
    db.prepare('SELECT * FROM steps WHERE thread_id = ? ORDER BY position').all(id) as Row[]
  ).map((r) => toStep(r, artifacts.filter((a) => a.stepId === r.id)))
  const logs = (
    db.prepare('SELECT * FROM logs WHERE thread_id = ? ORDER BY created_at DESC').all(id) as Row[]
  ).map(toLog)
  return { thread: toThread(row), steps, logs }
}

export function createThread(input: { title: string; goal?: string }): string {
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    'INSERT INTO threads (id, title, goal, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, input.title.trim() || '未命名线程', input.goal ?? '', now, now)
  return id
}

export function updateThread(
  id: string,
  patch: Partial<Pick<Thread, 'title' | 'goal' | 'doneCriteria' | 'status' | 'breakpoint'>>
): void {
  const cols: Record<string, SQLInputValue> = {}
  if (patch.title !== undefined) cols.title = patch.title
  if (patch.goal !== undefined) cols.goal = patch.goal
  if (patch.doneCriteria !== undefined) cols.done_criteria = patch.doneCriteria
  if (patch.status !== undefined) cols.status = patch.status
  if (patch.breakpoint !== undefined)
    cols.breakpoint = patch.breakpoint ? JSON.stringify(patch.breakpoint) : null
  cols.updated_at = Date.now()
  const keys = Object.keys(cols)
  db.prepare(`UPDATE threads SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
    ...keys.map((k) => cols[k]),
    id
  )
}

export function deleteThread(id: string): void {
  db.prepare('DELETE FROM threads WHERE id = ?').run(id)
}

// ---------- 步骤 ----------

export function createStep(threadId: string, input: { title: string; tool?: string }): string {
  const t = db.prepare('SELECT next_step_ref FROM threads WHERE id = ?').get(threadId) as
    | Row
    | undefined
  if (!t) throw new Error('线程不存在')
  const ref = Number(t.next_step_ref)
  const max = db
    .prepare('SELECT COALESCE(MAX(position), 0) AS p FROM steps WHERE thread_id = ?')
    .get(threadId) as Row
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO steps (id, thread_id, ref, position, title, tool, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, threadId, ref, Number(max.p) + 1, input.title.trim() || '新步骤', input.tool ?? '', now, now)
  db.prepare('UPDATE threads SET next_step_ref = ?, updated_at = ? WHERE id = ?').run(
    ref + 1,
    now,
    threadId
  )
  return id
}

export function updateStep(
  id: string,
  patch: Partial<Pick<Step, 'title' | 'status' | 'tool' | 'prompt' | 'notes'>>
): void {
  const cols: Record<string, SQLInputValue> = {}
  for (const k of ['title', 'status', 'tool', 'prompt', 'notes'] as const) {
    if (patch[k] !== undefined) cols[k] = patch[k]
  }
  cols.updated_at = Date.now()
  const keys = Object.keys(cols)
  db.prepare(`UPDATE steps SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
    ...keys.map((k) => cols[k]),
    id
  )
  const threadId = threadIdOf('steps', id)
  if (threadId) touchThread(threadId)
}

/** 和上一个/下一个步骤交换位置 */
export function moveStep(id: string, direction: -1 | 1): void {
  const me = db.prepare('SELECT thread_id, position FROM steps WHERE id = ?').get(id) as
    | Row
    | undefined
  if (!me) return
  const neighbor = db
    .prepare(
      direction < 0
        ? 'SELECT id, position FROM steps WHERE thread_id = ? AND position < ? ORDER BY position DESC LIMIT 1'
        : 'SELECT id, position FROM steps WHERE thread_id = ? AND position > ? ORDER BY position ASC LIMIT 1'
    )
    .get(me.thread_id, me.position) as Row | undefined
  if (!neighbor) return
  const swap = db.prepare('UPDATE steps SET position = ? WHERE id = ?')
  swap.run(neighbor.position, id)
  swap.run(me.position, neighbor.id)
  touchThread(me.thread_id as string)
}

export function deleteStep(id: string): void {
  const threadId = threadIdOf('steps', id)
  db.prepare('DELETE FROM steps WHERE id = ?').run(id)
  if (threadId) touchThread(threadId)
}

// ---------- 产物 ----------

export function createArtifact(input: {
  threadId: string
  stepId: string
  kind: Artifact['kind']
  title: string
  content: string
}): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO artifacts (id, thread_id, step_id, kind, title, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.threadId, input.stepId, input.kind, input.title, input.content, Date.now())
  touchThread(input.threadId)
  return id
}

export function deleteArtifact(id: string): void {
  const threadId = threadIdOf('artifacts', id)
  db.prepare('DELETE FROM artifacts WHERE id = ?').run(id)
  if (threadId) touchThread(threadId)
}

// ---------- 记录 ----------

export function createLog(input: { threadId: string; content: string; source: LogSource }): string {
  const id = randomUUID()
  db.prepare(
    'INSERT INTO logs (id, thread_id, content, source, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, input.threadId, input.content, input.source, Date.now())
  touchThread(input.threadId)
  return id
}

export function deleteLog(id: string): void {
  db.prepare('DELETE FROM logs WHERE id = ?').run(id)
}

// ---------- 总览 ----------

export function dashboard(): Dashboard {
  const rows = db
    .prepare(
      `SELECT s.id, s.ref, s.title, s.tool, s.status, s.updated_at, t.id AS thread_id, t.title AS thread_title
       FROM steps s JOIN threads t ON t.id = s.thread_id
       WHERE t.status = 'active' AND s.status IN ('review', 'ai_running', 'doing')
       ORDER BY s.updated_at ASC`
    )
    .all() as Row[]
  const pick = (status: StepStatus): DashboardItem[] =>
    rows
      .filter((r) => r.status === status)
      .map((r) => ({
        stepId: r.id as string,
        stepRef: Number(r.ref),
        stepTitle: r.title as string,
        tool: r.tool as string,
        threadId: r.thread_id as string,
        threadTitle: r.thread_title as string,
        updatedAt: Number(r.updated_at)
      }))
  return { review: pick('review'), running: pick('ai_running'), doing: pick('doing') }
}
