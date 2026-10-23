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
}

const DEFAULTS: StoredSettings = {
  currentTaskId: null,
  dock: { side: 'right', pinned: false, hoverOpen: true },
  handleRatio: 0.32,
  mcpToken: null
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
        dock: { ...DEFAULTS.dock, ...stored.dock },
        handleRatio: stored.handleRatio ?? DEFAULTS.handleRatio,
        mcpToken: stored.mcpToken ?? null
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

/** MCP 密钥：第一次用时生成，之后一直沿用 */
export function getMcpToken(): string {
  const existing = load().mcpToken
  if (existing) return existing
  const token = randomBytes(24).toString('hex')
  save({ mcpToken: token })
  return token
}

export function getPublicSettings(): Omit<PublicSettings, 'mcp'> {
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
