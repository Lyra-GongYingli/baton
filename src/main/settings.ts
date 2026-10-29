import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DockSettings, DockSide, PublicSettings } from '../shared/types'

export const SHORTCUTS = {
  dock: 'Control+Alt+D'
}

interface StoredSettings {
  currentTaskId: string | null
  dock: DockSettings
  /** 把手在屏幕上的纵向位置，0 = 顶部，1 = 底部 */
  handleRatio: number
  /** AI 工具连 MCP 服务用的密钥 */
  mcpToken: string | null
  /** 晾衣绳固定住了：一直挂着，点别的软件也不收，重启后还在 */
  linePinned: boolean
  /** 认不出是哪个任务的 AI 会话，自动记在哪个项目里；null = 还没定（用到时找或建「AI 任务」） */
  aiProjectId: string | null
  /** 自动记下的 AI 会话都是这个任务的子任务；null = 还没有（用到时建「AI 会话」） */
  aiTaskId: string | null
}

const DEFAULTS: StoredSettings = {
  currentTaskId: null,
  dock: { side: 'right', pinned: false },
  handleRatio: 0.32,
  mcpToken: null,
  linePinned: false,
  aiProjectId: null,
  aiTaskId: null
}

/** settings.json 是不是第一次创建（用来在首次启动时展开侧边栏打个招呼） */
export function isFirstRun(): boolean {
  return !existsSync(file())
}

let cache: StoredSettings | null = null

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function load(): StoredSettings {
  if (cache) return cache
  cache = { ...DEFAULTS }
  if (existsSync(file())) {
    try {
      const stored = JSON.parse(readFileSync(file(), 'utf8'))
      // 只读认识的字段；旧版的 API key、模型等字段在下次保存时自然丢掉
      cache = {
        // 第一版叫 currentThreadId，任务 id 没变，直接沿用
        currentTaskId: stored.currentTaskId ?? stored.currentThreadId ?? null,
        // 旧版的「鼠标碰到把手就展开」（hoverOpen）已经去掉，不再读
        dock: { side: stored.dock?.side ?? DEFAULTS.dock.side, pinned: stored.dock?.pinned ?? DEFAULTS.dock.pinned },
        handleRatio: stored.handleRatio ?? DEFAULTS.handleRatio,
        mcpToken: stored.mcpToken ?? null,
        linePinned: stored.linePinned ?? false,
        aiProjectId: stored.aiProjectId ?? null,
        aiTaskId: stored.aiTaskId ?? null
      }
    } catch {
      // 文件坏了就用默认值
    }
  }
  return cache!
}

function save(patch: Partial<StoredSettings>): void {
  cache = { ...load(), ...patch }
  writeFileSync(file(), JSON.stringify(cache, null, 2))
}

export function getLinePinned(): boolean {
  return load().linePinned
}

export function setLinePinned(linePinned: boolean): void {
  save({ linePinned })
}

/** MCP 密钥：第一次用时生成，之后一直沿用 */
export function getMcpToken(): string {
  const existing = load().mcpToken
  if (existing) return existing
  const token = randomBytes(24).toString('hex')
  save({ mcpToken: token })
  return token
}

export function getAiProjectId(): string | null {
  return load().aiProjectId
}

export function setAiProjectId(aiProjectId: string): void {
  if (load().aiProjectId !== aiProjectId) save({ aiProjectId })
}

export function getAiTaskId(): string | null {
  return load().aiTaskId
}

export function setAiTaskId(aiTaskId: string): void {
  if (load().aiTaskId !== aiTaskId) save({ aiTaskId })
}

export function getPublicSettings(): Omit<PublicSettings, 'mcp' | 'aiProjectId'> {
  const s = load()
  return {
    currentTaskId: s.currentTaskId,
    dataDir: app.getPath('userData'),
    shortcuts: SHORTCUTS,
    dock: s.dock
  }
}

export function getDock(): DockSettings {
  return load().dock
}

export function setDock(patch: Partial<DockSettings>): void {
  save({ dock: { ...load().dock, ...patch } })
}

export function setDockSide(side: DockSide): void {
  setDock({ side })
}

export function getHandleRatio(): number {
  return load().handleRatio
}

export function setHandleRatio(ratio: number): void {
  save({ handleRatio: Math.min(0.92, Math.max(0.02, ratio)) })
}

export function getCurrentTaskId(): string | null {
  return load().currentTaskId
}

export function setCurrentTask(id: string | null): void {
  save({ currentTaskId: id })
}
