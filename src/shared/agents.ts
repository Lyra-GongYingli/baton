import type { AgentId, SubtaskStatus } from './types'

export interface AgentInfo {
  id: AgentId
  name: string
  kind: 'ai' | 'human'
  color: string
}

/** 执行者：三个 AI 代理 + 我自己（一只猫） */
export const AGENTS: AgentInfo[] = [
  { id: 'claude', name: 'Claude', kind: 'ai', color: '#D97757' },
  { id: 'codex', name: 'Codex', kind: 'ai', color: '#1F1F1F' },
  { id: 'muse', name: 'Muse', kind: 'ai', color: '#A855F7' },
  { id: 'me', name: '我', kind: 'human', color: '#F59E0B' }
]

export const AGENT_BY_ID = Object.fromEntries(AGENTS.map((a) => [a.id, a])) as Record<AgentId, AgentInfo>

/**
 * 把子任务交给某个执行者后，状态顺势变成什么：
 * 交给 AI → AI 在跑；交给我 → 我在做；取消分配 → 待办；已完成的不变。
 */
export function statusAfterAssign(agent: AgentId | '', status: SubtaskStatus): SubtaskStatus {
  if (status === 'done') return 'done'
  if (agent === '') return 'todo'
  return agent === 'me' ? 'doing' : 'ai_running'
}

/**
 * 点子任务的圆点切到下一个状态：
 * 分给 AI 的：待办 → AI 在跑 → 完成；分给我或没分配的：待办 → 我在做 → 完成。
 */
export function nextStatus(agent: AgentId | '', status: SubtaskStatus): SubtaskStatus {
  const cycle: SubtaskStatus[] = agent && agent !== 'me' ? ['todo', 'ai_running', 'done'] : ['todo', 'doing', 'done']
  const i = cycle.indexOf(status)
  return i < 0 ? 'done' : cycle[(i + 1) % cycle.length]
}
