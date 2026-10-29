import { DndContext, DragOverlay, MeasuringStrategy, closestCenter } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { nextStatus } from '../../../shared/agents'
import { expandPrompt, previousOf, titleFromText } from '../../../shared/prompt'
import { STATUS_LABEL, type Subtask, type TaskDetail } from '../../../shared/types'
import { api } from '../api'
import { AgentIcon } from '../components/AgentIcon'
import { AgentPicker } from '../components/AgentPicker'
import { Copyable } from '../components/Copy'
import { DateChip } from '../components/DatePicker'
import { DeleteButton } from '../components/DeleteButton'
import { InlineEdit, renderPrompt } from '../components/InlineEdit'
import { PromptBox } from '../components/PromptBox'
import { markDragging, useDndSensors, type DragHandle } from '../components/Sortable'
import { openStatusMenu } from '../components/StatusMenu'
import { StatusPicker } from '../components/StatusPicker'
import { toast, useDropTarget } from '../dock/parts'
import { busyOf, LiveMark, ownLive, shownState, useLiveBoard, useLiveOf } from '../live'
import { cx } from '../util'

// 子任务 list：子任务和它下面的子子任务排成一棵两层的树。
//   接力子任务（chained）——和上一个用实线连着，圆形节点，上一个完成后才轮到它
//   独立子任务 ——和上一个断开，方形节点，随时可以做
// 任何一行都能按住拖：上下拖换位置，拖的时候往右挪 = 变成上面那个子任务的子子任务，往左挪 = 提出来变成子任务。
// 带着子子任务的子任务被拖动时，子子任务跟着走；它不能再被放进别的子任务里（最多两层）。
// 做完的子任务（连同它的子子任务）收进最下面的「已完成」，一行一个，list 里只排没做完的。

/** 往右拖多少像素算缩进一层 */
const INDENT = 28

interface Slot {
  id: string
  depth: 0 | 1
}

interface Row extends Slot {
  parentId: string
  sub: Subtask
  hasChildren: boolean
}

function slotsOf(subtasks: Subtask[]): Slot[] {
  return subtasks.flatMap((s) => [
    { id: s.id, depth: 0 as const },
    ...s.children.map((c) => ({ id: c.id, depth: 1 as const }))
  ])
}

/** 按从上到下的顺序算出每一行挂在谁下面 */
function withParents(slots: Slot[]): { id: string; depth: 0 | 1; parentId: string }[] {
  let parent = ''
  return slots.map((s) => {
    if (s.depth === 0) parent = s.id
    return { ...s, parentId: s.depth === 0 ? '' : parent }
  })
}

/**
 * 拖完以后的完整顺序：收在「已完成」里的子任务（连同它的子子任务）没参与拖动，留在原来那一块的位置，
 * 没做完的按拖完的顺序依次填进其余的位置。这样做完的那几个 S 编号不变
 */
function keepDone(all: Slot[], openMoved: Slot[], doneIds: Set<string>): Slot[] {
  const blocks = (list: Slot[]): Slot[][] =>
    list.reduce<Slot[][]>((acc, s) => {
      if (s.depth === 0 || acc.length === 0) acc.push([s])
      else acc[acc.length - 1].push(s)
      return acc
    }, [])
  const open = blocks(openMoved)
  const out: Slot[] = []
  for (const b of blocks(all)) {
    if (doneIds.has(b[0].id)) out.push(...b)
    else out.push(...(open.shift() ?? []))
  }
  for (const b of open) out.push(...b)
  return out
}

/** 拖到 over 上、横向挪了 offsetX 时，松手会落在第几层 */
function projectDepth(rows: Row[], activeId: string, overId: string, offsetX: number): 0 | 1 {
  const activeIndex = rows.findIndex((r) => r.id === activeId)
  const overIndex = rows.findIndex((r) => r.id === overId)
  const active = rows[activeIndex]
  const moved = arrayMove(rows, activeIndex, overIndex)
  const prev = moved[overIndex - 1]
  const next = moved[overIndex + 1]
  const wanted = active.depth + Math.round(offsetX / INDENT)
  // 最上面那行、或者自己带着子子任务的，只能当子任务
  const max = !prev || active.hasChildren ? 0 : 1
  // 插在两个子子任务中间，就只能当子子任务
  const min = next?.depth === 1 && !active.hasChildren ? 1 : 0
  return Math.max(min, Math.min(max, wanted)) as 0 | 1
}

