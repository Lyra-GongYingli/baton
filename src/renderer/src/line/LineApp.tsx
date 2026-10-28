import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  pointerWithin,
  useDraggable,
  useDroppable,
  type CollisionDetection
} from '@dnd-kit/core'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { dayLabel } from '../../../shared/dates'
import { expandPrompt } from '../../../shared/prompt'
import { STATUS_LABEL, type LineState, type Status, type TaskDetail } from '../../../shared/types'
import { api, onMainEvent, useData } from '../api'
import { cardPrompt } from '../board/TaskCard'
import { TaskBody } from '../board/TaskBody'
import { CopyFlash } from '../components/Copy'
import { draggingOrJustDragged, isDragging, markDragging, useDndSensors, type DragOut } from '../components/Sortable'
import { openStatusMenu, StatusMenuHost } from '../components/StatusMenu'
import { StatusGlyph, TaskStatusPicker } from '../components/StatusPicker'
import { Icon, Toast, Track } from '../dock/parts'
import { cx } from '../util'

// 晾衣绳：屏幕顶上一根绳子，主角是进行中的任务——每个任务一张卡片。
// 卡片里就是侧边栏的任务页（紧凑版）：改标题、目标、提示词，加 / 删 / 拖动子任务和子子任务，换状态、换人，复制提示词。
// 待办、已暂停、今天完成的任务记在最左边的一张便签上，当辅助信息。
// 按住卡片顶部那一条拖到便签的某一栏 = 改成那个状态，从便签上拖一个任务到绳子上 = 开始做（进行中）。

const CARD_W = 300
const NOTE_W = 196
const GAP = 30
/** 便签上哪几栏折起来了，记在本机，下次打开还是这样 */
const FOLDED_KEY = 'baton.noteFolded'

function loadFolded(): Status[] {
  try {
    return JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]') as Status[]
  } catch {
    return []
  }
}
/** 绳子两头挂在屏幕顶边往下这么多 */
const ROPE_Y = 8
const SECTION = 'section:'
const ACTIVE_ZONE = 'active-zone'
const NOTE_SECTIONS: { status: Status; name: string }[] = [
  { status: 'todo', name: '待办' },
  { status: 'paused', name: '已暂停' },
  { status: 'done', name: '今天完成' }
]

type Phase = 'hidden' | 'in' | 'out'
type Flash = { key: string; text: string; id: number }
/** 被拖动的东西：一张任务卡，或便签上的一个任务。带着提示词的还能拖出去丢进别的软件的输入框 */
type Dragged = { taskId: string; title: string; color: string; dragOut?: DragOut }
/** 便签上的一行 */
type NoteEntry = { id: string; title: string; color: string; projectTitle: string; status: Status; from?: string; prompt: string }

// 窗口的空白处要让点击穿过去，鼠标进到卡片上时才接住
let interactive = false
function setInteractive(on: boolean): void {
  if (on === interactive) return
  interactive = on
  api.lineInteractive(on)
}

/** 指针同时落在便签某一栏和整片绳子区域时，以便签那一栏为准 */
const preferSections: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return [...hits.filter((h) => String(h.id).startsWith(SECTION)), ...hits.filter((h) => !String(h.id).startsWith(SECTION))]
}

