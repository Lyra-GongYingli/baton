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
import { HOOK_AGENTS, type BatonApi, type HookAgent, type MainEvent } from '../shared/types'
import * as db from './db'
import * as agentHooks from './agentHooks'
import { claudeCodeStatus, connectClaudeCode } from './claudeCode'
import * as dock from './dock'
import * as line from './line'
import * as live from './live'
import * as mcp from './mcp'
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
    // 在你现在所在的桌面打开：先让它出现在所有桌面上，显示出来以后再取消，它就留在当前这个桌面，
    // 不会把你拽回它上次待的桌面
    win.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true })
    win.show()
    win.focus()
    win.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true })
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
  const running = db.processBoard().columns.active
  tray.setToolTip(`Baton · ${running.length} 个进行中`)

  const item = (i: (typeof running)[number]): Electron.MenuItemConstructorOptions => ({
    label: `  S${i.ref} ${i.title} · ${i.taskTitle}`,
    click: () => dock.setDockOpen(true, { focus: true, taskId: i.taskId })
  })
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: running.length ? `进行中（${running.length}）` : '没有进行中的子任务', enabled: false },
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

/** 接入 / 断开 Claude Code、Codex 的 hooks；接入情况变了，头像动不动的规则也跟着变 */
function setHooks(agent: HookAgent, on: boolean): { ok: boolean; message: string } {
  const res = on
    ? agentHooks.connectHooks(agent, mcp.HOOKS_URL, settings.getMcpToken())
    : agentHooks.disconnectHooks(agent)
  broadcast('live-changed')
  return res
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
  deleteProject: (id) => {
    // 当前任务在这个项目里的话，一起清掉
    const current = settings.getCurrentTaskId()
    const inProject = current ? db.getTask(current)?.project.id === id : false
    db.deleteProject(id)
    if (inProject) settings.setCurrentTask(null)
  },
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
  arrangeSubtasks: db.arrangeSubtasks,
  deleteSubtask: db.deleteSubtask,

  processBoard: db.processBoard,
  calendar: db.calendar,
  lineBoard: db.lineBoard,
  dashboard: db.dashboard,
  assignSubtask: db.assignSubtask,

  getSettings: () => ({
    ...settings.getPublicSettings(),
    mcp: { url: mcp.MCP_URL, token: settings.getMcpToken(), ...mcp.mcpState() }
  }),
  setCurrentTask: (id) => {
    settings.setCurrentTask(id)
    broadcast('data-changed')
  },

  copyText: (text) => clipboard.writeText(text),
  showDataDir: () => shell.showItemInFolder(join(app.getPath('userData'), 'baton.db')),

  dockOpen: (opts) => {
    // 固定住的晾衣绳不收，和侧边栏一起挂着
    line.closeLine()
    dock.setDockOpen(true, opts)
  },
  dockClose: (opts) => {
    if (opts?.force || !settings.getDock().pinned) dock.setDockOpen(false)
  },
  dockClosed: dock.finishClose,
  getDockState: dock.getDockState,
  setDockPinned: dock.setPinned,
  setDockSide: dock.setSide,
  moveHandle: dock.moveHandle,
  lineToggle: line.toggleLine,
  lineTogglePin: line.togglePin,
  lineState: line.lineState,
  lineOpen: () => line.setLineOpen(true),
  lineClose: line.closeLine,
  lineClosed: line.finishLineClose,
  lineInteractive: line.setLineInteractive,
  claudeCodeStatus,
  connectClaudeCode: () => connectClaudeCode(mcp.MCP_URL, settings.getMcpToken()),
  liveBoard: () => live.liveBoard(agentHooks.hooksEnabled(mcp.HOOKS_URL, settings.getMcpToken())),
  bindLiveSession: live.bindSession,
  agentHooksStatus: () => HOOK_AGENTS.map((a) => agentHooks.hooksState(a, mcp.HOOKS_URL, settings.getMcpToken())),
  connectAgentHooks: (agent) => setHooks(agent, true),
  disconnectAgentHooks: (agent) => setHooks(agent, false),
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
  'arrangeSubtasks',
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
    // 第一次用：先准备一个默认的项目（文件夹），侧边栏一打开就有地方加任务；以后删掉了不会再自动建
    if (firstRun && db.listProjects().length === 0) db.createProject({ title: '我的项目' })
    dock.createDock({ load: loadRenderer, webPreferences })
    line.createLine({ load: loadRenderer, webPreferences })
    // Claude Code、Codex 通过 hooks 报上来的会话：认出在做哪个任务就标成进行中，会话列表变了就刷新
    live.startLive({
      onLive: () => broadcast('live-changed'),
      onData: afterMutation,
      onNotice: (text) => broadcast('remote-change', text)
    })
    // 让 Claude Code 等 AI 工具能直接操控 Baton；AI 改了东西就刷新界面并提示一下
    mcp.startMcp(
      settings.getMcpToken(),
      (summary) => {
        afterMutation()
        broadcast('remote-change', `AI ${summary}`)
      },
      live.handleHook
    )
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
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    mcp.stopMcp()
  })
}
