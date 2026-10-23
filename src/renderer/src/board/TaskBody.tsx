import { spanLabel, today } from '../../../shared/dates'
import { expandPrompt } from '../../../shared/prompt'
import type { Subtask, TaskDetail } from '../../../shared/types'
import { api } from '../api'
import { InlineEdit } from '../components/InlineEdit'
import { PromptBox } from '../components/PromptBox'
import { cx } from '../util'
import { SubtaskRoute } from './SubtaskRoute'

/**
 * 任务的正文：标题、目标、任务提示词、子任务 list。
 * 侧边栏的任务页和晾衣绳上的任务卡片共用这一份，管理功能完全一样；compact 是晾衣绳上的紧凑版。
 */
export function TaskBody({ detail, compact }: { detail: TaskDetail; compact?: boolean }) {
  const { task, subtasks } = detail
  const done = subtasks.filter((s) => s.status === 'done').length

  return (
    <div className={cx('task-body', compact && 'compact')}>
      <h2 className="dtask-title">
        <InlineEdit value={task.title} placeholder="任务名" onSave={(title) => api.updateTask(task.id, { title })} />
      </h2>
      <div className="dtask-goal">
        <InlineEdit value={task.goal} placeholder="写个目标（可选）" onSave={(goal) => api.updateTask(task.id, { goal })} />
      </div>

      <div className="task-prompt">
        {!compact && <div className="dsection-title">任务提示词</div>}
        <PromptBox
          mini={compact}
          value={task.prompt}
          placeholder={compact ? '＋ 任务提示词' : '点这里填这个任务的提示词…'}
          copyText={expandPrompt(task.prompt, task)}
          onSave={(prompt) => api.updateTask(task.id, { prompt })}
        />
      </div>

      <div className="dsection-title">
        子任务
        <span className="muted">
          {done}/{subtasks.length}
        </span>
        <TaskSpanLabel subtasks={subtasks} />
        {!compact && (
          <span className="legend">
            <i className="lg-chain" />
            接力
            <i className="lg-solo" />
            独立
          </span>
        )}
      </div>
      <SubtaskRoute detail={detail} compact={compact} />

      {!compact && (
        <p className="dtask-tip">
          提示词点一下就能写，双击复制。把文字拖到这里会新建一个子任务；拖到某个子任务上，会变成它的子子任务。
        </p>
      )}
    </div>
  )
}

/** 任务的时间：没做完的子任务排在哪几天（最早 – 最晚）；有排在今天以前的标逾期 */
export function TaskSpanLabel({ subtasks }: { subtasks: Subtask[] }) {
  const days = subtasks
    .filter((s) => s.status !== 'done' && s.scheduledOn)
    .map((s) => s.scheduledOn)
    .sort()
  if (days.length === 0) return null
  const overdue = days[0] < today()
  return (
    <span className={cx('task-span', overdue && 'overdue')}>
      {spanLabel(days[0], days[days.length - 1])}
      {overdue && ' · 逾期'}
    </span>
  )
}