export function LineApp() {
  const [board, reload] = useData(() => api.lineBoard(), [])
  const [phase, setPhase] = useState<Phase>('hidden')
  const [width, setWidth] = useState(window.innerWidth)
  // 拖过去先在本地挪好，等数据刷新回来再以数据为准
  const [moved, setMoved] = useState<Record<string, Status>>({})
  const [dragged, setDragged] = useState<Dragged | null>(null)
  // 浏览器原生拖放（带提示词的任务）：跟着鼠标的小纸条由浏览器画，DragOverlay 就不画了
  const [nativeDrag, setNativeDrag] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [pinned, setPinned] = useState(false)
  const sensors = useDndSensors()
  const outTimer = useRef(0)

  useEffect(() => setMoved({}), [board])

  useEffect(() => {
    const apply = (s: LineState): void => {
      setPinned(s.pinned)
      clearTimeout(outTimer.current)
      if (s.open) {
        reload()
        setPhase('in')
        return
      }
      setPhase((p) => (p === 'hidden' ? p : 'out'))
      outTimer.current = window.setTimeout(() => {
        setPhase('hidden')
        interactive = false
        api.lineClosed()
      }, 620)
    }
    // 重启后如果是固定着的，窗口一加载好就要挂出来：主动问一次状态
    api.lineState().then((s) => {
      if (s.open) apply(s)
    })
    return onMainEvent('line-state', (s) => apply(s as LineState))
  }, [reload])

  useEffect(() => {
    const move = (e: MouseEvent): void => {
      if (isDragging()) return
      setInteractive(Boolean((e.target as Element | null)?.closest?.('.line-hit')))
    }
    const leave = (): void => {
      if (!isDragging()) setInteractive(false)
    }
    const key = (e: KeyboardEvent): void => {
      // 在输入框里按的 Esc 是「取消编辑」，拖动时按的是「取消拖动」，都不收起；固定着的也不收
      const inField = (e.target as HTMLElement | null)?.closest?.('input, textarea, select')
      if (e.key === 'Escape' && !inField && !draggingOrJustDragged()) api.lineClose()
    }
    // 带着提示词往外拖（浏览器原生拖放）时收不到 mousemove：按拖到的位置决定，
    // 在卡片 / 便签上就接住，空白处让拖动穿过去，好丢进下面那个软件的输入框
    const drag = (e: DragEvent): void => {
      if (!e.screenX && !e.screenY) return
      const el = document.elementFromPoint(e.screenX - window.screenX, e.screenY - window.screenY)
      setInteractive(Boolean(el?.closest('.line-hit')))
    }
    const resize = (): void => setWidth(window.innerWidth)
    window.addEventListener('drag', drag)
    window.addEventListener('mousemove', move)
    document.documentElement.addEventListener('mouseleave', leave)
    window.addEventListener('keydown', key)
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('drag', drag)
      window.removeEventListener('mousemove', move)
      document.documentElement.removeEventListener('mouseleave', leave)
      window.removeEventListener('keydown', key)
      window.removeEventListener('resize', resize)
    }
  }, [])

  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 1500)
    return () => clearTimeout(t)
  }, [flash])

  if (!board || phase === 'hidden') return <div className="line-root" />

  // 所有任务放在一起，按（拖动后的）状态分：进行中的挂卡片，其余的记在便签上
  const entries: (NoteEntry & { detail?: TaskDetail })[] = [
    ...board.active.map((d) => ({
      id: d.task.id,
      title: d.task.title,
      color: d.project.color,
      projectTitle: d.project.title,
      status: 'active' as Status,
      prompt: detailPrompt(d),
      detail: d
    })),
    ...[...board.todo, ...board.paused, ...board.done].map((t) => ({
      id: t.id,
      title: t.title,
      color: t.color,
      projectTitle: t.projectTitle,
      status: t.status,
      from: t.span?.from,
      prompt: cardPrompt(t)
    }))
  ].map((e) => ({ ...e, status: moved[e.id] ?? e.status }))
  const cards = entries.filter((e) => e.status === 'active' && e.detail).map((e) => e.detail as TaskDetail)
  const noteOf = (status: Status): NoteEntry[] => entries.filter((e) => e.status === status)

  // 便签在最左边，任务卡片依次排开、整体居中；屏幕太窄就一起缩小。绳子是一条往下垂的弧线，卡片夹在弧线上
  const widths = [NOTE_W, ...(cards.length ? cards.map(() => CARD_W) : [CARD_W])]
  const total = widths.reduce((a, b) => a + b, 0) + GAP * (widths.length - 1)
  const scale = Math.min(1, (width - 48) / total)
  const sag = Math.min(54, Math.max(24, width * 0.03))
  const ropeY = (x: number): number => ROPE_Y + 4 * sag * (x / width) * (1 - x / width)
  let cursor = (width - total * scale) / 2
  const centers = widths.map((w) => {
    const c = cursor + (w * scale) / 2
    cursor += (w + GAP) * scale
    return c
  })

  const openTask = (taskId: string): void => {
    api.dockOpen({ taskId, focus: true })
  }

  const setTaskStatus = (taskId: string, status: Status): void => {
    const entry = entries.find((e) => e.id === taskId)
    if (!entry || entry.status === status) return
    setMoved({ ...moved, [taskId]: status })
    api.updateTask(taskId, { status })
    setFlash({ key: 'note', text: `「${entry.title}」→ ${STATUS_LABEL[status]}`, id: Date.now() })
  }

  const hangers: { key: string; node: ReactNode }[] = [
    {
      key: 'note',
      node: <Note noteOf={noteOf} dragging={Boolean(dragged)} pinned={pinned} onOpen={openTask} onStatus={setTaskStatus} />
    },
    ...(cards.length
      ? cards.map((d) => ({
          key: d.task.id,
          node: <TaskCard detail={d} onOpen={openTask} onStatus={setTaskStatus} />
        }))
      : [{ key: 'empty', node: <EmptyCard dragging={Boolean(dragged)} /> }])
  ]

  return (
    <div className={cx('line-root', `phase-${phase}`, dragged && 'is-dragging')}>
      <svg className="line-rope" width={width} height={ROPE_Y + sag + 12}>
        <path d={`M -4 ${ROPE_Y} Q ${width / 2} ${ROPE_Y + 2 * sag} ${width + 4} ${ROPE_Y}`} />
      </svg>
      <DndContext
        sensors={sensors}
        collisionDetection={preferSections}
        autoScroll={false}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={({ active, activatorEvent }) => {
          markDragging(true)
          setDragged(active.data.current as Dragged)
          setNativeDrag(activatorEvent?.type === 'dragstart')
        }}
        onDragCancel={() => {
          markDragging(false)
          setDragged(null)
        }}
        onDragEnd={({ active, over }) => {
          markDragging(false)
          setDragged(null)
          if (!over) return
          const { taskId } = active.data.current as Dragged
          const target = String(over.id)
          if (target.startsWith(SECTION)) setTaskStatus(taskId, target.slice(SECTION.length) as Status)
          else if (target === ACTIVE_ZONE) setTaskStatus(taskId, 'active')
        }}
      >
        <ActiveZone />
        {hangers.map((h, i) => (
          <div
            key={h.key}
            className={cx('line-hanger', h.key !== 'note' && 'steady')}
            style={
              {
                left: centers[i],
                top: ropeY(centers[i]),
                '--i': i,
                '--w': `${widths[i]}px`,
                '--s': scale,
                '--sway': `${5.2 + (i % 3) * 0.9}s`
              } as CSSProperties
            }
          >
            <div className="line-swing">
              <div className="line-wiggle">
                <div className="line-scale">
                  <Clip />
                  {h.node}
                  {flash?.key === h.key && (
                    <div key={flash.id} className="line-flash">
                      {flash.text}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
        <DragOverlay dropAnimation={null}>
          {dragged && !nativeDrag ? (
            <span className="line-slip" style={{ '--c': dragged.color } as CSSProperties}>
              {dragged.title}
            </span>
          ) : null}
        </DragOverlay>
      </DndContext>
      <Toast />
      <CopyFlash />
      <StatusMenuHost />
    </div>
  )
}

/** 整片绳子区域：从便签上拖下来的任务，放到这里就是开始做 */
function ActiveZone() {
  const { setNodeRef } = useDroppable({ id: ACTIVE_ZONE })
  return <div ref={setNodeRef} className="line-active-zone" />
}

/** 晾衣夹 */
function Clip() {
  return (
    <svg className="line-clip" width="18" height="38" viewBox="0 0 18 38" aria-hidden>
      <defs>
        <linearGradient id="clip-g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fdfdfd" />
          <stop offset="0.5" stopColor="#eceef1" />
          <stop offset="1" stopColor="#d9dce1" />
        </linearGradient>
      </defs>
      <rect x="3" y="0.5" width="12" height="37" rx="3.5" fill="url(#clip-g)" stroke="rgba(0,0,0,0.22)" />
      <line x1="9" y1="2.5" x2="9" y2="35.5" stroke="rgba(0,0,0,0.13)" />
      <rect x="1" y="13" width="16" height="6" rx="3" fill="#c3c6cc" stroke="rgba(0,0,0,0.28)" />
      <path d="M4 16h10" stroke="#8d9097" strokeWidth="0.8" />
    </svg>
  )
}

/** 最左边的便签：待办 / 已暂停 / 今天完成 的任务。每一栏都能把任务卡拖进来 */
function Note({
  noteOf,
  dragging,
  pinned,
  onOpen,
  onStatus
}: {
  noteOf: (s: Status) => NoteEntry[]
  dragging: boolean
  pinned: boolean
  onOpen: (taskId: string) => void
  onStatus: (taskId: string, status: Status) => void
}) {
  const today = new Date()
  const [folded, setFolded] = useState<Status[]>(loadFolded)
  const toggle = (status: Status): void => {
    const next = folded.includes(status) ? folded.filter((s) => s !== status) : [...folded, status]
    setFolded(next)
    localStorage.setItem(FOLDED_KEY, JSON.stringify(next))
  }
  return (
    <div className={cx('line-note', 'line-hit', dragging && 'armed')}>
      <div className="line-note-date">
        {today.getMonth() + 1} 月 {today.getDate()} 日 · 周{'日一二三四五六'[today.getDay()]}
        {pinned && (
          <button className="line-note-pin" title="已固定：点一下取消固定（点别的软件会收起）" onClick={() => api.lineTogglePin()}>
            📌
          </button>
        )}
      </div>
      {/* 任务多了便签不会无限变长：这里面自己滚动，日期留在上面 */}
      <div className="line-note-body">
        {NOTE_SECTIONS.map(({ status, name }) => (
          <NoteSection
            key={status}
            status={status}
            name={name}
            items={noteOf(status)}
            folded={folded.includes(status)}
            onToggle={() => toggle(status)}
            onOpen={onOpen}
            onStatus={onStatus}
          />
        ))}
      </div>
    </div>
  )
}

/** 便签的一栏：点标题折起 / 展开，展开时全部列出来。折起来也照样能把任务卡拖进来 */
function NoteSection({
  status,
  name,
  items,
  folded,
  onToggle,
  onOpen,
  onStatus
}: {
  status: Status
  name: string
  items: NoteEntry[]
  folded: boolean
  onToggle: () => void
  onOpen: (taskId: string) => void
  onStatus: (taskId: string, status: Status) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: SECTION + status })
  return (
    <section ref={setNodeRef} className={cx('line-note-section', `t-${status}`, isOver && 'over', folded && 'folded')}>
      <button className="line-note-head" title={folded ? '展开这一栏' : '折起这一栏'} onClick={onToggle}>
        <span className="line-note-chevron" aria-hidden>
          ▾
        </span>
        <StatusGlyph status={status} />
        {name}
        <b>{items.length}</b>
      </button>
      {isOver && <p className="line-note-hint">松手改成{STATUS_LABEL[status]}</p>}
      {!folded && items.map((e) => <NoteItem key={e.id} entry={e} onOpen={onOpen} onStatus={onStatus} />)}
    </section>
  )
}

function NoteItem({
  entry,
  onOpen,
  onStatus
}: {
  entry: NoteEntry
  onOpen: (taskId: string) => void
  onStatus: (taskId: string, status: Status) => void
}) {
  const { setNodeRef, attributes, listeners, isDragging: dragging } = useDraggable({
    id: `note:${entry.id}`,
    data: {
      taskId: entry.id,
      title: entry.title,
      color: entry.color,
      dragOut: { text: entry.prompt, slip: { title: entry.title, color: entry.color } }
    } satisfies Dragged
  })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      draggable={Boolean(entry.prompt) || undefined}
      className={cx('line-note-item', dragging && 'placeholder')}
      style={{ '--c': entry.color } as CSSProperties}
      title={`${entry.projectTitle} · ${entry.title}\n点一下打开 · 拖到绳子上开始做 · 右击改状态${entry.prompt ? ' · 拖到 AI 的输入框粘贴提示词' : ''}`}
      onClick={() => {
        if (!isDragging()) onOpen(entry.id)
      }}
      onContextMenu={(e) =>
        openStatusMenu(e, {
          title: entry.title,
          value: entry.status,
          onChange: (s) => onStatus(entry.id, s),
          actions: [{ label: '在侧边栏打开', onClick: () => onOpen(entry.id) }]
        })
      }
    >
      <i />
      <span className="line-note-title">{entry.title}</span>
      {entry.from && entry.status !== 'done' && <span className="line-note-date-tag">{dayLabel(entry.from)}</span>}
    </div>
  )
}

/**
 * 一个进行中的任务。顶上一条：项目、在侧边栏打开、状态（按住这一条可以拖到便签上）；
 * 下面是进度条和侧边栏同款的任务正文（紧凑版），内容多了在卡片里滚动。
 */
function TaskCard({
  detail,
  onOpen,
  onStatus
}: {
  detail: TaskDetail
  onOpen: (taskId: string) => void
  onStatus: (taskId: string, status: Status) => void
}) {
  const { task, project, subtasks } = detail
  const prompt = detailPrompt(detail)
  const { setNodeRef, attributes, listeners, isDragging: dragging } = useDraggable({
    id: `task:${task.id}`,
    data: {
      taskId: task.id,
      title: task.title,
      color: project.color,
      dragOut: { text: prompt, slip: { title: task.title, color: project.color } }
    } satisfies Dragged
  })

  return (
    <div
      ref={setNodeRef}
      className={cx('line-card', 'line-task', 'line-hit', dragging && 'placeholder')}
      style={{ '--c': project.color } as CSSProperties}
      // 右击卡片空白处 / 标题：改整个任务的状态；右击子任务那一行改子任务（那边自己处理）
      onContextMenu={(e) =>
        openStatusMenu(e, {
          title: task.title,
          value: task.status,
          onChange: (s) => onStatus(task.id, s),
          actions: [{ label: '在侧边栏打开', onClick: () => onOpen(task.id) }]
        })
      }
    >
      <header
        className="line-task-head"
        {...attributes}
        {...listeners}
        draggable={Boolean(prompt) || undefined}
        title={`按住这一条，拖到便签上可以改状态${prompt ? '；拖到 AI 的输入框，松手粘贴提示词' : ''}`}
      >
        <span className="line-task-project">
          <i />
          {project.title}
        </span>
        <button
          className="line-task-open"
          title="在侧边栏打开"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onOpen(task.id)}
        >
          <Icon.expand />
        </button>
        <TaskStatusPicker taskId={task.id} value={task.status} />
      </header>
      <Track statuses={subtasks.map((s) => s.status)} />
      <div className="line-task-scroll">
        <TaskBody detail={detail} compact />
      </div>
    </div>
  )
}

/** 拖整个任务出去时带的提示词：只是任务自己的（子任务、子子任务用卡片里各自的复制图标拖） */
function detailPrompt({ task }: TaskDetail): string {
  return task.prompt ? expandPrompt(task.prompt, task) : ''
}

/** 没有进行中的任务时挂一张空卡片 */
function EmptyCard({ dragging }: { dragging: boolean }) {
  return (
    <div className="line-card line-task line-hit idle">
      <div className="line-task-title">没有进行中的任务</div>
      <div className="line-empty">{dragging ? '松手开始做这个任务' : '从左边便签上拖一个任务到绳子上，就开始做'}</div>
    </div>
  )
}
