import { DndContext, DragOverlay, pointerWithin, useDraggable, useDroppable } from '@dnd-kit/core'
import { useEffect, useState, type CSSProperties } from 'react'
import { AGENTS, AGENT_BY_ID } from '../../../shared/agents'
import { STATUS_LABEL, type Assignee, type ProcessBoard, type ProcessItem } from '../../../shared/types'
import { api } from '../api'
import { AgentIcon } from '../components/AgentIcon'
import { Copyable, useDelayedClick } from '../components/Copy'
import { markDragging, useDndSensors } from '../components/Sortable'
import { PromptPill, toast } from '../dock/parts'
import { cx } from '../util'

// 进程视图：每个执行者一条泳道，看谁在跑什么。把卡片拖到某个头像上 = 交给 TA

const LANE = 'lane:'

export function ProcessView({ board, onOpenTask }: { board: ProcessBoard; onOpenTask: (taskId: string) => void }) {
  const sensors = useDndSensors()
  const [active, setActive] = useState<ProcessItem | null>(null)
  // 松手后先在本地挪过去，等数据刷新回来再以数据为准
  const [moved, setMoved] = useState<Record<string, Assignee>>({})
  useEffect(() => setMoved({}), [board])

  const all = [...board.unassigned, ...AGENTS.flatMap((a) => board.lanes[a.id])]
  const laneOf = (item: ProcessItem): Assignee => {
    if (item.subtaskId in moved) return moved[item.subtaskId]
    if (item.agent) return item.agent
    return item.status === 'doing' ? 'me' : ''
  }
  const itemsIn = (lane: Assignee): ProcessItem[] => all.filter((i) => laneOf(i) === lane)

  const running = all.filter((i) => i.status === 'ai_running').length
  const doing = all.filter((i) => i.status === 'doing').length

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
        const lane = String(over.id).slice(LANE.length) as Assignee
        const item = all.find((i) => i.subtaskId === a.id)
        if (!item || laneOf(item) === lane) return
        setMoved({ ...moved, [item.subtaskId]: lane })
        api.assignSubtask(item.subtaskId, lane)
        toast(lane ? `→ 交给 ${AGENT_BY_ID[lane].name}` : '已取消分配')
      }}
    >
      <div className="process-summary">
        <span>
          <b>{running}</b> 个 AI 在跑
        </span>
        <span>
          <b>{doing}</b> 个我在做
        </span>
        <span>
          今天完成 <b>{board.doneToday}</b>
        </span>
      </div>

      <div className="lanes-board wide">
        <Lane agent="" items={itemsIn('')} onOpenTask={onOpenTask} />
        {AGENTS.map((a) => (
          <Lane key={a.id} agent={a.id} items={itemsIn(a.id)} onOpenTask={onOpenTask} />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.2)' }}>
        {active ? <ProcessCard item={active} lane={laneOf(active)} overlay /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function Lane({ agent, items, onOpenTask }: { agent: Assignee; items: ProcessItem[]; onOpenTask: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: LANE + agent })
  const info = agent ? AGENT_BY_ID[agent] : null
  const working = items.filter((i) => i.status === 'ai_running' || i.status === 'doing').length
  const queued = items.filter((i) => i.status === 'todo').length
  const busy = working > 0

  const summary = !agent
    ? items.length
      ? `${items.length} 个等人领`
      : '都分出去了'
    : [working && `${agent === 'me' ? '在做' : '在跑'} ${working}`, queued && `排队 ${queued}`]
        .filter(Boolean)
        .join(' · ') || '空闲'

  return (
    <section
      ref={setNodeRef}
      id={`lane-${agent || 'none'}`}
      className={cx('lane-box', `lane-${agent || 'none'}`, isOver && 'over', !busy && agent && 'idle')}
      style={{ '--agent': info?.color ?? 'var(--muted)' } as CSSProperties}
    >
      <header className="lane-head">
        <AgentIcon agent={agent} size={28} busy={busy} />
        <div className="lane-who">
          <span className="lane-name">{info ? info.name : '未分配'}</span>
          <span className="lane-sum">{summary}</span>
        </div>
        {agent && !busy && <span className="zzz">z z</span>}
      </header>
      <div className="lane-items">
        {items.map((i) => (
          <DraggableCard key={i.subtaskId} item={i} lane={agent} onOpenTask={onOpenTask} />
        ))}
        {items.length === 0 && <div className="lane-drop-hint">{isOver ? '松手交给 TA' : agent ? '把卡片拖到这里交给 TA' : ''}</div>}
      </div>
    </section>
  )
}

function DraggableCard({ item, lane, onOpenTask }: { item: ProcessItem; lane: Assignee; onOpenTask: (id: string) => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: item.subtaskId })
  const click = useDelayedClick(() => onOpenTask(item.taskId))
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cx('pcard-slot', isDragging && 'placeholder')} onClick={click.onClick}>
      <ProcessCard item={item} lane={lane} />
    </div>
  )
}

function ProcessCard({ item, lane, overlay }: { item: ProcessItem; lane: Assignee; overlay?: boolean }) {
  return (
    <div className={cx('pcard', `s-${item.status}`, overlay && 'overlay')} style={{ '--c': item.color } as CSSProperties}>
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
        <span className={cx('now-status', `s-${item.status}`)}>
          {item.status === 'todo' && lane ? '排队中' : STATUS_LABEL[item.status]}
        </span>
        {item.waitingFor && <span className="waiting">🔒 等 S{item.waitingFor}</span>}
      </div>
    </div>
  )
}
