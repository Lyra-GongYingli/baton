import { DndContext, DragOverlay, MeasuringStrategy, pointerWithin, useDraggable, useDroppable } from '@dnd-kit/core'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AGENTS, AGENT_BY_ID } from '../../../shared/agents'
import { STATUS_LABEL, type Assignee, type ProcessItem } from '../../../shared/types'
import { api, onMainEvent, useData } from '../api'
import { AgentIcon } from '../components/AgentIcon'
import { isDragging, markDragging, useDndSensors } from '../components/Sortable'
import { cx } from '../util'

// 晾衣绳：进程视图挂在屏幕顶部。每个执行者一张卡片夹在绳子上，写着 TA 在跑什么、排着什么。
// 点一行复制提示词，双击打开这个任务，按住拖到别的卡片上就是交给 TA。

const CARD_W = 216
const TAG_W = 112
const GAP = 30
const MAX_ROWS = 4
/** 绳子两头挂在屏幕顶边往下这么多 */
const ROPE_Y = 8
const LANE = 'lane:'

type Phase = 'hidden' | 'in' | 'out'
type Flash = { key: string; rowId?: string; text: string; id: number }

// 窗口的空白处要让点击穿过去，鼠标进到卡片上时才接住
let interactive = false
function setInteractive(on: boolean): void {
  if (on === interactive) return
  interactive = on
  api.lineInteractive(on)
}

function laneOf(item: ProcessItem): Assignee {
  if (item.agent) return item.agent
  return item.status === 'doing' ? 'me' : ''
}

