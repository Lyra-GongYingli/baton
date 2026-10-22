import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  Tray
} from 'electron'
import { join } from 'node:path'
import type { BatonApi, MainEvent } from '../shared/types'
import { generateBreakpoint } from './ai'
import * as db from './db'
import * as settings from './settings'

let mainWindow: BrowserWindow | null = null
let captureWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

// ---------- 窗口 ----------

function loadRenderer(win: BrowserWindow, hash = ''): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${hash ? `#${hash}` : ''}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

const webPreferences = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#f7f7f5',
    webPreferences
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  // 关窗口只是隐藏，菜单栏和快捷键继续工作
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  loadRenderer(mainWindow)
}

function showMainWindow(threadId?: string): void {
  if (!mainWindow) createMainWindow()
  mainWindow!.show()
  mainWindow!.focus()
  if (threadId) mainWindow!.webContents.send('navigate', threadId)
}

function createCaptureWindow(): void {
  captureWindow = new BrowserWindow({
    width: 560,
    height: 420,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    transparent: true,
    vibrancy: 'popover',
    visualEffectState: 'active',
    webPreferences
  })
  captureWindow.on('blur', () => captureWindow?.hide())
  captureWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      captureWindow?.hide()
    }
  })
  loadRenderer(captureWindow, 'capture')
}

function showCapture(): void {
  if (!captureWindow) createCaptureWindow()
  // 出现在鼠标所在的屏幕中上方
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  const [w] = captureWindow!.getSize()
  captureWindow!.setPosition(Math.round(x + (width - w) / 2), Math.round(y + height * 0.22))
  captureWindow!.webContents.send('capture-opened')
  captureWindow!.show()
  captureWindow!.focus()
}

function broadcast(event: MainEvent, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(event, ...args)
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show()
}

// ---------- 菜单栏 ----------

function refreshTray(): void {
  if (!tray) return
  const { review, running } = db.dashboard()
  tray.setTitle(review.length > 0 ? ` ${review.length}` : '')
  tray.setToolTip(`Baton · ${review.length} 个等你审核，${running.length} 个 AI 在跑`)

  const items: Electron.MenuItemConstructorOptions[] = [
    { label: review.length ? `等我审核（${review.length}）` : '没有等你审核的步骤', enabled: false },
    ...review.slice(0, 10).map((r) => ({
      label: `  S${r.stepRef} ${r.stepTitle} · ${r.threadTitle}`,
      click: () => showMainWindow(r.threadId)
    }))
  ]
  if (running.length) {
    items.push(
      { type: 'separator' },
      { label: `AI 在跑（${running.length}）`, enabled: false },
      ...running.slice(0, 10).map((r) => ({
        label: `  S${r.stepRef} ${r.stepTitle} · ${r.threadTitle}`,
        click: () => showMainWindow(r.threadId)
      }))
    )
  }
  items.push(
    { type: 'separator' },
    { label: '记断点…', accelerator: settings.SHORTCUTS.capture, click: showCapture },
    { label: '打开 Baton', click: () => showMainWindow() },
    { type: 'separator' },
    { label: '退出', role: 'quit' }
  )
  tray.setContextMenu(Menu.buildFromTemplate(items))
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/trayTemplate.png'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  refreshTray()
}

// ---------- 全局快捷键 ----------

function saveClipboardToCurrentThread(): void {
  const text = clipboard.readText().trim()
  if (!text) {
    notify('剪贴板是空的', '先复制点内容再按快捷键')
    return
  }
  const threadId = settings.getCurrentThreadId()
  const detail = threadId ? db.getThread(threadId) : null
  if (!detail) {
    // 没有当前线程：打开记录窗口让用户选
    showCapture()
    return
  }
  db.createLog({ threadId: detail.thread.id, content: text, source: 'clipboard' })
  afterMutation()
  notify(`已存到「${detail.thread.title}」`, text.slice(0, 80))
}

function registerShortcuts(): void {
  const ok1 = globalShortcut.register(settings.SHORTCUTS.capture, showCapture)
  const ok2 = globalShortcut.register(settings.SHORTCUTS.clipboard, saveClipboardToCurrentThread)
  if (!ok1 || !ok2) notify('部分快捷键注册失败', '可能被其他软件占用了')
}

// ---------- IPC ----------

function afterMutation(): void {
  broadcast('data-changed')
  refreshTray()
}

async function refreshBreakpoint(threadId: string) {
  const detail = db.getThread(threadId)
  if (!detail) throw new Error('线程不存在')
  const breakpoint = await generateBreakpoint(detail)
  db.updateThread(threadId, { breakpoint })
  afterMutation()
  return breakpoint
}

type Handlers = {
  [K in keyof BatonApi]: (
    ...args: Parameters<BatonApi[K]>
  ) => Awaited<ReturnType<BatonApi[K]>> | ReturnType<BatonApi[K]>
}

const handlers: Handlers = {
  listThreads: db.listThreads,
  getThread: db.getThread,
  createThread: db.createThread,
  updateThread: db.updateThread,
  deleteThread: (id) => {
    db.deleteThread(id)
    if (settings.getCurrentThreadId() === id) settings.setCurrentThread(null)
  },
  createStep: db.createStep,
  updateStep: db.updateStep,
  moveStep: db.moveStep,
  deleteStep: db.deleteStep,
  createArtifact: db.createArtifact,
  deleteArtifact: db.deleteArtifact,
  createLog: db.createLog,
  deleteLog: db.deleteLog,
  dashboard: db.dashboard,

  refreshBreakpoint,
  refreshBreakpointInBackground: (threadId) => {
    refreshBreakpoint(threadId).catch((err: Error) => notify('断点卡更新失败', err.message))
  },

  getSettings: settings.getPublicSettings,
  setCurrentThread: settings.setCurrentThread,
  setModel: settings.setModel,
  setApiKey: settings.setApiKey,
  clearApiKey: settings.clearApiKey,

  readClipboard: () => clipboard.readText(),
  copyText: (text) => clipboard.writeText(text),
  showDataDir: () => shell.showItemInFolder(join(app.getPath('userData'), 'baton.db')),
  closeCapture: () => captureWindow?.hide()
}

// 这些调用会改数据，完成后通知所有窗口刷新
const MUTATIONS = new Set<keyof BatonApi>([
  'createThread',
  'updateThread',
  'deleteThread',
  'createStep',
  'updateStep',
  'moveStep',
  'deleteStep',
  'createArtifact',
  'deleteArtifact',
  'createLog',
  'deleteLog'
])

ipcMain.handle('api', async (_e, name: keyof BatonApi, ...args: unknown[]) => {
  const fn = handlers[name] as ((...a: unknown[]) => unknown) | undefined
  if (!fn) throw new Error(`未知方法：${String(name)}`)
  const result = await fn(...args)
  if (MUTATIONS.has(name)) afterMutation()
  return result
})

// ---------- 启动 ----------

// 开发/测试时可以用单独的数据目录：BATON_DATA_DIR=/tmp/baton-test npm run dev
if (process.env.BATON_DATA_DIR) app.setPath('userData', process.env.BATON_DATA_DIR)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  app.whenReady().then(() => {
    db.openDb(join(app.getPath('userData'), 'baton.db'))
    createMainWindow()
    createCaptureWindow()
    createTray()
    registerShortcuts()
  })

  app.on('activate', () => showMainWindow())
  app.on('before-quit', () => {
    quitting = true
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
}
