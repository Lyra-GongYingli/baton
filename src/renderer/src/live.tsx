import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Assignee, LiveBoard, LiveSession, LiveState, Status } from '../../shared/types'
import { api, onMainEvent } from './api'
import { AgentIcon } from './components/AgentIcon'

// AI 在跑什么（Claude Code、Codex 通过 hooks 报给 Baton 的）：每个窗口在最外层读一份，下面的行按任务 / 子任务 id 来查

const EMPTY: LiveBoard = { enabled: { claude: false, codex: false }, sessions: [] }
const LiveContext = createContext<LiveBoard>(EMPTY)

export function LiveProvider({ children }: { children: ReactNode }) {
  const [board, setBoard] = useState<LiveBoard>(EMPTY)
  useEffect(() => {
    const load = (): void => {
      api.liveBoard().then(setBoard)
    }
    load()
    // 会话变了要重读；任务改名、改状态、删掉了，会话列表里写的也跟着变
    const offLive = onMainEvent('live-changed', load)
    const offData = onMainEvent('data-changed', load)
    return () => {
      offLive()
      offData()
    }
  }, [])
  return <LiveContext.Provider value={board}>{children}</LiveContext.Provider>
}

export function useLiveBoard(): LiveBoard {
  return useContext(LiveContext)
}

const RANK: Record<LiveState, number> = { running: 3, waiting: 2, idle: 1 }

/** 归到这一项上的会话里最要紧的那个：正在跑 > 等你批准 > 等你看。没有是 null */
export function useLiveOf(itemId: string): LiveSession | null {
  const { sessions } = useContext(LiveContext)
  let best: LiveSession | null = null
  for (const s of sessions) {
    if (s.item?.id !== itemId) continue
    if (!best || RANK[s.state] > RANK[best.state] || (RANK[s.state] === RANK[best.state] && s.updatedAt > best.updatedAt)) {
      best = s
    }
  }
  return best
}

/**
 * 会话是不是这个执行者在跑。不是的话（比如做完的子任务又被别的 AI 拿去问），执行者的头像不跟着动，
 * 旁边另外画一个会话的头像（LiveMark）
 */
export function ownLive(live: LiveSession | null, agent: Assignee): LiveSession | null {
  return live && live.agent === agent ? live : null
}

/** 头像上提示什么；已经做完的那一项，跑完一轮的「等你看」就不提示了 */
export function shownState(live: LiveSession | null, status: Status): LiveState | undefined {
  if (!live || (live.state === 'idle' && status === 'done')) return undefined
  return live.state
}

/**
 * 头像动不动：有会话归到这一项上，看它是不是正在跑；
 * 接入了自动检测的 AI 没有会话在做这一项，就不动；其他的（Muse、我、没接入的）照旧，进行中就动
 */
export function busyOf(enabled: LiveBoard['enabled'], agent: Assignee, status: Status, live: LiveSession | null): boolean {
  if (live) return live.state === 'running'
  if ((agent === 'claude' || agent === 'codex') && enabled[agent]) return false
  return status === 'active'
}

/** 归到这一项上的 AI 会话：一个小头像，正在跑时动，等你批准亮黄点，跑完一轮亮蓝点。没有会话就什么也不画 */
export function LiveMark({ itemId, status, size = 15 }: { itemId: string; status: Status; size?: number }) {
  const live = useLiveOf(itemId)
  const state = shownState(live, status)
  if (!live || !state) return null
  return <AgentIcon agent={live.agent} size={size} busy={state === 'running'} live={state} />
}
