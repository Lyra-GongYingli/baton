import { basename } from 'node:path'
import { AGENT_BY_ID } from '../shared/agents'
import type { Assignee, HookAgent, LiveBoard, Status } from '../shared/types'
import * as db from './db'

// AI 在跑什么：Claude Code、Codex 通过 hooks 把每个会话的动静报给 Baton（怎么接的见 agentHooks.ts）。
// 会话发出去的话里认出 Baton 的提示词，就把这个会话归到那个任务 / 子任务 / 子子任务上：
//   开始跑 → 那一项是待办或已暂停的，改成进行中；子任务的执行者换成这个 AI
//   停下来等你批准、这一轮跑完 → 只在头像上提示，不会自动标成完成（AI 停下不等于做完了）
// 会话存在数据库里，Baton 重启后还认得；关掉的会话过一会儿自己消失。

/** hooks 发来的 JSON：Claude Code 和 Codex 的字段名一样，这里只取用得上的 */
export interface HookPayload {
  hook_event_name?: string
  session_id?: string
  cwd?: string
  prompt?: string
  /** 子代理里发生的事件才有 */
  agent_id?: string
  notification_type?: string
}

interface Callbacks {
  /** 会话列表变了：界面重新读一次 */
  onLive: () => void
  /** 改了任务数据（状态、执行者） */
  onData: () => void
  /** 冒一条提示 */
  onNotice: (text: string) => void
}

let cb: Callbacks = { onLive: () => {}, onData: () => {}, onNotice: () => {} }

/** 在跑的会话这么久没动静（比如被你中途打断了，收不到「停下」），就当它停了 */
const RUNNING_QUIET = 30 * 60_000
/** 这么久没动静的会话就忘掉 */
const FORGET = 12 * 3600_000

export function startLive(callbacks: Callbacks): void {
  cb = callbacks
  sweep()
  setInterval(sweep, 60_000)
}

export function handleHook(agent: HookAgent, p: HookPayload, pid: number): void {
  const sessionId = p.session_id
  if (!sessionId) return
  if (p.hook_event_name === 'SessionEnd') {
    if (db.deleteAgentSession(agent, sessionId)) cb.onLive()
    return
  }
  const now = Date.now()
  const old = db.getAgentSession(agent, sessionId)
  const s: db.AgentSessionRow = old
    ? { ...old, updatedAt: now }
    : { agent, sessionId, itemId: '', state: 'idle', cwd: '', snippet: '', pid: 0, pidOk: false, startedAt: now, updatedAt: now }
  if (p.cwd) s.cwd = p.cwd
  if (pid > 0) {
    s.pidOk = pid === s.pid
    s.pid = pid
  }

  let started = false
  switch (p.hook_event_name) {
    case 'UserPromptSubmit': {
      // 子代理之间传的话不是你发的，不拿来认
      if (p.agent_id) break
      s.state = 'running'
      started = true
      const prompt = p.prompt ?? ''
      if (!s.snippet) s.snippet = prompt.replace(/\s+/g, ' ').trim().slice(0, 60)
      const hit = recognize(prompt)
      if (hit && hit !== s.itemId) {
        s.itemId = hit
        announce(agent, hit)
      }
      break
    }
    case 'PostToolUse':
      s.state = 'running'
      break
    case 'PermissionRequest':
      s.state = 'waiting'
      break
    case 'Notification':
      // 只有 Claude Code 有：等你批准、等你回答问题；空等了一分钟以上
      if (p.notification_type === 'permission_prompt' || p.notification_type === 'elicitation_dialog') s.state = 'waiting'
      else if (p.notification_type === 'idle_prompt') s.state = 'idle'
      break
    case 'Stop':
      if (!p.agent_id) s.state = 'idle'
      break
  }

  db.saveAgentSession(s)
  if (started && s.itemId && claim(s.itemId, agent, true)) cb.onData()
  if (!old || old.state !== s.state || old.itemId !== s.itemId) cb.onLive()
}

