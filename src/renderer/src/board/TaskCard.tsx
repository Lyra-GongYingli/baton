import type { CSSProperties } from 'react'
import { expandPrompt } from '../../../shared/prompt'
import { STATUS_LABEL, type TaskSummary } from '../../../shared/types'
import { api } from '../api'
import { AgentIcon } from '../components/AgentIcon'
import { Copyable, useDelayedClick } from '../components/Copy'
import type { DragHandle } from '../components/Sortable'
import { TaskStatusPicker } from '../components/TaskStatusPicker'
import { PromptPill, tiltOf, toast, Track, useDropTarget } from '../dock/parts'
import { cx, timeAgo, titleFromText } from '../util'

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
  const busy = t.current?.status === 'ai_running' || t.current?.status === 'doing'
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
              <AgentIcon agent={t.current.agent} size={16} busy={busy} />
              <b>S{t.current.ref}</b>
              <Copyable>{t.current.title}</Copyable>
              <span className={cx('now-status', `s-${t.current.status}`)}>{STATUS_LABEL[t.current.status]}</span>
            </>
          ) : t.subtaskTotal > 0 ? (
            '子任务都完成了 🏁'
          ) : (
            <span className="muted">还没有子任务，点进来加第一个</span>
          )}
          <span className="tcard-time">{timeAgo(t.updatedAt)}</span>
        </div>
        {drop.over && <div className="tcard-drop">松手，变成一个新子任务</div>}
      </div>
    </div>
  )
}
