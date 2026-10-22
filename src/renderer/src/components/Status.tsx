import { STEP_STATUS_LABEL, STEP_STATUS_ORDER, type StepStatus } from '../../../shared/types'
import { cx } from '../util'

export function StatusDot({ status }: { status: StepStatus }) {
  return <span className={cx('status-dot', `s-${status}`)} />
}

export function StatusPill({ status }: { status: StepStatus }) {
  return (
    <span className={cx('status-pill', `s-${status}`)}>
      <StatusDot status={status} />
      {STEP_STATUS_LABEL[status]}
    </span>
  )
}

/** 一排按钮切换步骤状态 */
export function StatusPicker({
  value,
  onChange
}: {
  value: StepStatus
  onChange: (s: StepStatus) => void
}) {
  return (
    <div className="status-picker">
      {STEP_STATUS_ORDER.map((s) => (
        <button
          key={s}
          className={cx('status-option', `s-${s}`, s === value && 'active')}
          onClick={() => onChange(s)}
        >
          <StatusDot status={s} />
          {STEP_STATUS_LABEL[s]}
        </button>
      ))}
    </div>
  )
}