export function LineApp() {
  const [board, reload] = useData(() => api.processBoard(), [])
  const [phase, setPhase] = useState<Phase>('hidden')
  const [width, setWidth] = useState(window.innerWidth)
  // 拖过去先在本地挪好，等数据刷新回来再以数据为准
  const [moved, setMoved] = useState<Record<string, Assignee>>({})
  const [dragItem, setDragItem] = useState<ProcessItem | null>(null)
  const [flash, setFlash] = useState<Flash | null>(null)
  const sensors = useDndSensors()
  const outTimer = useRef(0)

  useEffect(() => setMoved({}), [board])

  useEffect(
    () =>
      onMainEvent('line-state', (s) => {
        clearTimeout(outTimer.current)
        if ((s as { open: boolean }).open) {
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
      }),
    [reload]
  )

  useEffect(() => {
    const move = (e: MouseEvent): void => {
      if (isDragging()) return
      setInteractive(Boolean((e.target as Element | null)?.closest?.('.line-hit')))
    }
    const leave = (): void => {
      if (!isDragging()) setInteractive(false)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') api.lineClose()
    }
    const resize = (): void => setWidth(window.innerWidth)
    window.addEventListener('mousemove', move)
    document.documentElement.addEventListener('mouseleave', leave)
    window.addEventListener('keydown', key)
    window.addEventListener('resize', resize)
    return () => {
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

  const all = [...board.unassigned, ...AGENTS.flatMap((a) => board.lanes[a.id])]
  const laneOfItem = (i: ProcessItem): Assignee => moved[i.subtaskId] ?? laneOf(i)
  const itemsIn = (lane: Assignee): ProcessItem[] => all.filter((i) => laneOfItem(i) === lane)
  const lanes: Assignee[] = [...AGENTS.map((a) => a.id), ...(itemsIn('').length ? (['' as const] as Assignee[]) : [])]

  // 卡片从左到右排开、整体居中；屏幕太窄就一起缩小。绳子是一条往下垂的弧线，卡片夹在弧线上
  const widths = [TAG_W, ...lanes.map(() => CARD_W)]
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

  const copy = async (item: ProcessItem): Promise<void> => {
    await api.copyText(item.promptExpanded || item.title)
    setFlash({
      key: laneOfItem(item) || 'none',
      rowId: item.subtaskId,
      text: item.promptExpanded ? '✓ 已复制' : '✓ 已复制标题',
      id: Date.now()
    })
  }

  const hangers: { key: string; node: ReactNode }[] = [
    { key: 'tag', node: <Tag items={all} doneToday={board.doneToday} /> },
    ...lanes.map((lane) => ({
      key: lane || 'none',
      node: (
        <LaneCard
          agent={lane}
          items={itemsIn(lane)}
          dragging={Boolean(dragItem)}
          copiedRow={flash?.rowId}
          onCopy={copy}
          onOpen={(item) => api.dockOpen({ taskId: item.taskId, focus: true })}
        />
      )
    }))
  ]

  return (
    <div className={cx('line-root', `phase-${phase}`, dragItem && 'is-dragging')}>
      <svg className="line-rope" width={width} height={ROPE_Y + sag + 12}>
        <path d={`M -4 ${ROPE_Y} Q ${width / 2} ${ROPE_Y + 2 * sag} ${width + 4} ${ROPE_Y}`} />
      </svg>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        autoScroll={false}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={({ active }) => {
          markDragging(true)
          setDragItem(all.find((i) => i.subtaskId === active.id) ?? null)
        }}
        onDragCancel={() => {
          markDragging(false)
          setDragItem(null)
        }}
        onDragEnd={({ active, over }) => {
          markDragging(false)
          setDragItem(null)
          if (!over) return
          const lane = String(over.id).slice(LANE.length) as Assignee
          const item = all.find((i) => i.subtaskId === active.id)
          if (!item || laneOfItem(item) === lane) return
          setMoved({ ...moved, [item.subtaskId]: lane })
          api.assignSubtask(item.subtaskId, lane)
          setFlash({ key: lane || 'none', text: lane ? `→ 交给 ${AGENT_BY_ID[lane].name}` : '已取消分配', id: Date.now() })
        }}
      >
        {hangers.map((h, i) => (
          <div
            key={h.key}
            className="line-hanger"
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
          {dragItem ? <RowBody item={dragItem} lane={laneOfItem(dragItem)} slip /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
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

/** 最左边的牛皮纸小吊牌：一共多少在跑、在做、今天完成几个 */
function Tag({ items, doneToday }: { items: ProcessItem[]; doneToday: number }) {
  const running = items.filter((i) => i.status === 'ai_running').length
  const doing = items.filter((i) => i.status === 'doing').length
  return (
    <div className="line-tag line-hit">
      <span className="line-tag-hole" />
      <div className="line-tag-title">进程</div>
      <div className="line-tag-row">
        <b>{running}</b>AI 在跑
      </div>
      <div className="line-tag-row">
        <b>{doing}</b>我在做
      </div>
      <div className="line-tag-row">
        <b>{doneToday}</b>今天完成
      </div>
    </div>
  )
}

function LaneCard({
  agent,
  items,
  dragging,
  copiedRow,
  onCopy,
  onOpen
}: {
  agent: Assignee
  items: ProcessItem[]
  dragging: boolean
  copiedRow?: string
  onCopy: (item: ProcessItem) => void
  onOpen: (item: ProcessItem) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: LANE + agent })
  const info = agent ? AGENT_BY_ID[agent] : null
  const working = items.filter((i) => i.status === 'ai_running' || i.status === 'doing').length
  const queued = items.filter((i) => i.status === 'todo').length
  const busy = working > 0
  const summary = !agent
    ? `${items.length} 件没人领`
    : [working && `${agent === 'me' ? '在做' : '在跑'} ${working}`, queued && `排队 ${queued}`].filter(Boolean).join(' · ') ||
      '空着'
  const extra = items.length - MAX_ROWS

  return (
    <div
      ref={setNodeRef}
      className={cx('line-card', 'line-hit', isOver && 'over', agent && !busy && 'idle')}
      style={{ '--agent': info?.color ?? 'var(--muted)' } as CSSProperties}
    >
      <header className="line-card-head">
        <AgentIcon agent={agent} size={26} busy={busy} />
        <div className="line-card-who">
          <span className="line-card-name">{info ? info.name : '等人领'}</span>
          <span className="line-card-sum">{isOver ? '松手交给 TA' : summary}</span>
        </div>
        {agent && !busy && !isOver && <span className="zzz">z z</span>}
      </header>
      {items.length > 0 ? (
        <div className="line-rows">
          {items.slice(0, MAX_ROWS).map((item) => (
            <Row key={item.subtaskId} item={item} lane={agent} copied={copiedRow === item.subtaskId} onCopy={onCopy} onOpen={onOpen} />
          ))}
          {extra > 0 && <div className="line-more">还有 {extra} 件</div>}
        </div>
      ) : (
        <div className="line-empty">{dragging ? '拖到这里交给 TA' : '没有活，拖一件过来'}</div>
      )}
    </div>
  )
}

function Row({
  item,
  lane,
  copied,
  onCopy,
  onOpen
}: {
  item: ProcessItem
  lane: Assignee
  copied: boolean
  onCopy: (item: ProcessItem) => void
  onOpen: (item: ProcessItem) => void
}) {
  const { setNodeRef, attributes, listeners, isDragging: dragging } = useDraggable({ id: item.subtaskId })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cx('line-row-slot', dragging && 'placeholder', copied && 'copied')}
      title={item.promptExpanded ? '点一下复制提示词 · 双击打开任务 · 按住拖给别人' : '还没写提示词，点一下复制标题 · 双击打开任务'}
      onClick={(e) => {
        if (isDragging() || e.detail > 1) return
        onCopy(item)
      }}
      onDoubleClick={() => onOpen(item)}
    >
      <RowBody item={item} lane={lane} />
    </div>
  )
}

function RowBody({ item, lane, slip }: { item: ProcessItem; lane: Assignee; slip?: boolean }) {
  const status = item.waitingFor
    ? `等 S${item.waitingFor}`
    : item.status === 'todo'
      ? lane
        ? '排队'
        : '待领'
      : item.status === 'ai_running'
        ? '在跑'
        : STATUS_LABEL[item.status]
  return (
    <div className={cx('line-row', `s-${item.status}`, item.waitingFor != null && 'waiting', slip && 'slip')} style={{ '--c': item.color } as CSSProperties}>
      <span className="line-row-bar" />
      <div className="line-row-main">
        <div className="line-row-title">
          <b>S{item.ref}</b>
          {item.title}
        </div>
        <div className="line-row-crumb">{item.taskTitle}</div>
      </div>
      <span className="line-row-status">
        <i />
        {status}
      </span>
      <span className="line-row-copy">{item.promptExpanded ? '复制' : '复制标题'}</span>
    </div>
  )
}
