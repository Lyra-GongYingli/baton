import type { CSSProperties } from 'react'
import { expandPrompt } from '../../../shared/prompt'
import { STATUS_LABEL, type TaskSummary } from '../../../shared/types'
import { api } from '../api'
import { AgentIcon } from '../components/AgentIcon'
import { Copyable, useDelayedClick } from '../components/Copy'
import type { DragHandle } from '../components/Sortable'
import { openStatusMenu } from '../components/StatusMenu'
import { StatusGlyph, TaskStatusPicker } from '../components/StatusPicker'
import { PromptPill, tiltOf, toast, Track, useDropTarget } from '../dock/parts'
import { dayLabel } from '../../../shared/dates'
import { DateChip } from '../components/DatePicker'
import { cx, titleFromText } from '../util'

/** 夹在洞洞板上的任务卡。单击打开，双击标题复制，按住拖动排序，把文字拖上来变成一个新子任务 */
export function TaskCard({
  task: t,
  index,
  onOpen,
  drag
}: {
  task: TaskSummary
  index: number
  onOpen: () => void
  drag?: DragHandle
}) {
  // 拖进来的文字 = 一个新子任务，文字就是它的提示词
  const drop = useDropTarget(async (text) => {
    await api.createSubtask(t.id, { title: titleFromText(text), prompt: text })
    toast(`✓ 在「${t.title}」里加了一个子任务`)
  })
  const click = useDelayedClick(onOpen)
  // 复制图标：优先任务提示词，没有就复制当前子任务的
  const copy = t.prompt
    ? { text: expandPrompt(t.prompt, t), label: '复制任务提示词' }
    : t.currentPrompt && t.current
      ? { text: t.currentPrompt, label: `复制 S${t.current.ref} 提示词` }
      : null
  const style = { '--c': t.color, '--tilt': tiltOf(t.id), '--i': index } as CSSProperties

  return (
    <div ref={drag?.setNodeRef} style={drag?.style} className={cx('tcard-slot', drag?.isDragging && 'lifted')}>
      <div
        className={cx('tcard', `t-${t.status}`, drop.over && 'drop-over')}
        style={style}
        onClick={click.onClick}
        onContextMenu={(e) =>
          openStatusMenu(e, {
            title: t.title,
            value: t.status,
            onChange: (status) => api.updateTask(t.id, { status }),
            actions: [{ label: '打开', onClick: onOpen }]
          })
        }
        {...drag?.attributes}
        {...drag?.listeners}
        {...drop.props}
      >
        <span className="tcard-clip" />
        <div className="tcard-head">
          <Copyable className="tcard-title">{t.title}</Copyable>
          <TaskStatusPicker taskId={t.id} value={t.status} />
          {copy && <PromptPill text={copy.text} label={undefined} />}
        </div>
        <Track statuses={t.statuses} />
        <div className="tcard-now">
          {t.current ? (
            <>
              <span className={cx('now-status', `t-${t.current.status}`)}>
                <StatusGlyph status={t.current.status} />
                {STATUS_LABEL[t.current.status]}
              </span>
              <b>S{t.current.ref}</b>
              <Copyable>{t.current.title}</Copyable>
              {t.current.agent && <AgentIcon agent={t.current.agent} size={15} busy={t.current.status === 'active'} />}
            </>
          ) : t.subtaskTotal > 0 ? (
            '子任务都完成了 🏁'
          ) : (
            <span className="muted">还没有子任务，点进来加第一个</span>
          )}
          <TaskSpan task={t} />
        </div>
        {drop.over && <div className="tcard-drop">松手，变成一个新子任务</div>}
      </div>
    </div>
  )
}

/**
 * 卡片右下角：当前那个子任务（同一行左边写着的 Sx）哪天做，点一下就能改。
 * 后面还有排得更晚的子任务时，跟一个淡淡的「→ 10/28」，告诉你整个任务排到哪天。
 */
export function TaskSpan({ task: t }: { task: TaskSummary }) {
  const cur = t.current
  if (!cur) return null
  const later = t.span && t.span.to > (cur.scheduledOn || t.span.to) ? t.span.to : ''
  return (
    <span className="tcard-time" title={t.unscheduled ? `还有 ${t.unscheduled} 个子任务没排日子` : undefined}>
      <DateChip
        value={cur.scheduledOn}
        title={`S${cur.ref} 哪天做：点一下改`}
        onChange={(day) => api.updateSubtask(cur.id, { scheduledOn: day })}
      />
      {later && <span className="tcard-later">→ {dayLabel(later)}</span>}
    </span>
  )
}