/** 手动把会话归到某一项上（itemId 空字符串 = 解绑）。执行者换成这个 AI；正在跑的话，那一项跟着改成进行中 */
export function bindSession(agent: HookAgent, sessionId: string, itemId: string): void {
  const s = db.getAgentSession(agent, sessionId)
  if (!s || s.itemId === itemId) return
  db.saveAgentSession({ ...s, itemId })
  if (itemId && claim(itemId, agent, s.state !== 'idle')) cb.onData()
  cb.onLive()
}

export function liveBoard(enabled: LiveBoard['enabled']): LiveBoard {
  return {
    enabled,
    sessions: db.listAgentSessions().map((s) => ({
      agent: s.agent,
      sessionId: s.sessionId,
      state: s.state,
      item: s.itemId ? db.liveItem(s.itemId) : null,
      folder: s.cwd ? basename(s.cwd) : '',
      snippet: s.snippet,
      startedAt: s.startedAt,
      updatedAt: s.updatedAt
    }))
  }
}

// ---------- 认出是哪个任务 ----------

const norm = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase()

/** 四个字一组切开（中文、英文都适用），用来比两段话有多少是一样的 */
function grams(text: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i + 4 <= text.length; i++) out.add(text.slice(i, i + 4))
  return out
}

/**
 * 发出去的这段话里有没有 Baton 的提示词：
 * 整条都在里面的（拖进去、复制过去，前后再补几句也算），取最长、最具体的那条；
 * 都不在的话，八成以上的字句对得上的也算（粘过去以后改了几个字）。认不出来是 null
 */
function recognize(prompt: string): string | null {
  const said = norm(prompt)
  if (said.length < 8) return null
  let saidGrams: Set<string> | null = null
  let best: { id: string; score: number } | null = null
  for (const c of db.promptCandidates()) {
    const text = norm(c.text)
    if (text.length < 8) continue
    let score = 0
    if (said.includes(text)) {
      score = 2 + text.length / 1e7
    } else if (text.length >= 30) {
      saidGrams ??= grams(said)
      const mine = grams(text)
      let same = 0
      for (const g of mine) if (saidGrams.has(g)) same++
      if (same / mine.size >= 0.8) score = same / mine.size
    }
    if (score > (best?.score ?? 0)) best = { id: c.id, score }
  }
  return best?.id ?? null
}

/**
 * 会话归到这一项上：子任务的执行者换成这个 AI；正在跑（start）的话，待办或已暂停的改成进行中。
 * 已经完成的不动（做完以后又问几句，不算重新开始）。改了数据返回 true
 */
function claim(itemId: string, agent: HookAgent, start: boolean): boolean {
  const item = db.itemState(itemId)
  if (!item) return false
  const wake = start && (item.status === 'todo' || item.status === 'paused')
  if (item.kind === 'task') {
    if (wake) db.updateTask(itemId, { status: 'active' })
    return wake
  }
  const patch: { status?: Status; agent?: Assignee } = {}
  if (wake) patch.status = 'active'
  // 子子任务不分人
  if (!item.parentId && item.agent !== agent && item.status !== 'done') patch.agent = agent
  if (!patch.status && !patch.agent) return false
  db.updateSubtask(itemId, patch)
  return true
}

function announce(agent: HookAgent, itemId: string): void {
  const item = db.liveItem(itemId)
  if (!item) return
  const what = item.kind === 'task' ? `「${item.title}」` : `${item.label}「${item.title}」`
  cb.onNotice(`认出来了：${AGENT_BY_ID[agent].name} 在做${what}`)
}

// ---------- 会话还在不在 ----------

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // 进程还在、只是不让发信号
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** 每分钟看一遍：进程没了的、很久没动静的会话忘掉；跑着跑着没了动静的，当它停了 */
function sweep(): void {
  const now = Date.now()
  let changed = false
  for (const s of db.listAgentSessions()) {
    if ((s.pidOk && !alive(s.pid)) || now - s.updatedAt > FORGET) {
      db.deleteAgentSession(s.agent, s.sessionId)
      changed = true
    } else if (s.state === 'running' && now - s.updatedAt > RUNNING_QUIET) {
      db.saveAgentSession({ ...s, state: 'idle' })
      changed = true
    }
  }
  if (changed) cb.onLive()
}
