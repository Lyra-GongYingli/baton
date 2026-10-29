import type { CSSProperties } from 'react'
import { nextStatus } from '../../../shared/agents'
import { expandPrompt } from '../../../shared/prompt'
import { STATUS_LABEL, type SubtaskBrief, type TaskSummary } from '../../../shared/types'
import { api } from '../api'
import { AgentIcon } from '../components/AgentIcon'
import { Copyable, useDelayedClick } from '../components/Copy'
import { promptDrag, type DragHandle } from '../components/Sortable'
import { openStatusMenu } from '../components/StatusMenu'
import { StatusGlyph, TaskStatusPicker } from '../components/StatusPicker'
import { PromptPill, tiltOf, toast, Track, useDropTarget } from '../dock/parts'
import { DateChip } from '../components/DatePicker'
import { busyOf, LiveMark, ownLive, shownState, useLiveBoard, useLiveOf } from '../live'
import { cx, titleFromText } from '../util'

/** 整张任务卡带的提示词：只是任务自己的。子任务、子子任务的提示词由卡上各自那一行带 */
export function cardPrompt(t: TaskSummary): string {
  return t.prompt ? expandPrompt(t.prompt, t) : ''
}

/**
 * 夹在洞洞板上的任务卡。单击打开，双击标题复制，按住拖动排序，把文字拖上来变成一个新子任务；
 * 按住拖到 ChatGPT / Claude 等别的软件的输入框，松手就把提示词粘进去：
 * 拖整张卡是任务的提示词，按住卡上的某一行子任务 / 子子任务拖，就是那一行自己的
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
  // 标题旁的复制图标：任务自己的提示词
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
          {/* 整个任务的提示词发给了 AI：它这会儿在干嘛 */}
          <LiveMark itemId={t.id} status={t.status} size={16} />
          <TaskStatusPicker taskId={t.id} value={t.status} />
          {copyText && <PromptPill text={copyText} />}
        </div>
        <Track statuses={t.statuses} />
        {t.subtasks.length > 0 ? (
          <ol className="tcard-subs">
            {t.subtasks.map((s) => (
              <SubRow key={s.id} s={s} label={`S${s.ref}`} color={t.color} current={s.id === t.current?.id} />
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
 * 左边的状态点一下换到下一个状态，右击这一行可以随便换；都不会打开任务。
 * 填了提示词的行可以按住拖进 AI 的输入框，带的是这一行自己的提示词。
 * 排了日子的显示哪天做，当前那个没排也留着日期按钮，点一下就能改
 */
function SubRow({ s, label, color, current }: { s: SubtaskBrief; label: string; color: string; current?: boolean }) {
  const done = s.status === 'done'
  const next = nextStatus(s.status)
  // 有 AI 会话归到这一行上：子子任务没有执行者，就显示那个 AI
  const live = useLiveOf(s.id)
  const { enabled } = useLiveBoard()
  const who = s.agent || live?.agent || ''
  const mine = ownLive(live, who)
  return (
    <li className={cx('tcard-sub', `t-${s.status}`, current && 'current')}>
      <div
        className={cx('tcard-sub-row', s.prompt && 'has-prompt')}
        title={s.prompt ? `按住拖进 AI 的输入框，松手粘贴 ${label} 的提示词` : undefined}
        {...(s.prompt ? promptDrag(s.prompt, { title: `${label} ${s.title}`, color }) : {})}
        onContextMenu={(e) =>
          openStatusMenu(e, {
            title: `${label} ${s.title}`,
            value: s.status,
            onChange: (status) => api.updateSubtask(s.id, { status })
          })
        }
      >
        <button
          className="tcard-sub-node"
          title={`${STATUS_LABEL[s.status]} → 点一下变成「${STATUS_LABEL[next]}」，右击可以选别的`}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            api.updateSubtask(s.id, { status: next })
          }}
        >
          <StatusGlyph key={s.status} status={s.status} />
        </button>
        <b>{label}</b>
        <Copyable className="tcard-sub-title">{s.title}</Copyable>
        {who && <AgentIcon agent={who} size={15} busy={busyOf(enabled, who, s.status, mine)} live={shownState(mine, s.status)} />}
        {live && !mine && <LiveMark itemId={s.id} status={s.status} />}
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
            <SubRow key={c.id} s={c} label={`${label}.${i + 1}`} color={color} />
          ))}
        </ol>
      )}
    </li>
  )
}
