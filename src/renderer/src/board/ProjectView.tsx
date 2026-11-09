import {
  DndContext,
  DragOverlay,
  closestCorners,
  pointerWithin,
  useDroppable,
  type Active,
  type CollisionDetection,
  type DragOverEvent,
  type Modifier,
  type Over
} from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { getEventCoordinates } from '@dnd-kit/utilities'
import { useEffect, useState, type CSSProperties } from 'react'
import { THREAD_COLORS } from '../../../shared/colors'
import type { ProjectTree, TaskSummary } from '../../../shared/types'
import { api } from '../api'
import { setCrossTarget, useCrossTarget, type CrossTarget } from '../components/crossDrop'
import { InlineEdit } from '../components/InlineEdit'
import { markDragging, useDndSensors, useSortableHandle } from '../components/Sortable'
import { Icon, toast } from '../dock/parts'
import { cx } from '../util'
import { cardPrompt, SUB, SUB_SPOT, TaskCard, type SubDrag, type SubSpot } from './TaskCard'

// 项目视图：项目 → 任务卡。项目可以拖动排序，任务可以在项目内、跨项目拖动。
// 任务卡上的子任务、子子任务可以按住拖到别的任务卡片上（和晾衣绳上一样）：停在那张卡片的某个子任务上松手 = 当它的子子任务，
// 停在卡片别处 = 当那个任务的子任务、排在最后；带着子子任务的只能当子任务。停在自己那张卡片上松手什么也不变。

const P = 'p:'
const T = 't:'
const DROP = 'drop:'

/** 按住的是任务卡上的一行子任务 / 子子任务：它的信息 */
function subOf(active: Active): SubDrag | null {
  if (!String(active.id).startsWith(SUB)) return null
  return (active.data.current as { sub?: SubDrag } | undefined)?.sub ?? null
}

/** 拖卡片上的一行时，跟手的小纸条放在鼠标下面一点，不挡住鼠标停着的那一行 */
const belowPointer: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  const p = activatorEvent && getEventCoordinates(activatorEvent)
  if (!p || !draggingNodeRect) return transform
  return { ...transform, y: transform.y + p.y - draggingNodeRect.top + 18 }
}

type Columns = Record<string, string[]>

function columnsOf(trees: ProjectTree[]): Columns {
  return Object.fromEntries(
    trees.map((t) => [t.project.id, t.tasks.filter((x) => x.status !== 'done').map((x) => x.id)])
  )
}

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem('baton.collapsed') ?? '[]'))
  } catch {
    return new Set()
  }
}

