import type { AgentId, Status } from './types'

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

/** 点状态圆点切到下一个：待办 → 进行中 → 已完成 → 待办；已暂停的点一下继续 */
export function nextStatus(status: Status): Status {
  return status === 'todo' ? 'active' : status === 'done' ? 'todo' : status === 'paused' ? 'active' : 'done'
}
