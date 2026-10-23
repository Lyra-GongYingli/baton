import { useEffect, useRef, useState } from 'react'
import { TASK_STATUS_LABEL, TASK_STATUS_ORDER, type TaskStatus } from '../../../shared/types'
import { api } from '../api'
import { cx } from '../util'

/** 任务的状态标签：点开换成 待办 / 进行中 / 已暂停 / 已完成 */
export function TaskStatusPicker({ taskId, value }: { taskId: string; value: TaskStatus }) {
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
      className="task-status"
      ref={ref}
      // 不要触发卡片的打开、拖动
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button className={cx('task-status-chip', `t-${value}`)} title="跟着子任务的进度自动变化，也可以点一下手动改（已暂停不会被自动改掉）" onClick={() => setOpen(!open)}>
        <i />
        {TASK_STATUS_LABEL[value]}
      </button>
      {open && (
        <div className="agent-menu align-right">
          {TASK_STATUS_ORDER.map((s) => (
            <button
              key={s}
              className={cx('agent-option', `t-${s}`, s === value && 'active')}
              onClick={() => {
                api.updateTask(taskId, { status: s })
                setOpen(false)
              }}
            >
              <i className="task-status-dot" />
              {TASK_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