export function ProjectView({
  trees,
  wide,
  onOpenTask
}: {
  trees: ProjectTree[]
  wide?: boolean
  onOpenTask: (id: string) => void
}) {
  const sensors = useDndSensors()
  const key = JSON.stringify(columnsOf(trees)) + trees.map((t) => t.project.id).join()
  const [projectOrder, setProjectOrder] = useState(trees.map((t) => t.project.id))
  const [columns, setColumns] = useState<Columns>(columnsOf(trees))
  const [active, setActive] = useState<string | null>(null)
  // 带着提示词的卡走浏览器的拖放，跟着鼠标的是浏览器画的影子，自己的那张就不画了
  const [nativeDrag, setNativeDrag] = useState(false)
  // 按住卡片上的一行拖动时是它。松手后留到下一次开始拖：松手那一下还要靠它决定小纸条直接消失、不飘回原处
  const [sub, setSub] = useState<SubDrag | null>(null)
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [newProject, setNewProject] = useState<string | null>(null)

  // 数据刷新后同步本地顺序（拖动过程中不同步）
  useEffect(() => {
    if (active) return
    setProjectOrder(trees.map((t) => t.project.id))
    setColumns(columnsOf(trees))
  }, [key])

  const projects = new Map(trees.map((t) => [t.project.id, t]))
  const tasks = new Map(trees.flatMap((t) => t.tasks.map((x) => [x.id, x] as const)))

  const toggleCollapse = (id: string): void => {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setCollapsed(next)
    localStorage.setItem('baton.collapsed', JSON.stringify([...next]))
  }

  const projectOfTask = (taskId: string): string | undefined =>
    Object.keys(columns).find((pid) => columns[pid].includes(taskId))

  // 拖项目时只和项目比较位置；拖任务时只和任务、项目的空白区比较；
  // 拖卡片上的一行时看鼠标停在哪张任务卡片、哪个子任务那一块上（子任务那一块优先）
  const collision: CollisionDetection = (args) => {
    if (String(args.active.id).startsWith(SUB)) {
      const hits = pointerWithin({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => {
          const id = String(c.id)
          return id.startsWith(SUB_SPOT) || id.startsWith(T)
        })
      })
      const spot = (h: { id: unknown }): boolean => String(h.id).startsWith(SUB_SPOT)
      return [...hits.filter(spot), ...hits.filter((h) => !spot(h))]
    }
    const draggingProject = String(args.active.id).startsWith(P)
    return closestCorners({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => {
        const id = String(c.id)
        return draggingProject ? id.startsWith(P) : id.startsWith(T) || id.startsWith(DROP)
      })
    })
  }

  /** 拖着卡片上的一行停在 over 上，松手会挪到哪；停在自己那张卡片上不算 */
  const crossOf = (s: SubDrag, over: Over | null): CrossTarget | null => {
    if (!over) return null
    const id = String(over.id)
    const spot = id.startsWith(SUB_SPOT) ? (over.data.current as SubSpot) : null
    const taskId = spot ? spot.taskId : id.startsWith(T) ? id.slice(T.length) : ''
    const task = tasks.get(taskId)
    if (!task || taskId === s.taskId) return null
    // 带着子子任务的只能当子任务（最多两层）
    if (spot && s.children === 0) return { taskId, title: task.title, parentId: id.slice(SUB_SPOT.length), label: spot.label }
    return { taskId, title: task.title, parentId: '', label: '' }
  }

  const onDragOver = ({ active: a, over }: DragOverEvent): void => {
    const s = subOf(a)
    if (s) {
      setCrossTarget(crossOf(s, over))
      return
    }
    if (!over || !String(a.id).startsWith(T)) return
    const taskId = String(a.id).slice(T.length)
    const overId = String(over.id)
    const from = projectOfTask(taskId)
    const to = overId.startsWith(DROP) ? overId.slice(DROP.length) : projectOfTask(overId.slice(T.length))
    if (!from || !to || from === to) return
    // 跨项目：先在本地挪过去，松手时再保存
    setColumns((cols) => {
      const target = [...cols[to]]
      const overIndex = overId.startsWith(T) ? target.indexOf(overId.slice(T.length)) : target.length
      target.splice(overIndex < 0 ? target.length : overIndex, 0, taskId)
      return { ...cols, [from]: cols[from].filter((x) => x !== taskId), [to]: target }
    })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={({ active: a, activatorEvent }) => {
        markDragging(true)
        setActive(String(a.id))
        setSub(subOf(a))
        setNativeDrag(activatorEvent?.type === 'dragstart')
      }}
      onDragCancel={() => {
        markDragging(false)
        setActive(null)
        setCrossTarget(null)
        setColumns(columnsOf(trees))
      }}
      onDragOver={onDragOver}
      onDragEnd={({ active: a, over }) => {
        markDragging(false)
        setActive(null)
        const s = subOf(a)
        if (s) {
          setCrossTarget(null)
          const target = crossOf(s, over)
          if (target) {
            api.moveSubtask(s.id, target.taskId, target.parentId)
            toast(`✓ 挪到「${target.title}」${target.parentId ? `的 ${target.label} 下面` : ''}`)
          }
          return
        }
        const id = String(a.id)
        if (id.startsWith(P)) {
          if (!over || over.id === a.id) return
          const next = arrayMove(
            projectOrder,
            projectOrder.indexOf(id.slice(P.length)),
            projectOrder.indexOf(String(over.id).slice(P.length))
          )
          setProjectOrder(next)
          api.reorderProjects(next)
          return
        }
        const taskId = id.slice(T.length)
        const pid = projectOfTask(taskId)
        if (!pid) return
        let list = columns[pid]
        if (over && String(over.id).startsWith(T)) {
          const overTask = String(over.id).slice(T.length)
          if (list.includes(overTask)) list = arrayMove(list, list.indexOf(taskId), list.indexOf(overTask))
        }
        setColumns({ ...columns, [pid]: list })
        api.moveTask(taskId, pid, list.indexOf(taskId))
      }}
    >
      <SortableContext items={projectOrder.map((id) => P + id)} strategy={verticalListSortingStrategy}>
        <div className={cx('projects', wide && 'wide', active?.startsWith(SUB) && 'moving-sub')}>
          {projectOrder.map((pid) => {
            const tree = projects.get(pid)
            if (!tree) return null
            return (
              <ProjectSection
                key={pid}
                tree={tree}
                taskIds={columns[pid] ?? []}
                tasks={tasks}
                wide={wide}
                collapsed={collapsed.has(pid)}
                onToggle={() => toggleCollapse(pid)}
                onOpenTask={onOpenTask}
              />
            )
          })}
        </div>
      </SortableContext>

      {newProject === null ? (
        <button className="add-project" onClick={() => setNewProject('')}>
          <Icon.plus /> 新项目
        </button>
      ) : (
        <input
          className="new-inline-input"
          autoFocus
          value={newProject}
          placeholder="项目叫什么？回车创建"
          onChange={(e) => setNewProject(e.target.value)}
          onBlur={() => !newProject.trim() && setNewProject(null)}
          onKeyDown={async (e) => {
            if (e.key === 'Escape') setNewProject(null)
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && newProject.trim()) {
              await api.createProject({ title: newProject })
              setNewProject(null)
            }
          }}
        />
      )}

      <DragOverlay
        // 子任务挪过去以后原来那一行就没了：小纸条松手就消失，不飘回原处
        dropAnimation={sub ? null : { duration: 220, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.2)' }}
        modifiers={sub ? [belowPointer] : undefined}
      >
        {active?.startsWith(T) && tasks.get(active.slice(T.length)) ? (
          <div className={cx('drag-ghost', nativeDrag && 'native')}>
            <TaskCard task={tasks.get(active.slice(T.length))!} index={0} onOpen={() => {}} />
          </div>
        ) : active?.startsWith(SUB) && sub ? (
          <SubSlip sub={sub} native={nativeDrag} />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

/**
 * 拖卡片上的一行时跟着鼠标的小纸条：拖的是哪一行、松手会挪到哪。
 * 填了提示词的行走浏览器的拖放，浏览器已经画了写着标题的小纸条，这里只在停到别的卡片上时补一句会挪到哪
 */
function SubSlip({ sub, native }: { sub: SubDrag; native: boolean }) {
  const cross = useCrossTarget()
  const hint = cross ? `→ 挪到「${cross.title}」${cross.parentId ? `的 ${cross.label} 下面` : ''}` : '→ 拖到别的任务卡片上'
  if (native && !cross) return null
  return (
    <div className="tree-preview sub-slip" style={{ '--c': sub.color } as CSSProperties}>
      {!native && (
        <>
          <span className="ref">{sub.label}</span>
          {/* 标题太长就截掉，后面「挪到哪」的提示要一直看得见 */}
          <span className="tree-preview-title">{sub.title}</span>
          {sub.children > 0 && <span className="muted">＋{sub.children} 个子子任务</span>}
        </>
      )}
      <span className="tree-preview-hint">{hint}</span>
    </div>
  )
}

function ProjectSection({
  tree,
  taskIds,
  tasks,
  wide,
  collapsed,
  onToggle,
  onOpenTask
}: {
  tree: ProjectTree
  taskIds: string[]
  tasks: Map<string, TaskSummary>
  wide?: boolean
  collapsed: boolean
  onToggle: () => void
  onOpenTask: (id: string) => void
}) {
  const { project } = tree
  const handle = useSortableHandle(P + project.id)
  const drop = useDroppable({ id: DROP + project.id })
  const [adding, setAdding] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  // 点了垃圾桶：标题这一行变成「确认删除？」，不用系统弹窗（侧边栏是不激活的面板，系统弹窗可能被挡住）
  const [confirming, setConfirming] = useState(false)
  const done = tree.tasks.filter((t) => t.status === 'done')

  // 点色块换颜色
  const cycleColor = (): void => {
    const i = THREAD_COLORS.indexOf(project.color)
    api.updateProject(project.id, { color: THREAD_COLORS[(i + 1) % THREAD_COLORS.length] })
  }

  return (
    <section
      ref={handle.setNodeRef}
      style={{ ...handle.style, '--c': project.color } as CSSProperties}
      className={cx('project', handle.isDragging && 'lifted')}
    >
      <header className="project-head" {...handle.attributes} {...handle.listeners}>
        <button
          className="project-swatch"
          title="点一下换颜色"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={cycleColor}
        />
        <span className="project-title">
          <InlineEdit value={project.title} placeholder="项目名" onSave={(title) => api.updateProject(project.id, { title })} />
        </span>
        <span className="project-count">{taskIds.length}</span>
        <div className="spacer" />
        <button
          className="icon-btn small"
          title="在这个项目里新建任务"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setAdding('')}
        >
          <Icon.plus />
        </button>
        <button
          className="icon-btn small project-del"
          title="删除这个项目"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setConfirming(true)}
        >
          <Icon.trash />
        </button>
        <button
          className={cx('icon-btn small chevron-btn', collapsed && 'collapsed')}
          title={collapsed ? '展开' : '收起'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggle}
        >
          ▾
        </button>
      </header>

      {confirming && (
        <div className="project-confirm" onPointerDown={(e) => e.stopPropagation()}>
          <span>
            删除「{project.title}」
            {tree.tasks.length > 0 ? `和里面的 ${tree.tasks.length} 个任务（连同子任务、提示词）？删了找不回来。` : '？'}
          </span>
          <button className="project-confirm-no" autoFocus onClick={() => setConfirming(false)}>
            取消
          </button>
          <button className="project-confirm-yes" onClick={() => api.deleteProject(project.id)}>
            删除
          </button>
        </div>
      )}

      {adding !== null && (
        <input
          className="new-inline-input"
          autoFocus
          value={adding}
          placeholder="新任务叫什么？回车创建"
          onChange={(e) => setAdding(e.target.value)}
          onBlur={() => !adding.trim() && setAdding(null)}
          onKeyDown={async (e) => {
            if (e.key === 'Escape') setAdding(null)
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && adding.trim()) {
              const id = await api.createTask({ projectId: project.id, title: adding })
              setAdding(null)
              onOpenTask(id)
            }
          }}
        />
      )}

      {!collapsed && (
        <SortableContext items={taskIds.map((id) => T + id)} strategy={wide ? rectSortingStrategy : verticalListSortingStrategy}>
          <div ref={drop.setNodeRef} className={cx('tcards', wide && 'grid', drop.isOver && 'drop-target')}>
            {taskIds.map((id, i) => {
              const t = tasks.get(id)
              return t ? <SortableTask key={id} task={t} index={i} onOpen={() => onOpenTask(id)} /> : null
            })}
            {taskIds.length === 0 && adding === null && (
              <button className="empty-project" onClick={() => setAdding('')}>
                还没有任务，点这里新建，或者把别的任务拖进来
              </button>
            )}
          </div>
        </SortableContext>
      )}

      {!collapsed && done.length > 0 && (
        <div className="done-tasks">
          <button className="paused-toggle" onClick={() => setShowDone(!showDone)}>
            {showDone ? '收起' : '看看'}已完成的 {done.length} 个
          </button>
          {showDone &&
            done.map((t) => (
              <button key={t.id} className="done-task" onClick={() => onOpenTask(t.id)}>
                ✓ {t.title}
              </button>
            ))}
        </div>
      )}
    </section>
  )
}

function SortableTask({ task, index, onOpen }: { task: TaskSummary; index: number; onOpen: () => void }) {
  const handle = useSortableHandle(T + task.id, { text: cardPrompt(task) })
  return <TaskCard task={task} index={index} onOpen={onOpen} drag={handle} />
}