export function SubtaskRoute({ detail, compact }: { detail: TaskDetail; compact?: boolean }) {
  const { subtasks, task } = detail
  const sensors = useDndSensors()

  // 本地先排好结构，松手后立刻生效；数据刷新回来后以数据为准
  const dataSlots = slotsOf(subtasks)
  const key = dataSlots.map((s) => `${s.id}:${s.depth}`).join('|')
  const [slots, setSlots] = useState(dataSlots)
  useEffect(() => setSlots(slotsOf(subtasks)), [key])

  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [offsetX, setOffsetX] = useState(0)
  const [adding, setAdding] = useState<string | null>(null)

  const byId = new Map<string, Subtask>(subtasks.flatMap((s) => [[s.id, s] as const, ...s.children.map((c) => [c.id, c] as const)]))
  const rows: Row[] = withParents(slots).flatMap((s, i, all) => {
    const sub = byId.get(s.id)
    if (!sub) return []
    return [{ ...s, sub, hasChildren: s.depth === 0 && all[i + 1]?.depth === 1 }]
  })
  const topLevel = rows.filter((r) => r.depth === 0).map((r) => r.sub)
  const currentId = topLevel.find((s) => s.status !== 'done')?.id
  // 做完的子任务（连同它的子子任务）收进最下面的「已完成」，list 里只排没做完的
  const done = topLevel.filter((s) => s.status === 'done')
  const doneIds = new Set(done.map((s) => s.id))
  const openRows = rows.filter((r) => !doneIds.has(r.depth === 0 ? r.id : r.parentId))
  // 拖着子任务时，把它的子子任务先藏起来，松手后跟着它走
  const visible = activeId ? openRows.filter((r) => r.parentId !== activeId) : openRows
  const projected = activeId && overId ? projectDepth(visible, activeId, overId, offsetX) : null

  const reset = (): void => {
    markDragging(false)
    setActiveId(null)
    setOverId(null)
    setOffsetX(0)
  }

  const drop = (overRowId: string | null): void => {
    if (!activeId || !overRowId || projected === null) return
    const activeIndex = visible.findIndex((r) => r.id === activeId)
    const overIndex = visible.findIndex((r) => r.id === overRowId)
    const moved: Slot[] = arrayMove(visible, activeIndex, overIndex).map((r) => ({
      id: r.id,
      depth: r.id === activeId ? projected : r.depth
    }))
    const kids = rows.filter((r) => r.parentId === activeId).map((r) => ({ id: r.id, depth: r.depth }))
    if (kids.length) moved.splice(moved.findIndex((r) => r.id === activeId) + 1, 0, ...kids)
    const next = keepDone(slots, moved, doneIds)
    if (next.map((s) => `${s.id}:${s.depth}`).join('|') === slots.map((s) => `${s.id}:${s.depth}`).join('|')) return
    setSlots(next)
    api.arrangeSubtasks(
      task.id,
      withParents(next).map(({ id, parentId }) => ({ id, parentId }))
    )
  }

  const active = activeId ? rows.find((r) => r.id === activeId) : null

  return (
    <div className="route" style={{ '--c': detail.project.color } as CSSProperties}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={({ active: a }) => {
          markDragging(true)
          setActiveId(String(a.id))
          setOverId(String(a.id))
        }}
        onDragMove={({ delta }) => setOffsetX(delta.x)}
        onDragOver={({ over }) => setOverId(over ? String(over.id) : null)}
        onDragEnd={({ over }) => {
          drop(over ? String(over.id) : null)
          reset()
        }}
        onDragCancel={reset}
      >
        <SortableContext items={visible.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <div className="tree">
            {visible.map((r, i) => {
              const isLastOfGroup = visible[i + 1]?.depth !== 1
              const groupParent = r.depth === 0 ? r.id : r.parentId
              const parent = r.depth === 1 ? byId.get(r.parentId) : undefined
              const siblings = rows.filter((x) => x.parentId === r.parentId && x.depth === 1)
              return (
                <div key={r.id} className="tree-slot">
                  <TreeRow
                    row={r}
                    depth={r.id === activeId && projected !== null ? projected : r.depth}
                    detail={detail}
                    topLevel={topLevel}
                    current={r.id === currentId}
                    compact={compact}
                    label={parent ? `S${parent.ref}.${siblings.findIndex((x) => x.id === r.id) + 1}` : ''}
                    onAddChild={() => setAdding(r.id)}
                  />
                  {adding === groupParent && isLastOfGroup && r.id !== activeId && (
                    <AddChild parent={byId.get(groupParent)!} onDone={() => setAdding(null)} />
                  )}
                </div>
              )
            })}
          </div>
        </SortableContext>
        {/* 拖着走的预览放到 body 下面：晾衣绳上的卡片外面套着旋转、缩放，fixed 定位会算错位置，连带放错地方 */}
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {active && (
              <div className="tree-preview" style={{ '--c': detail.project.color } as CSSProperties}>
                <span className="ref">{active.depth === 0 ? `S${active.sub.ref}` : '·'}</span>
                {active.sub.title}
                {active.hasChildren && <span className="muted">＋{active.sub.children.length} 个子子任务</span>}
                <span className="tree-preview-hint">{projected === 1 ? '→ 放进上面的子任务' : '→ 作为子任务'}</span>
              </div>
            )}
          </DragOverlay>,
          document.body
        )}
      </DndContext>
      <AddStop taskId={task.id} hasAny={subtasks.length > 0} />
      <DoneStops subtasks={done} />
    </div>
  )
}

