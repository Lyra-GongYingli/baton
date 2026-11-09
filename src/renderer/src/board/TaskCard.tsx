import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useState, type CSSProperties } from 'react'
import { nextStatus } from '../../../shared/agents'
import { expandPrompt, titleFromText } from '../../../shared/prompt'
import { STATUS_LABEL, type SubtaskBrief, type TaskSummary } from '../../../shared/types'
import { api } from '../api'
import { AgentIcon } from '../components/AgentIcon'
import { Copyable, useDelayedClick } from '../components/Copy'
import { useCrossTarget } from '../components/crossDrop'
import type { DragHandle, DragOut } from '../components/Sortable'
import { openStatusMenu } from '../components/StatusMenu'
import { StatusGlyph, TaskStatusPicker } from '../components/StatusPicker'
import { PromptPill, tiltOf, toast, Track, useDropTarget } from '../dock/parts'
import { DateChip } from '../components/DatePicker'
import { busyOf, LiveMark, ownLive, shownState, useLiveBoard, useLiveOf } from '../live'
import { cx } from '../util'

/** 整张任务卡带的提示词：只是任务自己的。子任务、子子任务的提示词由卡上各自那一行带 */
export function cardPrompt(t: TaskSummary): string {
  return t.prompt ? expandPrompt(t.prompt, t) : ''
}

/** 卡片上按住拖的一行子任务 / 子子任务（拖动的 id 前缀） */
export const SUB = 's:'
/** 卡片上一个没做完的子任务那一块（连同它下面的子子任务那几行）：别的卡片拖来的停在这里，就当它的子子任务 */
export const SUB_SPOT = 'sd:'

/** 按住卡片上的一行拖动时带着的信息 */
export interface SubDrag {
  id: string
  /** 原来在哪个任务里 */
  taskId: string
  /** S2 / S2.1 */
  label: string
  title: string
  color: string
  /** 下面有几个子子任务：带着子子任务的挪过去只能当子任务（最多两层） */
  children: number
}

/** 卡片上一个子任务那一块：拖到这里松手，当它的子子任务 */
export interface SubSpot {
  taskId: string
  /** S2 */
  label: string
}

/**
 * 夹在洞洞板上的任务卡。单击打开，双击标题复制，按住拖动排序，把文字拖上来变成一个新子任务；
 * 按住拖到 ChatGPT / Claude 等别的软件的输入框，松手就把提示词粘进去：
 * 拖整张卡是任务的提示词，按住卡上的某一行子任务 / 子子任务拖，就是那一行自己的。
 * 卡上的一行子任务 / 子子任务按住拖到别的任务卡片上，就挪过去（见 ProjectView）。
 * 做完的子任务收在最下面的「已完成」里
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
  /** 洞洞板上真的那张卡片才有；拖整张卡时跟手的那份影子没有 */
  drag?: DragHandle
}) {
  // 拖进来的文字 = 一个新子任务，文字就是它的提示词
  const drop = useDropTarget(async (text) => {
    await api.createSubtask(t.id, { title: titleFromText(text), prompt: text })
    toast(`✓ 在「${t.title}」里加了一个子任务`)
  })
  const click = useDelayedClick(onOpen)
  // 别的卡片上的子任务、子子任务拖过来，停在这张卡片上
  const crossOver = useCrossTarget()?.taskId === t.id
  // 标题旁的复制图标：任务自己的提示词
  const copyText = cardPrompt(t)
  const style = { '--c': t.color, '--tilt': tiltOf(t.id), '--i': index } as CSSProperties
  const open = t.subtasks.filter((s) => s.status !== 'done')
  const done = t.subtasks.filter((s) => s.status === 'done')
  const movable = Boolean(drag)

  return (
    <div ref={drag?.setNodeRef} style={drag?.style} className={cx('tcard-slot', drag?.isDragging && 'lifted')}>
      <div
        className={cx('tcard', `t-${t.status}`, drop.over && 'drop-over', crossOver && 'cross-over')}
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
          <>
            {open.length > 0 && (
              <ol className="tcard-subs">
                {open.map((s) => (
                  <SubRow
                    key={s.id}
                    s={s}
                    label={`S${s.ref}`}
                    task={t}
                    current={s.id === t.current?.id}
                    movable={movable}
                    spot
                  />
                ))}
              </ol>
            )}
            <DoneSubs subtasks={done} task={t} movable={movable} />
          </>
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

/** 做完的子任务收在卡片最下面，点一下展开 / 收起（不会打开任务，也不会拖动卡片） */
function DoneSubs({ subtasks, task, movable }: { subtasks: SubtaskBrief[]; task: TaskSummary; movable: boolean }) {
  const [open, setOpen] = useState(false)
  if (subtasks.length === 0) return null
  return (
    <>
      <button
        className="tcard-done-toggle"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
        }}
      >
        {/* 写明是子任务：卡片下面紧挨着项目自己的「看看已完成的 N 个」（做完的任务） */}
        {open ? '收起' : '看看'}已完成的 {subtasks.length} 个子任务
      </button>
      {open && (
        <ol className="tcard-subs">
          {subtasks.map((s) => (
            <SubRow key={s.id} s={s} label={`S${s.ref}`} task={task} movable={movable} />
          ))}
        </ol>
      )}
    </>
  )
}

