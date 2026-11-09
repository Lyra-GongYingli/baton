import { DndContext, DragOverlay, pointerWithin, useDraggable, useDroppable } from '@dnd-kit/core'
import { useEffect, useState, type CSSProperties } from 'react'
import { STATUS_LABEL, type ProcessBoard, type ProcessItem, type Status } from '../../../shared/types'
import { api } from '../api'
import { dayLabel, today } from '../../../shared/dates'
import { AgentIcon } from '../components/AgentIcon'
import { Copyable, useDelayedClick } from '../components/Copy'
import { markDragging, useDndSensors } from '../components/Sortable'
import { StatusGlyph } from '../components/StatusPicker'
import { PromptPill, toast } from '../dock/parts'
import { busyOf, LiveMark, ownLive, shownState, useLiveBoard, useLiveOf } from '../live'
import { cx } from '../util'

// 进程视图：按状态分成 进行中 / 待办 / 已暂停 / 今天完成 四列。把卡片拖到另一列 = 改成那个状态

const COLUMN = 'column:'
const COLUMNS: Status[] = ['active', 'todo', 'paused', 'done']
const COLUMN_NAME: Record<Status, string> = { active: '进行中', todo: '待办', paused: '已暂停', done: '今天完成' }
const COLUMN_EMPTY: Record<Status, string> = {
  active: '没有在做的，把卡片拖过来开始',
  todo: '没有待办',
  paused: '没有暂停的',
  done: '今天还没完成的'
}

export function ProcessView({ board, onOpenTask }: { board: ProcessBoard; onOpenTask: (taskId: string) => void }) {
  const sensors = useDndSensors()
  const [active, setActive] = useState<ProcessItem | null>(null)
  // 松手后先在本地挪过去，等数据刷新回来再以数据为准
  const [moved, setMoved] = useState<Record<string, Status>>({})
  useEffect(() => setMoved({}), [board])

  const all = COLUMNS.flatMap((c) => board.columns[c])
  const statusOf = (item: ProcessItem): Status => moved[item.subtaskId] ?? item.status
  const itemsIn = (status: Status): ProcessItem[] => all.filter((i) => statusOf(i) === status)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={({ active: a }) => {
        markDragging(true)
        setActive(all.find((i) => i.subtaskId === a.id) ?? null)
      }}
      onDragCancel={() => {
        markDragging(false)
        setActive(null)
      }}
      onDragEnd={({ active: a, over }) => {
        markDragging(false)
        setActive(null)
        if (!over) return
        const status = String(over.id).slice(COLUMN.length) as Status
        const item = all.find((i) => i.subtaskId === a.id)
        if (!item || statusOf(item) === status) return
        setMoved({ ...moved, [item.subtaskId]: status })
        api.updateSubtask(item.subtaskId, { status })
        toast(`→ ${STATUS_LABEL[status]}`)
      }}
    >
      <div className="process-summary">
        {COLUMNS.map((c) => (
          <span key={c}>
            {COLUMN_NAME[c]} <b>{itemsIn(c).length}</b>
          </span>
        ))}
      </div>

      <div className="lanes-board wide">
        {COLUMNS.map((c) => (
          <Column key={c} status={c} items={itemsIn(c)} onOpenTask={onOpenTask} />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.2)' }}>
        {active ? <ProcessCard item={active} status={statusOf(active)} overlay /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function Column({ status, items, onOpenTask }: { status: Status; items: ProcessItem[]; onOpenTask: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: COLUMN + status })
  return (
    <section ref={setNodeRef} className={cx('lane-box', `t-${status}`, isOver && 'over', items.length === 0 && 'idle')}>
      <header className="lane-head">
        <span className="lane-glyph">
          <StatusGlyph status={status} />
        </span>
        <div className="lane-who">
          <span className="lane-name">{COLUMN_NAME[status]}</span>
          <span className="lane-sum">{items.length} 件</span>
        </div>
      </header>
      <div className="lane-items">
        {items.map((i) => (
          <DraggableCard key={i.subtaskId} item={i} status={status} onOpenTask={onOpenTask} />
        ))}
        {items.length === 0 && <div className="lane-drop-hint">{isOver ? `松手改成${STATUS_LABEL[status]}` : COLUMN_EMPTY[status]}</div>}
      </div>
    </section>
  )
}

function DraggableCard({ item, status, onOpenTask }: { item: ProcessItem; status: Status; onOpenTask: (id: string) => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: item.subtaskId })
  const click = useDelayedClick(() => onOpenTask(item.taskId))
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cx('pcard-slot', isDragging && 'placeholder')} onClick={click.onClick}>
      <ProcessCard item={item} status={status} />
    </div>
  )
}

function ProcessCard({ item, status, overlay }: { item: ProcessItem; status: Status; overlay?: boolean }) {
  const live = useLiveOf(item.subtaskId)
  const mine = ownLive(live, item.agent)
  const { enabled } = useLiveBoard()
  return (
    <div className={cx('pcard', `s-${status}`, overlay && 'overlay')} style={{ '--c': item.color } as CSSProperties}>
      <div className="pcard-title">
        <span className="ref">S{item.ref}</span>
        <Copyable>{item.title}</Copyable>
        {item.promptExpanded && !overlay && <PromptPill text={item.promptExpanded} />}
      </div>
      <div className="pcard-crumb">
        <span className="pcard-dot" />
        {item.projectTitle} · {item.taskTitle}
      </div>
      <div className="pcard-meta">
        {item.scheduledOn && (
          <span className={cx('tcard-time', item.scheduledOn < today() && status !== 'done' && 'overdue')}>{dayLabel(item.scheduledOn)}</span>
        )}
        {item.agent && (
          <AgentIcon agent={item.agent} size={16} busy={busyOf(enabled, item.agent, status, mine)} live={shownState(mine, status)} />
        )}
        {live && !mine && <LiveMark itemId={item.subtaskId} status={status} size={16} />}
        {item.waitingFor && status !== 'done' && <span className="waiting">🔒 等 S{item.waitingFor}</span>}
      </div>
    </div>
  )
}
