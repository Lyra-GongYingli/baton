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
import { dayLabel as shortDay } from '../../../shared/dates'
import type { CalendarItem } from '../../../shared/types'
import { api, useData } from '../api'
import { AgentIcon } from '../components/AgentIcon'
import { copyWithFlash, useDelayedClick } from '../components/Copy'
import { markDragging, useDndSensors } from '../components/Sortable'
import { StatusPicker } from '../components/StatusPicker'
import { cx } from '../util'
import { busyOf, LiveMark, ownLive, shownState, useLiveBoard, useLiveOf } from '../live'
import { toast } from './parts'

// 月历：子任务安排在哪天做。上面是一个月的格子（滚动时一直钉在顶上），
// 下面是选中那天的清单和还没安排的「待安排」。按住拖到某一天就排到那天，拖回「待安排」就取消。

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const DAY = 'day:'
const TRAY = 'tray'
/** 每个格子里最多显示几条，多的显示「+N」（大窗口的格子大，放得下更多） */
const CELL_ROWS = 2
const CELL_ROWS_WIDE = 4

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

/**
 * 月历。侧边栏里是窄版（格子在上、清单在下）；wide 是大窗口版：格子在左、清单在右，格子更大。
 * initialDay：打开时先翻到并选中这一天（比如从总看板的热力图点进来）
 */
export function DockMonth({
  onOpenTask,
  wide,
  initialDay
}: {
  onOpenTask: (taskId: string) => void
  wide?: boolean
  initialDay?: string
}) {
  const today = ymd(new Date())
  const [month, setMonth] = useState(() => {
    const d = initialDay ? parse(initialDay) : new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [selected, setSelected] = useState(initialDay ?? today)
  const days = gridOf(month)
  const from = ymd(days[0])
  const to = ymd(days[days.length - 1])
  const [board] = useData(() => api.calendar(from, to), [from, to])

  // 拖过去先在本地挪好，等数据刷新回来再以数据为准
  const [moved, setMoved] = useState<Record<string, string>>({})
  useEffect(() => setMoved({}), [board])
  const [dragging, setDragging] = useState<CalendarItem | null>(null)
  // 正在往哪天加东西（选中那天的清单上面冒出一个小表单）
  const [adding, setAdding] = useState(false)
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
      <div className={cx('month', wide && 'wide', dragging && 'is-dragging')}>
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
                  rows={wide ? CELL_ROWS_WIDE : CELL_ROWS}
                  onSelect={() => setSelected(day)}
                  onAdd={() => {
                    setSelected(day)
                    setAdding(true)
                  }}
                />
              )
            })}
          </div>
        </div>

        <section className="month-list">
          <h3 className="month-list-title">
            {dayLabel(selected, today)}
            <span>{itemsOn(selected).length || ''}</span>
            {!adding && (
              <button className="month-add-btn" onClick={() => setAdding(true)}>
                ＋ 加到这天
              </button>
            )}
          </h3>
          {adding && <AddToDay key={selected} day={selected} onClose={() => setAdding(false)} />}
          {itemsOn(selected).length === 0 ? (
            <p className="month-empty">这天还没安排。点「＋ 加到这天」，或者把「待安排」里的拖到日历上的某一天。</p>
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
  rows,
  onSelect,
  onAdd
}: {
  day: string
  date: number
  outside: boolean
  today: boolean
  selected: boolean
  items: CalendarItem[]
  rows: number
  onSelect: () => void
  onAdd: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: DAY + day })
  const extra = items.length - rows
  return (
    <div
      ref={setNodeRef}
      className={cx('month-cell', outside && 'outside', today && 'today', selected && 'selected', isOver && 'over')}
      onClick={onSelect}
    >
      <span className="month-date">{date}</span>
      <button
        className="month-cell-add"
        title="在这天加一个子任务"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onAdd()
        }}
      >
        ＋
      </button>
      {items.slice(0, rows).map((i) => (
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
  const live = useLiveOf(item.subtaskId)
  const mine = ownLive(live, item.agent)
  const { enabled } = useLiveBoard()
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
      {item.waitingFor && item.status !== 'done' && <span className="waiting">等 S{item.waitingFor}</span>}
      {item.agent && (
        <AgentIcon
          agent={item.agent}
          size={16}
          busy={busyOf(enabled, item.agent, item.status, mine)}
          live={shownState(mine, item.status)}
        />
      )}
      {live && !mine && <LiveMark itemId={item.subtaskId} status={item.status} size={16} />}
      <StatusPicker value={item.status} onChange={(status) => api.updateSubtask(item.subtaskId, { status })} />
    </div>
  )
}

const NEW_TASK = '__new__'

/**
 * 往某一天加东西：写个标题，选加到哪个任务（默认当前任务）；也可以顺手新建一个任务（带一个同名的第一步）。
 * 回车加完表单还开着，可以接着加下一个。
 */
function AddToDay({ day, onClose }: { day: string; onClose: () => void }) {
  const [trees] = useData(() => api.listProjects(), [])
  const [settings] = useData(() => api.getSettings(), [])
  const [title, setTitle] = useState('')
  const [picked, setPicked] = useState('')
  const [projectId, setProjectId] = useState('')

  if (!trees) return null
  if (trees.length === 0) return <p className="month-empty">先建一个项目，才能往日子里加东西。</p>

  const open = trees.flatMap((t) => t.tasks.filter((x) => x.status !== 'done'))
  // 默认：当前任务 → 第一个进行中的 → 第一个没做完的 → 新任务
  const fallback =
    open.find((t) => t.id === settings?.currentTaskId)?.id ??
    open.find((t) => t.status === 'active')?.id ??
    open[0]?.id ??
    NEW_TASK
  const taskId = picked || fallback
  const project = projectId || trees[0].project.id

  const submit = async (): Promise<void> => {
    const text = title.trim()
    if (!text) return
    const target = taskId === NEW_TASK ? await api.createTask({ projectId: project, title: text }) : taskId
    await api.createSubtask(target, { title: text, scheduledOn: day })
    // 刚建的新任务，接下来加的就放进它里面
    if (taskId === NEW_TASK) setPicked(target)
    setTitle('')
    toast(`✓ 加到 ${shortDay(day)}`)
  }

  return (
    <div className="month-add">
      <input
        autoFocus
        value={title}
        placeholder="这天要做什么？回车添加"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
          if (e.key === 'Escape') onClose()
        }}
      />
      <div className="month-add-row">
        <span className="muted">加到</span>
        <select value={taskId} onChange={(e) => setPicked(e.target.value)}>
          {trees.map((t) =>
            t.tasks.some((x) => x.status !== 'done') ? (
              <optgroup key={t.project.id} label={t.project.title}>
                {t.tasks
                  .filter((x) => x.status !== 'done')
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.title}
                    </option>
                  ))}
              </optgroup>
            ) : null
          )}
          <option value={NEW_TASK}>＋ 新任务（就叫上面这个名字）</option>
        </select>
        {taskId === NEW_TASK && (
          <select value={project} onChange={(e) => setProjectId(e.target.value)}>
            {trees.map((t) => (
              <option key={t.project.id} value={t.project.id}>
                {t.project.title}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="month-add-actions">
        <button className="month-add-cancel" onClick={onClose}>
          收起
        </button>
        <button className="month-add-go" disabled={!title.trim()} onClick={submit}>
          加到 {shortDay(day)}
        </button>
      </div>
    </div>
  )
}
