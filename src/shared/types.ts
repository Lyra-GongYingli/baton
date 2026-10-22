// 主进程和界面共用的数据类型

export type ThreadStatus = 'active' | 'paused' | 'done'

export type StepStatus = 'todo' | 'doing' | 'ai_running' | 'review' | 'done'

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  todo: '待办',
  doing: '我在做',
  ai_running: 'AI 在跑',
  review: '等我审核',
  done: '完成'
}

export const STEP_STATUS_ORDER: StepStatus[] = ['todo', 'doing', 'ai_running', 'review', 'done']

export const THREAD_STATUS_LABEL: Record<ThreadStatus, string> = {
  active: '进行中',
  paused: '已暂停',
  done: '已完成'
}

export type LogSource = 'manual' | 'quick' | 'clipboard'

/** 断点卡：切回线程时，30 秒内回到状态 */
export interface Breakpoint {
  where: string
  done: string
  next: string
  blockers: string
  nextPrompt: string
  nextTool: string
  source: 'ai' | 'manual'
  updatedAt: number
}

export interface Thread {
  id: string
  title: string
  goal: string
  doneCriteria: string
  status: ThreadStatus
  breakpoint: Breakpoint | null
  createdAt: number
  updatedAt: number
}

export interface Artifact {
  id: string
  threadId: string
  stepId: string
  kind: 'text' | 'link'
  title: string
  content: string
  createdAt: number
}

export interface Step {
  id: string
  threadId: string
  /** 线程内稳定编号，显示为 S1、S2…，排序变化也不变 */
  ref: number
  position: number
  title: string
  status: StepStatus
  tool: string
  prompt: string
  notes: string
  createdAt: number
  updatedAt: number
  outputs: Artifact[]
}

export interface LogEntry {
  id: string
  threadId: string
  content: string
  source: LogSource
  createdAt: number
}

export interface ThreadDetail {
  thread: Thread
  steps: Step[]
  logs: LogEntry[]
}

export interface ThreadSummary extends Thread {
  stepTotal: number
  stepDone: number
  reviewCount: number
  currentStep: { ref: number; title: string; status: StepStatus } | null
}

export interface DashboardItem {
  stepId: string
  stepRef: number
  stepTitle: string
  tool: string
  threadId: string
  threadTitle: string
  updatedAt: number
}

export interface Dashboard {
  review: DashboardItem[]
  running: DashboardItem[]
  doing: DashboardItem[]
}

export interface PublicSettings {
  currentThreadId: string | null
  model: string
  hasApiKey: boolean
  dataDir: string
  shortcuts: { capture: string; clipboard: string }
}

export const MODEL_OPTIONS: { id: string; label: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5（默认，效果最好）' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5（更快）' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5（最便宜）' }
]

export const TOOL_SUGGESTIONS = [
  'Claude',
  'Claude Code',
  'ChatGPT',
  'Gemini',
  'Cursor',
  'Figma',
  'Midjourney',
  '浏览器',
  '手动'
]

/** 界面通过 window.baton.call(name, ...args) 调用的全部方法 */
export interface BatonApi {
  listThreads(): Promise<ThreadSummary[]>
  getThread(id: string): Promise<ThreadDetail | null>
  createThread(input: { title: string; goal?: string }): Promise<string>
  updateThread(
    id: string,
    patch: Partial<Pick<Thread, 'title' | 'goal' | 'doneCriteria' | 'status' | 'breakpoint'>>
  ): Promise<void>
  deleteThread(id: string): Promise<void>

  createStep(threadId: string, input: { title: string; tool?: string }): Promise<string>
  updateStep(
    id: string,
    patch: Partial<Pick<Step, 'title' | 'status' | 'tool' | 'prompt' | 'notes'>>
  ): Promise<void>
  moveStep(id: string, direction: -1 | 1): Promise<void>
  deleteStep(id: string): Promise<void>

  createArtifact(input: {
    threadId: string
    stepId: string
    kind: Artifact['kind']
    title: string
    content: string
  }): Promise<string>
  deleteArtifact(id: string): Promise<void>

  createLog(input: { threadId: string; content: string; source: LogSource }): Promise<string>
  deleteLog(id: string): Promise<void>

  dashboard(): Promise<Dashboard>

  refreshBreakpoint(threadId: string): Promise<Breakpoint>
  /** 后台刷新，不等结果；失败时用系统通知提示 */
  refreshBreakpointInBackground(threadId: string): Promise<void>

  getSettings(): Promise<PublicSettings>
  setCurrentThread(id: string | null): Promise<void>
  setModel(model: string): Promise<void>
  setApiKey(key: string): Promise<void>
  clearApiKey(): Promise<void>

  readClipboard(): Promise<string>
  copyText(text: string): Promise<void>
  showDataDir(): Promise<void>
  closeCapture(): Promise<void>
}

export type MainEvent = 'data-changed' | 'navigate' | 'capture-opened'
