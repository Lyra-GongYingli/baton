// 主进程和界面共用的数据类型
// 结构：项目 Project → 任务 Task → 子任务 Subtask → 子子任务（Subtask.children）

export type TaskStatus = 'active' | 'paused' | 'done'

export type SubtaskStatus = 'todo' | 'doing' | 'ai_running' | 'done'

export const STATUS_LABEL: Record<SubtaskStatus, string> = {
  todo: '待办',
  doing: '我在做',
  ai_running: 'AI 在跑',
  done: '完成'
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  active: '进行中',
  paused: '已暂停',
  done: '已完成'
}

/** 谁在做：AI 代理或者我自己。空字符串 = 还没分配 */
export type AgentId = 'claude' | 'codex' | 'muse' | 'me'
export type Assignee = AgentId | ''

export interface Project {
  id: string
  title: string
  color: string
  position: number
  createdAt: number
  updatedAt: number
}

export interface Task {
  id: string
  projectId: string
  title: string
  goal: string
  doneCriteria: string
  /** 任务本身的提示词 */
  prompt: string
  status: TaskStatus
  position: number
  createdAt: number
  updatedAt: number
}

export interface Subtask {
  id: string
  taskId: string
  /** 子子任务的上级子任务；子任务本身是空字符串 */
  parentId: string
  /** 任务内稳定编号，显示为 S1、S2…，排序变化也不变 */
  ref: number
  position: number
  title: string
  /** 子子任务只用 todo / done */
  status: SubtaskStatus
  agent: Assignee
  prompt: string
  /** 接力子任务：接着上一个子任务做，上一个完成后才轮到它 */
  chained: boolean
  createdAt: number
  updatedAt: number
  /** 子子任务（只有子任务才有） */
  children: Subtask[]
}

export interface TaskDetail {
  project: Project
  task: Task
  subtasks: Subtask[]
}

export interface TaskSummary extends Task {
  /** 任务跟随项目的颜色 */
  color: string
  projectTitle: string
  subtaskTotal: number
  subtaskDone: number
  current: { ref: number; title: string; status: SubtaskStatus; agent: Assignee } | null
  /** 按顺序的每个子任务状态，用来画接力跑道 */
  statuses: SubtaskStatus[]
  /** 当前子任务的完整提示词，占位符已替换（拖拽时要同步拿到） */
  currentPrompt: string
}

export interface ProjectTree {
  project: Project
  tasks: TaskSummary[]
}

/** 进程视图里的一张卡：一个正在进行或排队的子任务 */
export interface ProcessItem {
  subtaskId: string
  ref: number
  title: string
  status: SubtaskStatus
  agent: Assignee
  taskId: string
  taskTitle: string
  projectTitle: string
  color: string
  updatedAt: number
  /** 接力子任务的上一棒还没完成时，上一棒的编号 */
  waitingFor: number | null
  promptExpanded: string
}

export interface ProcessBoard {
  lanes: Record<AgentId, ProcessItem[]>
  unassigned: ProcessItem[]
  doneToday: number
}

export type DockSide = 'left' | 'right'

export interface DockSettings {
  side: DockSide
  pinned: boolean
  /** 鼠标碰到把手就展开；关掉后需要点击 */
  hoverOpen: boolean
}

export interface DockState {
  open: boolean
  pinned: boolean
  side: DockSide
  hoverOpen: boolean
  /** 这次是鼠标碰到把手展开的（鼠标没进来就自动收回） */
  openedByHover: boolean
}

export interface PublicSettings {
  currentTaskId: string | null
  dataDir: string
  shortcuts: { dock: string }
  dock: DockSettings
}

type TaskPatch = Partial<Pick<Task, 'title' | 'goal' | 'doneCriteria' | 'prompt' | 'status'>>
type SubtaskPatch = Partial<Pick<Subtask, 'title' | 'status' | 'agent' | 'prompt' | 'chained'>>

/** 界面通过 window.baton.call(name, ...args) 调用的全部方法 */
export interface BatonApi {
  listProjects(): Promise<ProjectTree[]>
  createProject(input: { title: string }): Promise<string>
  updateProject(id: string, patch: Partial<Pick<Project, 'title' | 'color'>>): Promise<void>
  deleteProject(id: string): Promise<void>
  reorderProjects(ids: string[]): Promise<void>

  getTask(id: string): Promise<TaskDetail | null>
  createTask(input: { projectId: string; title: string; goal?: string }): Promise<string>
  updateTask(id: string, patch: TaskPatch): Promise<void>
  deleteTask(id: string): Promise<void>
  /** 把任务放到某个项目的第 index 个位置（可以跨项目） */
  moveTask(id: string, projectId: string, index: number): Promise<void>

  /** parentId 不为空时，建的是这个子任务下面的子子任务 */
  createSubtask(
    taskId: string,
    input: { title: string; prompt?: string; chained?: boolean; agent?: Assignee; parentId?: string }
  ): Promise<string>
  updateSubtask(id: string, patch: SubtaskPatch): Promise<void>
  /** 同一层的兄弟按 ids 的顺序排（子任务之间，或同一个子任务下的子子任务之间） */
  reorderSubtasks(taskId: string, ids: string[]): Promise<void>
  /** 删子任务会连同它的子子任务一起删 */
  deleteSubtask(id: string): Promise<void>

  processBoard(): Promise<ProcessBoard>
  /** 进程视图里把子任务拖给某个执行者 */
  assignSubtask(id: string, agent: Assignee): Promise<void>

  getSettings(): Promise<PublicSettings>
  setCurrentTask(id: string | null): Promise<void>

  copyText(text: string): Promise<void>
  showDataDir(): Promise<void>

  /** 展开侧边栏；focus=true 时同时获得键盘焦点 */
  dockOpen(opts?: { focus?: boolean; taskId?: string; hover?: boolean }): Promise<void>
  /** 收起侧边栏；force=false 时钉住状态下会忽略 */
  dockClose(opts?: { force?: boolean }): Promise<void>
  /** 侧边栏的收起动画播完了，可以隐藏窗口 */
  dockClosed(): Promise<void>
  getDockState(): Promise<DockState>
  setDockPinned(pinned: boolean): Promise<void>
  setDockSide(side: DockSide): Promise<void>
  setDockHoverOpen(on: boolean): Promise<void>
  /** 上下拖动把手 */
  moveHandle(phase: 'start' | 'move' | 'end', dy?: number): Promise<void>
  openMainWindow(taskId?: string): Promise<void>
}

export type MainEvent = 'data-changed' | 'navigate' | 'dock-state' | 'dock-show-task'