function TreeRow({
  row,
  depth,
  detail,
  topLevel,
  current,
  compact,
  label,
  onAddChild
}: {
  row: Row
  depth: 0 | 1
  detail: TaskDetail
  topLevel: Subtask[]
  current: boolean
  compact?: boolean
  label: string
  onAddChild: () => void
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({ id: row.id })
  const drag: DragHandle = {
    setNodeRef,
    style: { transform: CSS.Translate.toString(transform), transition },
    attributes,
    listeners,
    isDragging
  }
  // 被拖着的那一行变成一条插入线，缩进表示松手后落在哪一层
  if (isDragging) {
    return <div ref={setNodeRef} style={drag.style} className={cx('tree-indicator', depth === 1 && 'nested')} />
  }
  if (row.depth === 1) return <ChildRow c={row.sub} label={label} detail={detail} drag={drag} />
  const index = topLevel.findIndex((s) => s.id === row.id)
  // 前后紧挨着的那个做完、收进「已完成」了：这一头没有能连上的，不画接力线
  const prev = topLevel[index - 1]
  const next = topLevel[index + 1]
  return (
    <Stop
      s={row.sub}
      detail={detail}
      siblings={topLevel}
      first={!prev || prev.status === 'done'}
      startsChain={Boolean(next?.chained && next.status !== 'done')}
      current={current}
      compact={compact}
      drag={drag}
      onAddChild={onAddChild}
    />
  )
}

function Stop({
  s,
  detail,
  siblings,
  first,
  startsChain,
  current,
  compact,
  drag,
  onAddChild
}: {
  s: Subtask
  detail: TaskDetail
  siblings: Subtask[]
  first: boolean
  /** 下一个子任务接着它做：它是一条接力链的起点，也画成圆形 */
  startsChain: boolean
  current: boolean
  /** 晾衣绳上的紧凑版：提示词只占一行 */
  compact?: boolean
  drag: DragHandle
  onAddChild: () => void
}) {
  const prev = previousOf(s, siblings)
  const chained = s.chained && !first
  const waiting = prev && prev.status !== 'done'
  const live = useLiveOf(s.id)
  const mine = ownLive(live, s.agent)
  const { enabled } = useLiveBoard()
  const busy = busyOf(enabled, s.agent, s.status, mine)
  const next = nextStatus(s.status)

  // 把文字扔到这个子任务上 = 加一个子子任务，文字就是它的提示词
  const drop = useDropTarget(async (text) => {
    await api.createSubtask(s.taskId, { parentId: s.id, title: titleFromText(text), prompt: text })
    toast(`✓ 在 S${s.ref} 下面加了一个子子任务`)
  })

  return (
    <div
      ref={drag.setNodeRef}
      style={drag.style}
      className={cx(
        'stop',
        `s-${s.status}`,
        chained || startsChain ? 'chained' : 'solo',
        current && 'current',
        drop.over && 'drop-over'
      )}
      {...drop.props}
    >
      {!first && (
        <button
          className={cx('link', chained ? 'on' : 'off', prev?.status === 'done' && 'lit')}
          title={chained ? '接力中：上一个完成后才轮到它。点一下断开' : '独立的。点一下和上一个接起来'}
          onClick={() => api.updateSubtask(s.id, { chained: !s.chained })}
        >
          <span className="link-line" />
          <span className="link-chip">{chained ? '接力' : '＋ 接上'}</span>
        </button>
      )}

      <div
        className="stop-main"
        {...drag.attributes}
        {...drag.listeners}
        onContextMenu={(e) =>
          openStatusMenu(e, {
            title: `S${s.ref} ${s.title}`,
            value: s.status,
            onChange: (status) => api.updateSubtask(s.id, { status })
          })
        }
      >
        <button
          className="stop-node"
          title={`${STATUS_LABEL[s.status]} → 点一下变成「${STATUS_LABEL[next]}」`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => api.updateSubtask(s.id, { status: next })}
        >
          <span key={s.status} className="node-core" />
        </button>

        <div className="stop-body">
          <div className="stop-title">
            <span className="ref">S{s.ref}</span>
            <InlineEdit value={s.title} placeholder="子任务名" onSave={(title) => api.updateSubtask(s.id, { title })} />
            {/* 状态是主角；谁在做只是旁边一个小头像 */}
            <span className="stop-tags">
              <AgentPicker
                value={s.agent}
                size={16}
                busy={busy}
                live={shownState(mine, s.status)}
                onChange={(agent) => api.assignSubtask(s.id, agent)}
              />
              {live && !mine && <LiveMark itemId={s.id} status={s.status} size={16} />}
              <StatusPicker value={s.status} onChange={(status) => api.updateSubtask(s.id, { status })} />
            </span>
          </div>

          <div className="stop-meta">
            <DateChip value={s.scheduledOn} done={s.status === 'done'} onChange={(day) => api.updateSubtask(s.id, { scheduledOn: day })} />
            {chained && prev && (
              <span className={cx('carry', waiting && 'waiting')}>
                {waiting ? `🔒 等 S${prev.ref} 完成` : `↳ 接着 S${prev.ref}`}
              </span>
            )}
            {s.children.length > 0 && (
              <span className="muted">
                {s.children.filter((c) => c.status === 'done').length}/{s.children.length} 个子子任务
              </span>
            )}
          </div>

          <PromptBox
            mini={compact}
            value={s.prompt}
            placeholder={compact ? '＋ 提示词' : '点这里填提示词…'}
            copyText={expandPrompt(s.prompt, detail.task)}
            onSave={(prompt) => api.updateSubtask(s.id, { prompt })}
          />
          {drop.over && <div className="stop-drop">加一个 S{s.ref} 的子子任务</div>}
        </div>

        <div className="stop-side">
          <button className="row-add" title="加子子任务" onPointerDown={(e) => e.stopPropagation()} onClick={onAddChild}>
            ＋
          </button>
          <DeleteButton
            title={s.children.length ? `删除这个子任务和它的 ${s.children.length} 个子子任务` : '删除这个子任务'}
            onConfirm={() => api.deleteSubtask(s.id)}
          />
        </div>
      </div>
    </div>
  )
}

/** 子子任务：状态 + 标题 + 提示词。左边的小方块点一下换到下一个状态，右边的标签点开随便换 */
function ChildRow({ c, label, detail, drag }: { c: Subtask; label: string; detail: TaskDetail; drag: DragHandle }) {
  const done = c.status === 'done'
  const savePrompt = (value: string): void => {
    api.updateSubtask(c.id, { prompt: value })
  }
  return (
    <div
      ref={drag.setNodeRef}
      style={drag.style}
      className={cx('child', done && 'done')}
      {...drag.attributes}
      {...drag.listeners}
      onContextMenu={(e) =>
        openStatusMenu(e, {
          title: `${label} ${c.title}`,
          value: c.status,
          onChange: (status) => api.updateSubtask(c.id, { status })
        })
      }
    >
      <button
        className={cx('child-check', `t-${c.status}`)}
        title={`${STATUS_LABEL[c.status]} → 点一下变成「${STATUS_LABEL[nextStatus(c.status)]}」`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => api.updateSubtask(c.id, { status: nextStatus(c.status) })}
      >
        {done && '✓'}
      </button>
      <div className="child-body">
        <div className="child-title">
          <span className="ref">{label}</span>
          <InlineEdit value={c.title} placeholder="子子任务名" onSave={(title) => api.updateSubtask(c.id, { title })} />
          {/* 没填提示词时，「＋ 提示词」跟在标题后面，不多占一行 */}
          {!c.prompt && (
            <InlineEdit
              multiline
              className="prompt-field mini"
              value=""
              placeholder="＋ 提示词"
              render={renderPrompt}
              onSave={savePrompt}
            />
          )}
        </div>
        {c.prompt && (
          <PromptBox
            mini
            value={c.prompt}
            placeholder="＋ 提示词"
            copyText={expandPrompt(c.prompt, detail.task)}
            onSave={savePrompt}
          />
        )}
      </div>
      <LiveMark itemId={c.id} status={c.status} size={14} />
      <StatusPicker small value={c.status} onChange={(status) => api.updateSubtask(c.id, { status })} />
      <DeleteButton title="删除这个子子任务" onConfirm={() => api.deleteSubtask(c.id)} />
    </div>
  )
}

/** 做完的子任务收在最下面，点一下展开：一行一个，左边的勾点一下改回待办，右击可以换成别的状态 */
function DoneStops({ subtasks }: { subtasks: Subtask[] }) {
  const [open, setOpen] = useState(false)
  if (subtasks.length === 0) return null
  return (
    <div className="done-stops">
      <button className="paused-toggle" onClick={() => setOpen(!open)}>
        {open ? '收起' : '看看'}已完成的 {subtasks.length} 个
      </button>
      {open &&
        subtasks.map((s) => (
          <div
            key={s.id}
            className="done-stop"
            onContextMenu={(e) =>
              openStatusMenu(e, {
                title: `S${s.ref} ${s.title}`,
                value: s.status,
                onChange: (status) => api.updateSubtask(s.id, { status })
              })
            }
          >
            <button
              className="done-stop-check"
              title={`${STATUS_LABEL[s.status]} → 点一下变成「${STATUS_LABEL[nextStatus(s.status)]}」，右击可以选别的`}
              onClick={() => api.updateSubtask(s.id, { status: nextStatus(s.status) })}
            >
              ✓
            </button>
            <span className="ref">S{s.ref}</span>
            <Copyable className="done-stop-title">{s.title}</Copyable>
            {s.agent && <AgentIcon agent={s.agent} size={14} />}
            <DeleteButton
              title={s.children.length ? `删除这个子任务和它的 ${s.children.length} 个子子任务` : '删除这个子任务'}
              onConfirm={() => api.deleteSubtask(s.id)}
            />
          </div>
        ))}
    </div>
  )
}

function AddChild({ parent, onDone }: { parent: Subtask; onDone: () => void }) {
  const [title, setTitle] = useState('')
  return (
    <div className="child add">
      <span className="child-check" />
      <input
        autoFocus
        value={title}
        placeholder="子子任务，回车继续加，esc 结束"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && onDone()}
        onKeyDown={async (e) => {
          if (e.key === 'Escape') onDone()
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && title.trim()) {
            await api.createSubtask(parent.taskId, { parentId: parent.id, title })
            setTitle('')
          }
        }}
      />
    </div>
  )
}

function AddStop({ taskId, hasAny }: { taskId: string; hasAny: boolean }) {
  const [title, setTitle] = useState('')
  const [chained, setChained] = useState(false)
  return (
    <div className={cx('stop add', chained && hasAny ? 'chained' : 'solo')}>
      {hasAny && (
        <button
          className={cx('link', chained ? 'on' : 'off')}
          title={chained ? '新子任务会接着上一个做' : '新子任务是独立的'}
          onClick={() => setChained(!chained)}
        >
          <span className="link-line" />
          <span className="link-chip">{chained ? '接力' : '＋ 接上'}</span>
        </button>
      )}
      <div className="stop-main">
        <span className="stop-node">
          <span className="node-core" />
        </span>
        <input
          value={title}
          placeholder={chained && hasAny ? '加一个接力子任务，回车' : '加一个子任务，回车'}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && title.trim()) {
              await api.createSubtask(taskId, { title, chained: chained && hasAny })
              setTitle('')
            }
          }}
        />
      </div>
    </div>
  )
}
