import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  pointerWithin,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type Modifier
} from '@dnd-kit/core'
import { getEventCoordinates } from '@dnd-kit/utilities'
import { useEffect, useState, type CSSProperties } from 'react'
import { STATUS_LABEL, type CalendarItem } from '../../../shared/types'
import { api, useData } from '../api'
import { AgentIcon } from '../components/AgentIcon'
import { copyWithFlash, useDelayedClick } from '../components/Copy'
import { markDragging, useDndSensors } from '../components/Sortable'
import { cx } from '../util'
import { toast } from './parts'

// 月历：子任务安排在哪天做。上面是一个月的格子（滚动时一直钉在顶上），
// 下面是选中那天的清单和还没安排的「待安排」。按住拖到某一天就排到那天，拖回「待安排」就取消。

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const DAY = 'day:'
const TRAY = 'tray'
/** 每个格子里最多显示几条，多的显示「+N」 */
const CELL_ROWS = 2

/** 拖着走的小纸条挂在鼠标右下方，不挡住鼠标下面的那一天 */
const followCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  const p = activatorEvent && getEventCoordinates(activatorEvent)
  if (!p || !draggingNodeRect) return transform
  return { ...transform, x: transform.x + p.x - draggingNodeRect.left + 10, y: transform.y + p.y - draggingNodeRect.top + 12 }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 本地日期 → YYYY-MM-DD */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parse(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 这个月的格子：从 1 号所在那周的周一，到最后一天所在那周的周日 */
function gridOf(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const start = new Date(first)
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  const end = new Date(last)
  end.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)))
  const days: Date[] = []
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d))
  return days
}

function dayLabel(day: string, today: string): string {
  const d = parse(day)
  const base = `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${WEEKDAYS[(d.getDay() + 6) % 7]}`
  return day === today ? `今天 · ${base}` : base
}

export function DockMonth({ onOpenTask }: { onOpenTask: (taskId: string) => void }) {
  const today = ymd(new Date())
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [selected, setSelected] = useState(today)
  const days = gridOf(month)
  const from = ymd(days[0])
  const to = ymd(days[days.length - 1])
  const [board] = useData(() => api.calendar(from, to), [from, to])

  // 拖过去先在本地挪好，等数据刷新回来再以数据为准
  const [moved, setMoved] = useState<Record<string, string>>({})
  useEffect(() => setMoved({}), [board])
  const [dragging, setDragging] = useState<CalendarItem | null>(null)
  const sensors = useDndSensors()

  const goMonth = (delta: number): void => {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1)
    setMonth(next)
    setSelected(next.getFullYear() === new Date().getFullYear() && next.getMonth() === new Date().getMonth() ? today : ymd(next))
  }

  if (!board) return null

  const all = [...board.items, ...board.unscheduled]
  const dayOf = (i: CalendarItem): string => moved[i.subtaskId] ?? i.scheduledOn
  const itemsOn = (day: string): CalendarItem[] => all.filter((i) => dayOf(i) === day)
  // 拖回「待安排」的、已经完成的不算
  const tray = all.filter((i) => !dayOf(i) && i.status !== 'done')

  const schedule = (item: CalendarItem, day: string): void => {
    if (dayOf(item) === day) return
    setMoved({ ...moved, [item.subtaskId]: day })
    api.updateSubtask(item.subtaskId, { scheduledOn: day })
    if (day) {
      setSelected(day)
      toast(`→ 排到 ${parse(day).getMonth() + 1} 月 ${parse(day).getDate()} 日`)
    } else {
      toast('已取消安排')
    }
  }

  const onDragStart = ({ active }: DragStartEvent): void => {
    markDragging(true)
    setDragging((active.data.current as { item: CalendarItem }).item)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      // 月历钉在顶上，滚动时位置会变：一直重新测量投放区
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragCancel={() => {
        markDragging(false)
        setDragging(null)
      }}
      onDragEnd={({ active, over }) => {
        markDragging(false)
        setDragging(null)
        if (!over) return
        const item = (active.data.current as { item: CalendarItem }).item
        const target = String(over.id)
        if (target === TRAY) schedule(item, '')
        else if (target.startsWith(DAY)) schedule(item, target.slice(DAY.length))
      }}
    >
      <div className={cx('month', dragging && 'is-dragging')}>
        <div className="month-sticky">
          <header className="month-head">
            <button className="month-nav" title="上个月" onClick={() => goMonth(-1)}>
              ‹
            </button>
            <span className="month-title">
              {month.getFullYear()} 年 {month.getMonth() + 1} 月
            </span>
            <button className="month-nav" title="下个月" onClick={() => goMonth(1)}>
              ›
            </button>
            <button
              className="month-today"
              onClick={() => {
                const d = new Date()
                setMonth(new Date(d.getFullYear(), d.getMonth(), 1))
                setSelected(today)
              }}
            >
              今天
            </button>
          </header>
          <div className="month-weekdays">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="month-grid">
            {days.map((d) => {
              const day = ymd(d)
              return (
                <DayCell
                  key={day}
                  day={day}
                  date={d.getDate()}
                  outside={d.getMonth() !== month.getMonth()}
                  today={day === today}
                  selected={day === selected}
                  items={itemsOn(day)}
                  onSelect={() => setSelected(day)}
                />
              )
            })}
          </div>
        </div>

        <section className="month-list">
          <h3 className="month-list-title">
            {dayLabel(selected, today)}
            <span>{itemsOn(selected).length || ''}</span>
          </h3>
          {itemsOn(selected).length === 0 ? (
            <p className="month-empty">这天还没安排。把下面「待安排」里的拖到日历上的某一天。</p>
          ) : (
            itemsOn(selected).map((i) => <MonthRow key={i.subtaskId} item={i} onOpenTask={onOpenTask} />)
          )}
        </section>

        <Tray items={tray} dragging={Boolean(dragging)} onOpenTask={onOpenTask} />
      </div>

      <DragOverlay dropAnimation={null} modifiers={[followCursor]}>
        {dragging ? (
          <span className="month-slip" style={{ '--c': dragging.color } as CSSProperties}>
            <b>S{dragging.ref}</b>
            {dragging.title}
          </span>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function DayCell({
  day,
  date,
  outside,
  today,
  selected,
  items,
  onSelect
}: {
  day: string
  date: number
  outside: boolean
  today: boolean
  selected: boolean
  items: CalendarItem[]
  onSelect: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: DAY + day })
  const extra = items.length - CELL_ROWS
  return (
    <div
      ref={setNodeRef}
      className={cx('month-cell', outside && 'outside', today && 'today', selected && 'selected', isOver && 'over')}
      onClick={onSelect}
    >
      <span className="month-date">{date}</span>
      {items.slice(0, CELL_ROWS).map((i) => (
        <Chip key={i.subtaskId} item={i} />
      ))}
      {extra > 0 && <span className="month-more">+{extra}</span>}
    </div>
  )
}

/** 格子里的一小条：项目颜色 + 标题 */
function Chip({ item }: { item: CalendarItem }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `cell:${item.subtaskId}`, data: { item } })
  return (
    <span
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cx('month-chip', `s-${item.status}`, isDragging && 'placeholder')}
      style={{ '--c': item.color } as CSSProperties}
      title={`${item.projectTitle} · ${item.taskTitle} · S${item.ref} ${item.title}\n按住拖到别的日子，双击复制提示词`}
      onDoubleClick={(e) => {
        e.stopPropagation()
        copyWithFlash(item.promptExpanded || item.title, e)
      }}
    >
      {item.title}
    </span>
  )
}

