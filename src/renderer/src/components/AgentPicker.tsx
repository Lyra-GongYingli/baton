import { useRef, useState } from 'react'
import { AGENTS } from '../../../shared/agents'
import type { Assignee, LiveState } from '../../../shared/types'
import { cx } from '../util'
import { AgentIcon } from './AgentIcon'
import { PopMenu } from './PopMenu'

/** 点头像弹出执行者列表 */
export function AgentPicker({
  value,
  onChange,
  size = 22,
  busy,
  live,
  align = 'right'
}: {
  value: Assignee
  onChange: (agent: Assignee) => void
  size?: number
  busy?: boolean
  live?: LiveState
  align?: 'left' | 'right'
}) {
  // 点开时量一下头像的位置，菜单贴着它弹出
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const pick = (agent: Assignee): void => {
    onChange(agent)
    setAnchor(null)
  }

  return (
    <div ref={box} className="agent-picker" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <button
        className="agent-picker-btn"
        title="谁来做？"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
      >
        <AgentIcon agent={value} size={size} busy={busy} live={live} />
      </button>
      {anchor && (
        <PopMenu anchor={anchor} owner={box} align={align} onClose={() => setAnchor(null)}>
          {AGENTS.map((a) => (
            <button key={a.id} className={cx('agent-option', value === a.id && 'active')} onClick={() => pick(a.id)}>
              <AgentIcon agent={a.id} size={22} />
              {a.name}
            </button>
          ))}
          <button className={cx('agent-option', value === '' && 'active')} onClick={() => pick('')}>
            <AgentIcon agent="" size={22} />
            未分配
          </button>
        </PopMenu>
      )}
    </div>
  )
}
