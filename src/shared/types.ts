// 主进程和界面共用的数据类型
// 结构：项目 Project → 任务 Task → 子任务 Subtask → 子子任务（Subtask.children）

/**
 * 任务、子任务、子子任务共用一套状态，表达的是进度。
 * 谁在做单独记在执行者 agent 上，不混进状态（「我在做」「AI 在跑」都算进行中）。
 */
export type Status = 'todo' | 'active' | 'paused' | 'done'

export const STATUS_LABEL: Record<Status, string> = {
  todo: '待办',
  active: '进行中',
  paused: '已暂停',
  done: '已完成'
}

export const STATUS_ORDER: Status[] = ['todo', 'active', 'paused', 'done']

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
  status: Status
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
  status: Status
  agent: Assignee
  prompt: string
  /** 接力子任务：接着上一个子任务做，上一个完成后才轮到它 */
  chained: boolean
  /** 安排在哪天做（本地日期 YYYY-MM-DD）；空字符串 = 还没安排。子子任务不用 */
  scheduledOn: string
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
  /** 当前要做的那个子任务（第一个没做完的） */
  current: { id: string; ref: number; title: string; status: Status; agent: Assignee; scheduledOn: string } | null
  /** 按顺序的每个子任务状态，用来画接力跑道 */
  statuses: Status[]
  /** 按顺序的全部子任务，各自带着子子任务；任务卡上整个列出来 */
  subtasks: SubtaskBrief[]
  /** 当前子任务的完整提示词，占位符已替换（拖拽时要同步拿到） */
  currentPrompt: string
  /** 任务的时间：没做完的子任务排在哪几天（最早 ~ 最晚）；有排在今天以前的就是逾期。都没排就是 null */
  span: { from: string; to: string; overdue: boolean } | null
  /** 没做完、也还没排日子的子任务有几个 */
  unscheduled: number
}

/** 任务卡上列出来的一个子任务或子子任务（不带提示词） */
export interface SubtaskBrief {
  id: string
  ref: number
  title: string
  status: Status
  agent: Assignee
  /** 哪天做（YYYY-MM-DD），没排是空字符串；子子任务不用 */
  scheduledOn: string
  /** 子子任务（只有子任务才有） */
  children: SubtaskBrief[]
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
  status: Status
  agent: Assignee
  taskId: string
  taskTitle: string
  projectTitle: string
  color: string
  updatedAt: number
  /** 接力子任务的上一棒还没完成时，上一棒的编号 */
  waitingFor: number | null
  promptExpanded: string
  /** 哪天做（YYYY-MM-DD），没排是空字符串 */
  scheduledOn: string
}

/** 月历里的一个子任务 */
export type CalendarItem = ProcessItem

export interface CalendarBoard {
  /** 安排在这段日子里的子任务（包括已完成的） */
  items: CalendarItem[]
  /** 还没安排日子、也没完成的子任务（只算待办和进行中的任务） */
  unscheduled: CalendarItem[]
}

export interface LineState {
  open: boolean
  /** 固定住了：点别的软件也不收起，重启后还在 */
  pinned: boolean
}

/** 晾衣绳：进行中的任务挂成大卡片，其余的任务按状态记在一张便签上 */
export interface LineBoard {
  active: TaskDetail[]
  todo: TaskSummary[]
  paused: TaskSummary[]
  /** 今天完成的 */
  done: TaskSummary[]
}

/** 总看板：大窗口首页的各种统计 */
export interface Dashboard {
  /** 今天、本周一（本地日期 YYYY-MM-DD） */
  today: string
  weekStart: string
  tiles: {
    activeTasks: number
    activeSubtasks: number
    scheduledThisWeek: number
    doneThisWeek: number
    doneToday: number
    /** 排在今天以前、还没完成的子任务 */
    overdue: number
  }
  /** 热力图的日期范围（含两头，从周一到周日） */
  heatFrom: string
  heatTo: string
  /** 每天安排了几个子任务（含已完成的） */
  scheduled: Record<string, number>
  /** 每天完成了几个子任务 */
  done: Record<string, number>
  /** 最近 12 周每周完成几个子任务，旧 → 新；week 是那周的周一 */
  weekly: { week: string; done: number }[]
  /** 每个项目的任务、子任务各状态有几个 */
  projects: { id: string; title: string; color: string; tasks: Record<Status, number>; subtasks: Record<Status, number> }[]
  /** 没完成的子任务按执行者分（'' = 未分配） */
  agents: { agent: Assignee; active: number; todo: number; paused: number }[]
  overdue: CalendarItem[]
  /** 接下来 7 天（含今天）安排了、还没完成的 */
  upcoming: CalendarItem[]
}

