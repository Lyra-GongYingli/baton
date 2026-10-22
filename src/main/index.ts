import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray
} from 'electron'
import { join } from 'node:path'
import type { BatonApi, MainEvent } from '../shared/types'
import * as db from './db'
import * as dock from './dock'
import * as settings from './settings'

let mainWindow: BrowserWindow | null = null
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

/** 大窗口：做细一点的编辑。平时 Baton 只住在侧边栏里，打开大窗口时才出现在程序坞 */
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
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      mainWindow?.hide()
      app.dock?.hide()
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  loadRenderer(mainWindow)
}

function showMainWindow(taskId?: string): void {
  if (!mainWindow) createMainWindow()
  const win = mainWindow!
  app.dock?.show()
  const reveal = (): void => {
    win.show()
    win.focus()
    if (taskId) win.webContents.send('navigate', taskId)
  }
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reveal)
  else reveal()
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
  const board = db.processBoard()
  const all = [...board.unassigned, ...Object.values(board.lanes).flat()]
  const running = all.filter((i) => i.status === 'ai_running')
  tray.setToolTip(`Baton · ${running.length} 个 AI 在跑`)

  const item = (i: (typeof all)[number]): Electron.MenuItemConstructorOptions => ({
    label: `  S${i.ref} ${i.title} · ${i.taskTitle}`,
    click: () => dock.setDockOpen(true, { focus: true, taskId: i.taskId })
  })
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: running.length ? `AI 在跑（${running.length}）` : '没有 AI 在跑', enabled: false },
    ...running.slice(0, 10).map(item),
    { type: 'separator' },
    { label: '显示侧边栏', accelerator: settings.SHORTCUTS.dock, click: () => dock.setDockOpen(true, { focus: true }) },
    { label: '打开大窗口', click: () => showMainWindow() },
    { type: 'separator' },
    { label: '退出', role: 'quit' }
  ]
  tray.setContextMenu(Menu.buildFromTemplate(items))
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/trayTemplate.png'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  refreshTray()
}

// ---------- 全局快捷键 ----------

function registerShortcuts(): void {
  if (!globalShortcut.register(settings.SHORTCUTS.dock, dock.toggleDock)) {
    notify('快捷键注册失败', '⌃⌥D 可能被其他软件占用了')
  }
}

// ---------- IPC ----------

function afterMutation(): void {
  broadcast('data-changed')
  refreshTray()
}

type Handlers = {
  [K in keyof BatonApi]: (
    ...args: Parameters<BatonApi[K]>
  ) => Awaited<ReturnType<BatonApi[K]>> | ReturnType<BatonApi[K]>
}

const handlers: Handlers = {
  listProjects: db.listProjects,
  createProject: db.createProject,
  updateProject: db.updateProject,
  deleteProject: db.deleteProject,
  reorderProjects: db.reorderProjects,

  getTask: db.getTask,
  createTask: db.createTask,
  updateTask: db.updateTask,
  deleteTask: (id) => {
    db.deleteTask(id)
    if (settings.getCurrentTaskId() === id) settings.setCurrentTask(null)
  },
  moveTask: db.moveTask,

  createSubtask: db.createSubtask,
  updateSubtask: db.updateSubtask,
  reorderSubtasks: db.reorderSubtasks,
  deleteSubtask: db.deleteSubtask,

  processBoard: db.processBoard,
  assignSubtask: db.assignSubtask,

  getSettings: settings.getPublicSettings,
  setCurrentTask: (id) => {
    settings.setCurrentTask(id)
    broadcast('data-changed')
  },

  copyText: (text) => clipboard.writeText(text),
  showDataDir: () => shell.showItemInFolder(join(app.getPath('userData'), 'baton.db')),

  dockOpen: (opts) => dock.setDockOpen(true, opts),
  dockClose: (opts) => {
    if (opts?.force || !settings.getDock().pinned) dock.setDockOpen(false)
  },
  dockClosed: dock.finishClose,
  getDockState: dock.getDockState,
  setDockPinned: dock.setPinned,
  setDockSide: dock.setSide,
  setDockHoverOpen: dock.setHoverOpen,
  moveHandle: dock.moveHandle,
  openMainWindow: (taskId) => {
    showMainWindow(taskId)
    if (!settings.getDock().pinned) dock.setDockOpen(false)
  }
}

// 这些调用会改数据，完成后通知所有窗口刷新
const MUTATIONS = new Set<keyof BatonApi>([
  'createProject',
  'updateProject',
  'deleteProject',
  'reorderProjects',
  'createTask',
  'updateTask',
  'deleteTask',
  'moveTask',
  'createSubtask',
  'updateSubtask',
  'reorderSubtasks',
  'deleteSubtask',
  'assignSubtask'
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
  // 再次打开 Baton（比如从「应用程序」里双击）就展开侧边栏
  app.on('second-instance', () => dock.setDockOpen(true, { focus: true }))

  // 拖进窗口的文件不要让页面跳走（刷新同一个页面不拦）
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (e, url) => {
      if (url.split('#')[0] !== contents.getURL().split('#')[0]) e.preventDefault()
    })
  })

  app.whenReady().then(() => {
    const firstRun = settings.isFirstRun()
    app.dock?.hide()
    db.openDb(join(app.getPath('userData'), 'baton.db'))
    dock.createDock({ load: loadRenderer, webPreferences })
    createTray()
    registerShortcuts()
    // 第一次启动时展开侧边栏打个招呼，并写下设置文件，下次就不算第一次了
    if (firstRun) {
      settings.setDock({})
      setTimeout(() => dock.setDockOpen(true), 800)
    }
  })

  app.on('activate', () => {
    if (mainWindow?.isVisible()) mainWindow.focus()
    else dock.setDockOpen(true, { focus: true })
  })
  app.on('before-quit', () => {
    quitting = true
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
}