interface SubRowProps {
  s: SubtaskBrief
  /** S2 / S2.1 */
  label: string
  task: TaskSummary
  current?: boolean
  /** 洞洞板上真的那张卡片：这一行能按住拖到别的任务上 */
  movable: boolean
  /** 没做完的子任务那一块：别的卡片拖来的停在这里，就当它的子子任务 */
  spot?: boolean
}

/**
 * 卡片上的一个子任务（子子任务缩进挂在它下面）：状态、编号、标题、谁在做。
 * 左边的状态点一下换到下一个状态，右击这一行可以随便换；都不会打开任务。
 * 按住这一行拖到别的任务卡片上就挪过去；填了提示词的也能拖进 AI 的输入框，带的是这一行自己的提示词。
 * 排了日子的显示哪天做，当前那个没排也留着日期按钮，点一下就能改。
 * 拖整张卡时跟手的那份影子也画这些行，但不挂拖动：同一个 id 挂两次，会把真卡片上那一行的拖动顶掉
 */
function SubRow(props: SubRowProps) {
  return props.movable ? <MovableSubRow {...props} /> : <SubRowView {...props} />
}

function MovableSubRow(props: SubRowProps) {
  const { s, label, task } = props
  const drag = useDraggable({
    id: SUB + s.id,
    data: {
      sub: { id: s.id, taskId: task.id, label, title: s.title, color: task.color, children: s.children.length } satisfies SubDrag,
      // 填了提示词的走浏览器的拖放（见 Sortable 的 DragOutSensor）：拖出 Baton 丢进 AI 的输入框就粘贴
      dragOut: s.prompt ? ({ text: s.prompt, slip: { title: `${label} ${s.title}`, color: task.color } } satisfies DragOut) : undefined
    }
  })
  const spot = useDroppable({ id: SUB_SPOT + s.id, disabled: !props.spot, data: { taskId: task.id, label } satisfies SubSpot })
  return <SubRowView {...props} drag={drag} spotRef={spot.setNodeRef} />
}

function SubRowView({
  s,
  label,
  task,
  current,
  movable,
  drag,
  spotRef
}: SubRowProps & { drag?: ReturnType<typeof useDraggable>; spotRef?: (el: HTMLElement | null) => void }) {
  const done = s.status === 'done'
  const next = nextStatus(s.status)
  // 有 AI 会话归到这一行上：子子任务没有执行者，就显示那个 AI
  const live = useLiveOf(s.id)
  const { enabled } = useLiveBoard()
  const who = s.agent || live?.agent || ''
  const mine = ownLive(live, who)
  // 别的卡片上的子任务、子子任务拖过来停在这一块上：松手就当它的子子任务
  const crossOver = useCrossTarget()?.parentId === s.id
  return (
    <li
      ref={spotRef}
      className={cx('tcard-sub', `t-${s.status}`, current && 'current', crossOver && 'cross-over', drag?.isDragging && 'lifted')}
    >
      <div
        ref={drag?.setNodeRef}
        className={cx('tcard-sub-row', drag && 'movable')}
        title={
          drag
            ? `按住拖到别的任务卡片上，挪过去${s.prompt ? `；拖进 AI 的输入框，松手粘贴 ${label} 的提示词` : ''}`
            : undefined
        }
        {...drag?.listeners}
        draggable={drag && s.prompt ? true : undefined}
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
            <SubRow key={c.id} s={c} label={`${label}.${i + 1}`} task={task} movable={movable} />
          ))}
        </ol>
      )}
    </li>
  )
}
