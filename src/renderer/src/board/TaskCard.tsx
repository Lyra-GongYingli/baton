import type { CSSProperties } from 'react'
import { expandPrompt } from '../../../shared/prompt'
import { STATUS_LABEL, type SubtaskBrief, type TaskSummary } from '../../../shared/types'
import { api } from '../api'
import { AgentIcon } from '../components/AgentIcon'
import { Copyable, useDelayedClick } from '../components/Copy'
import type { DragHandle } from '../components/Sortable'
import { openStatusMenu } from '../components/StatusMenu'
import { StatusGlyph, TaskStatusPicker } from '../components/StatusPicker'
import { PromptPill, tiltOf, toast, Track, useDropTarget } from '../dock/parts'
import { DateChip } from '../components/DatePicker'
import { cx, titleFromText } from '../util'

/** 整张任务卡带的提示词：任务自己的，没有就用当前子任务（第一个没做完的）的 */
export function cardPrompt(t: TaskSummary): string {
  if (t.prompt) return expandPrompt(t.prompt, t)
  return t.current ? t.currentPrompt : ''
}

/**
 * 夹在洞洞板上的任务卡。单击打开，双击标题复制，按住拖动排序，把文字拖上来变成一个新子任务；
 * 有提示词的卡按住拖到 ChatGPT / Claude 等别的软件的输入框，松手就把提示词粘进去
 */
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
  const copyText = cardPrompt(t)
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
        draggable={drag?.draggable || undefined}
        {...drop.props}
      >
        <span className="tcard-clip" />
        <div className="tcard-head">
          <Copyable className="tcard-title">{t.title}</Copyable>
          <TaskStatusPicker taskId={t.id} value={t.status} />
          {copyText && <PromptPill text={copyText} />}
        </div>
        <Track statuses={t.statuses} />
        {t.subtasks.length > 0 ? (
          <ol className="tcard-subs">
            {t.subtasks.map((s) => (
              <SubRow key={s.id} s={s} label={`S${s.ref}`} current={s.id === t.current?.id} />
            ))}
          </ol>
        ) : (
          <div className="tcard-now">
            <span className="muted">还没有子任务，点进来加第一个</span>
          </div>
        )}
        {drop.over && <div className="tcard-drop">松手，变成一个新子任务</div>}
      </div>
    </div>
  )
}

/**
 * 卡片上的一个子任务（子子任务缩进挂在它下面）：状态、编号、标题、谁在做。
 * 排了日子的显示哪天做，当前那个没排也留着日期按钮，点一下就能改
 */
function SubRow({ s, label, current }: { s: SubtaskBrief; label: string; current?: boolean }) {
  const done = s.status === 'done'
  return (
    <li className={cx('tcard-sub', `t-${s.status}`, current && 'current')}>
      <div className="tcard-sub-row" title={STATUS_LABEL[s.status]}>
        <StatusGlyph status={s.status} />
        <b>{label}</b>
        <Copyable className="tcard-sub-title">{s.title}</Copyable>
        {s.agent && <AgentIcon agent={s.agent} size={15} busy={s.status === 'active'} />}
        {!done && (s.scheduledOn || current) && (
          <DateChip
            value={s.scheduledOn}
            title={`${label} 哪天做：点一下改`}
            onChange={(day) => api.updateSubtask(s.id, { scheduledOn: day })}
          />
        )}
      </div>
      {s.children.length > 0 && (
        <ol className="tcard-subs nested">
          {s.children.map((c, i) => (
            <SubRow key={c.id} s={c} label={`${label}.${i + 1}`} />
          ))}
        </ol>
      )}
    </li>
  )
}
