import { BrowserWindow, screen, type BrowserWindowConstructorOptions, type Rectangle } from 'electron'
import type { DockSide, DockState } from '../shared/types'
import * as settings from './settings'

// 侧边栏 = 两个透明的置顶窗口：
//   handle：贴在屏幕边缘的小把手，一直在
//   panel：展开后的侧边栏，收起时隐藏
// 窗口本身不动，滑入滑出的动画由界面里的 CSS 完成。

export const PANEL_W = 384
/** 面板四周留给阴影的透明边距，和界面 CSS 里的 --dock-margin 一致 */
export const PANEL_MARGIN = 14
const HANDLE_W = 34
/** 把手 + 上面的晾衣绳小圆钮 */
const HANDLE_H = 216

export interface Deps {
  load: (win: BrowserWindow, hash: string) => void
  webPreferences: BrowserWindowConstructorOptions['webPreferences']
}

let panel: BrowserWindow | null = null
let handle: BrowserWindow | null = null
let open = false
let openedByHover = false
let hideTimer: NodeJS.Timeout | null = null
let dragStartY = 0

export const floating: BrowserWindowConstructorOptions = {
  frame: false,
  transparent: true,
  hasShadow: false,
  resizable: false,
  movable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  skipTaskbar: true,
  alwaysOnTop: true,
  show: false,
  acceptFirstMouse: true,
  backgroundColor: '#00000000'
}

export function workArea(): Rectangle {
  return screen.getPrimaryDisplay().workArea
}

function side(): DockSide {
  return settings.getDock().side
}

function panelBounds(): Rectangle {
  const wa = workArea()
  const width = PANEL_W + PANEL_MARGIN * 2
  return { x: side() === 'right' ? wa.x + wa.width - width : wa.x, y: wa.y, width, height: wa.height }
}

function handleBounds(top?: number): Rectangle {
  const wa = workArea()
  const y = top ?? Math.round(wa.y + settings.getHandleRatio() * (wa.height - HANDLE_H))
  return {
    x: side() === 'right' ? wa.x + wa.width - HANDLE_W : wa.x,
    y: Math.min(Math.max(y, wa.y), wa.y + wa.height - HANDLE_H),
    width: HANDLE_W,
    height: HANDLE_H
  }
}

export function makeFloating(win: BrowserWindow): void {
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
}

export function createDock(deps: Deps): void {
  panel = new BrowserWindow({
    ...floating,
    ...panelBounds(),
    webPreferences: { ...deps.webPreferences, backgroundThrottling: false }
  })
  makeFloating(panel)
  // 点到别的软件就收起（钉住时除外）
  panel.on('blur', () => {
    if (open && !settings.getDock().pinned) setDockOpen(false)
  })
  deps.load(panel, 'dock')

  handle = new BrowserWindow({
    ...floating,
    ...handleBounds(),
    focusable: false,
    webPreferences: deps.webPreferences
  })
  makeFloating(handle)
  handle.once('ready-to-show', () => {
    if (!open) handle?.showInactive()
  })
  deps.load(handle, 'handle')

  screen.on('display-metrics-changed', relayout)
  screen.on('display-added', relayout)
  screen.on('display-removed', relayout)
}

export function relayout(): void {
  panel?.setBounds(panelBounds())
  handle?.setBounds(handleBounds())
  broadcastState()
}

export function getDockState(): DockState {
  const d = settings.getDock()
  return { open, pinned: d.pinned, side: d.side, hoverOpen: d.hoverOpen, openedByHover }
}

function broadcastState(): void {
  const state = getDockState()
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('dock-state', state)
}

export function isDockOpen(): boolean {
  return open
}

export function setDockOpen(
  next: boolean,
  opts: { focus?: boolean; taskId?: string; hover?: boolean } = {}
): void {
  if (!panel || !handle) return
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  if (next) {
    const wasOpen = open
    open = true
    openedByHover = !wasOpen && Boolean(opts.hover)
    if (!wasOpen) panel.setBounds(panelBounds())
    if (opts.focus) {
      panel.show()
      panel.focus()
    } else if (!panel.isVisible()) {
      panel.showInactive()
    }
    handle.hide()
    if (opts.taskId) panel.webContents.send('dock-show-task', opts.taskId)
    broadcastState()
  } else {
    if (!open) return
    open = false
    // 界面播完滑出动画后会调用 finishClose；万一没调用，兜底隐藏
    broadcastState()
    hideTimer = setTimeout(finishClose, 700)
  }
}

export function toggleDock(): void {
  setDockOpen(!open, { focus: true })
}

export function finishClose(): void {
  if (open) return
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  panel?.hide()
  handle?.showInactive()
}

export function setPinned(pinned: boolean): void {
  settings.setDock({ pinned })
  broadcastState()
}

export function setSide(next: DockSide): void {
  settings.setDockSide(next)
  relayout()
}

export function setHoverOpen(hoverOpen: boolean): void {
  settings.setDock({ hoverOpen })
  broadcastState()
}

/** 上下拖动把手，松手后记住位置 */
export function moveHandle(phase: 'start' | 'move' | 'end', dy = 0): void {
  if (!handle) return
  if (phase === 'start') {
    dragStartY = handle.getBounds().y
  } else if (phase === 'move') {
    handle.setBounds(handleBounds(dragStartY + dy))
  } else {
    const wa = workArea()
    settings.setHandleRatio((handle.getBounds().y - wa.y) / (wa.height - HANDLE_H))
  }
}
