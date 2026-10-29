import { useEffect, useRef, useState } from 'react'
import { AGENTS } from '../../../shared/agents'
import type { Assignee, LiveState } from '../../../shared/types'
import { cx } from '../util'
import { AgentIcon } from './AgentIcon'

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
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div
      className="agent-picker"
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button className="agent-picker-btn" title="谁来做？" onClick={() => setOpen(!open)}>
        <AgentIcon agent={value} size={size} busy={busy} live={live} />
      </button>
      {open && (
        <div className={cx('agent-menu', `align-${align}`)}>
          {AGENTS.map((a) => (
            <button
              key={a.id}
              className={cx('agent-option', value === a.id && 'active')}
              onClick={() => {
                onChange(a.id)
                setOpen(false)
              }}
            >
              <AgentIcon agent={a.id} size={22} />
              {a.name}
            </button>
          ))}
          <button
            className={cx('agent-option', value === '' && 'active')}
            onClick={() => {
              onChange('')
              setOpen(false)
            }}
          >
            <AgentIcon agent="" size={22} />
            未分配
          </button>
        </div>
      )}
    </div>
  )
}
