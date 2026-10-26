import {
  DndContext,
  DragOverlay,
  closestCorners,
  useDroppable,
  type CollisionDetection,
  type DragOverEvent
} from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useEffect, useState, type CSSProperties } from 'react'
import { THREAD_COLORS } from '../../../shared/colors'
import type { ProjectTree, TaskSummary } from '../../../shared/types'
import { api } from '../api'
import { InlineEdit } from '../components/InlineEdit'
import { markDragging, useDndSensors, useSortableHandle } from '../components/Sortable'
import { Icon } from '../dock/parts'
import { cx } from '../util'
import { cardPrompt, TaskCard } from './TaskCard'

// 项目视图：项目 → 任务卡。项目可以拖动排序，任务可以在项目内、跨项目拖动

const P = 'p:'
const T = 't:'
const DROP = 'drop:'

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

  // 拖项目时只和项目比较位置；拖任务时只和任务、项目的空白区比较
  const collision: CollisionDetection = (args) => {
    const draggingProject = String(args.active.id).startsWith(P)
    return closestCorners({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => {
        const id = String(c.id)
        return draggingProject ? id.startsWith(P) : id.startsWith(T) || id.startsWith(DROP)
      })
    })
  }

  const onDragOver = ({ active: a, over }: DragOverEvent): void => {
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
        setNativeDrag(activatorEvent?.type === 'dragstart')
      }}
      onDragCancel={() => {
        markDragging(false)
        setActive(null)
        setColumns(columnsOf(trees))
      }}
      onDragOver={onDragOver}
      onDragEnd={({ active: a, over }) => {
        markDragging(false)
        setActive(null)
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
        <div className={cx('projects', wide && 'wide')}>
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

      <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.2)' }}>
        {active?.startsWith(T) && tasks.get(active.slice(T.length)) ? (
          <div className={cx('drag-ghost', nativeDrag && 'native')}>
            <TaskCard task={tasks.get(active.slice(T.length))!} index={0} onOpen={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
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
