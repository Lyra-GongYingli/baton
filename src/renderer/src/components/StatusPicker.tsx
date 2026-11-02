import { useRef, useState } from 'react'
import { STATUS_LABEL, STATUS_ORDER, type Status } from '../../../shared/types'
import { api } from '../api'
import { cx } from '../util'
import { PopMenu } from './PopMenu'

/** 状态的小图形：待办 空心圈 / 进行中 跳动的实心点 / 已暂停 两道竖线 / 已完成 对勾 */
export function StatusGlyph({ status }: { status: Status }) {
  return <i className={cx('status-glyph', `t-${status}`)} />
}

/**
 * 状态标签：任务、子任务、子子任务都用它。点开在 待办 / 进行中 / 已暂停 / 已完成 之间换。
 * small 用在子子任务这种挤的地方。
 */
export function StatusPicker({
  value,
  onChange,
  small,
  title = '点一下换状态'
}: {
  value: Status
  onChange: (status: Status) => void
  small?: boolean
  title?: string
}) {
  // 点开时量一下标签的位置，菜单贴着它弹出
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const box = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={box}
      className={cx('task-status', small && 'small')}
      // 不要触发卡片的打开、拖动、就地编辑
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        className={cx('task-status-chip', `t-${value}`)}
        title={title}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
      >
        <StatusGlyph status={value} />
        {STATUS_LABEL[value]}
      </button>
      {anchor && (
        <PopMenu anchor={anchor} owner={box} align="right" className="status-menu" onClose={() => setAnchor(null)}>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              className={cx('agent-option', `t-${s}`, s === value && 'active')}
              onClick={() => {
                if (s !== value) onChange(s)
                setAnchor(null)
              }}
            >
              <StatusGlyph status={s} />
              {STATUS_LABEL[s]}
            </button>
          ))}
        </PopMenu>
      )}
    </div>
  )
}

/** 任务的状态标签 */
export function TaskStatusPicker({ taskId, value }: { taskId: string; value: Status }) {
  return (
    <StatusPicker
      value={value}
      title="跟着子任务的进度自动变化，也可以点一下手动改（已暂停不会被自动改掉）"
      onChange={(status) => api.updateTask(taskId, { status })}
    />
  )
}
