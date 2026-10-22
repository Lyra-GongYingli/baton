import type { CSSProperties } from 'react'
import { expandPrompt } from '../../../shared/prompt'
import { STATUS_LABEL, type TaskSummary } from '../../../shared/types'
import { api } from '../api'
import { AgentIcon } from '../components/AgentIcon'
import { Copyable, useDelayedClick } from '../components/Copy'
import type { DragHandle } from '../components/Sortable'
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
  const style = { '--c': t.color, '--tilt': tiltOf(t.id), '--i': index } as CSSProperties

  return (
    <div ref={drag?.setNodeRef} style={drag?.style} className={cx('tcard-slot', drag?.isDragging && 'lifted')}>
      <div
        className={cx('tcard', t.status === 'paused' && 'paused', drop.over && 'drop-over')}
        style={style}
        onClick={click.onClick}
        {...drag?.attributes}
        {...drag?.listeners}
        {...drop.props}
      >
        <span className="tcard-clip" />
        <div className="tcard-head">
          <Copyable className="tcard-title">{t.title}</Copyable>
            <span className="tcard-time">{t.status === 'paused' ? '已暂停' : timeAgo(t.updatedAt)}</span>
        </div>
        <Track statuses={t.statuses} />
        <div className="tcard-now">
          {t.current ? (
            <>
              <AgentIcon agent={t.current.agent} size={18} busy={busy} />
              <b>S{t.current.ref}</b>
              <Copyable>{t.current.title}</Copyable>
              <span className={cx('now-status', `s-${t.current.status}`)}>{STATUS_LABEL[t.current.status]}</span>
            </>
          ) : t.subtaskTotal > 0 ? (
            '全部完成，可以收棒了 🏁'
          ) : (
            <span className="muted">还没有子任务，点进来加第一个</span>
          )}
        </div>
        {t.prompt ? (
          <div className="tcard-actions">
            <PromptPill text={expandPrompt(t.prompt, t)} label="复制任务提示词" />
          </div>
        ) : (
          t.currentPrompt &&
          t.current && (
            <div className="tcard-actions">
              <PromptPill text={t.currentPrompt} label={`复制 S${t.current.ref} 提示词`} />
            </div>
          )
        )}
        {drop.over && <div className="tcard-drop">松手，变成一个新子任务</div>}
      </div>
    </div>
  )
}