function Tray({ items, dragging, onOpenTask }: { items: CalendarItem[]; dragging: boolean; onOpenTask: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: TRAY })
  return (
    <section ref={setNodeRef} className={cx('month-list', 'month-tray', isOver && 'over', dragging && 'armed')}>
      <h3 className="month-list-title">
        待安排
        <span>{items.length || ''}</span>
      </h3>
      {isOver && <p className="month-empty">松手取消安排</p>}
      {items.length === 0 && !isOver ? (
        <p className="month-empty">都排好了。</p>
      ) : (
        items.map((i) => <MonthRow key={i.subtaskId} item={i} onOpenTask={onOpenTask} />)
      )}
    </section>
  )
}

/** 清单里的一行：点一下打开任务，双击复制提示词，按住拖到日历上 */
function MonthRow({ item, onOpenTask }: { item: CalendarItem; onOpenTask: (id: string) => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `list:${item.subtaskId}`, data: { item } })
  const click = useDelayedClick(() => onOpenTask(item.taskId))
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cx('month-row-slot', isDragging && 'placeholder')}
      title="点一下打开任务 · 双击复制提示词 · 按住拖到日历上的某一天"
      onClick={click.onClick}
      onDoubleClick={(e) => {
        click.cancel()
        copyWithFlash(item.promptExpanded || item.title, e)
      }}
    >
      <RowBody item={item} />
    </div>
  )
}

function RowBody({ item }: { item: CalendarItem }) {
  return (
    <div className={cx('month-row', `s-${item.status}`)} style={{ '--c': item.color } as CSSProperties}>
      <span className="month-row-bar" />
      <div className="month-row-main">
        <div className="month-row-title">
          <b>S{item.ref}</b>
          {item.title}
        </div>
        <div className="month-row-crumb">
          {item.projectTitle} · {item.taskTitle}
        </div>
      </div>
      {item.agent && <AgentIcon agent={item.agent} size={18} busy={item.status === 'ai_running'} />}
      <span className={cx('now-status', `s-${item.status}`)}>
        {item.waitingFor && item.status !== 'done' ? `等 S${item.waitingFor}` : STATUS_LABEL[item.status]}
      </span>
    </div>
  )
}