/** 进程：按状态分组。进行中 / 待办 / 已暂停 来自待办和进行中的任务，已完成只算今天完成的 */
export interface ProcessBoard {
  columns: Record<Status, ProcessItem[]>
}

export type DockSide = 'left' | 'right'

export interface DockSettings {
  side: DockSide
  pinned: boolean
}

export interface DockState {
  open: boolean
  pinned: boolean
  side: DockSide
  /** 拖着东西停在把手上弹开的：鼠标没进来、或者又移出去，就自动收回 */
  peek: boolean
}

export interface PublicSettings {
  currentTaskId: string | null
  dataDir: string
  shortcuts: { dock: string }
  dock: DockSettings
  /** 让 Claude Code 等 AI 工具操控 Baton 的本机 MCP 服务 */
  mcp: { url: string; token: string; running: boolean; error: string | null }
}

type TaskPatch = Partial<Pick<Task, 'title' | 'goal' | 'doneCriteria' | 'prompt' | 'status'>>
type SubtaskPatch = Partial<Pick<Subtask, 'title' | 'status' | 'agent' | 'prompt' | 'chained' | 'scheduledOn'>>

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
  /** 新建子任务；scheduledOn 不传就排在今天（子子任务不排日子） */
  createSubtask(
    taskId: string,
    input: { title: string; prompt?: string; chained?: boolean; agent?: Assignee; parentId?: string; scheduledOn?: string }
  ): Promise<string>
  updateSubtask(id: string, patch: SubtaskPatch): Promise<void>
  /** 拖动后整体重排：从上到下的顺序，每项挂在哪个子任务下面（空字符串 = 本身是子任务） */
  arrangeSubtasks(taskId: string, layout: { id: string; parentId: string }[]): Promise<void>
  /** 删子任务会连同它的子子任务一起删 */
  deleteSubtask(id: string): Promise<void>

  processBoard(): Promise<ProcessBoard>
  lineBoard(): Promise<LineBoard>
  dashboard(): Promise<Dashboard>
  /** 月历：from、to 是本地日期 YYYY-MM-DD（含两头） */
  calendar(from: string, to: string): Promise<CalendarBoard>
  /** 换执行者；只记谁在做，不改状态 */
  assignSubtask(id: string, agent: Assignee): Promise<void>

  getSettings(): Promise<PublicSettings>
  setCurrentTask(id: string | null): Promise<void>

  copyText(text: string): Promise<void>
  showDataDir(): Promise<void>

  /** 展开侧边栏；focus=true 时同时获得键盘焦点 */
  dockOpen(opts?: { focus?: boolean; taskId?: string; peek?: boolean }): Promise<void>
  /** 收起侧边栏；force=false 时钉住状态下会忽略 */
  dockClose(opts?: { force?: boolean }): Promise<void>
  /** 侧边栏的收起动画播完了，可以隐藏窗口 */
  dockClosed(): Promise<void>
  getDockState(): Promise<DockState>
  setDockPinned(pinned: boolean): Promise<void>
  setDockSide(side: DockSide): Promise<void>
  /** 上下拖动把手 */
  moveHandle(phase: 'start' | 'move' | 'end', dy?: number): Promise<void>

  /** 晾衣绳（挂在屏幕顶部的进程视图）：放下 / 收起 */
  lineToggle(): Promise<void>
  /** 固定 / 取消固定晾衣绳（固定时顺便放下来） */
  lineTogglePin(): Promise<void>
  lineState(): Promise<LineState>
  lineOpen(): Promise<void>
  lineClose(): Promise<void>
  /** 晾衣绳的收起动画播完了，可以隐藏窗口 */
  lineClosed(): Promise<void>
  /** 鼠标在卡片上时接住点击，在空白处时让点击穿到下面的软件 */
  lineInteractive(on: boolean): Promise<void>
  openMainWindow(taskId?: string): Promise<void>

  /** Claude Code 的命令行找不找得到、Baton 是否已经加进去 */
  claudeCodeStatus(): Promise<{ cli: boolean; connected: boolean }>
  /** 把 Baton 的 MCP 服务加到 Claude Code（用户级，所有项目可用） */
  connectClaudeCode(): Promise<{ ok: boolean; message: string }>
}

export type MainEvent = 'data-changed' | 'navigate' | 'dock-state' | 'dock-show-task' | 'remote-change' | 'line-state'
