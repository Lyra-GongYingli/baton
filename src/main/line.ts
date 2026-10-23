import { BrowserWindow, screen, type Rectangle } from 'electron'
import type { LineState } from '../shared/types'
import { floating, makeFloating, workArea, type Deps } from './dock'
import * as settings from './settings'

// 晾衣绳：屏幕顶部一条透明的置顶窗口，进程视图的卡片一张张夹在绳子上。
// 透明的地方鼠标直接穿过去（点得到下面的软件），只有卡片接得住点击。
// 点把手上的小圆钮放下来；再点一次、按 Esc、或者点到别的软件就收起。
// 双击小圆钮是「固定」：一直挂着，不抢焦点，点别的软件也不收，重启 Baton 后还在。
// 和侧边栏一样，窗口本身不动，掉下来、弹回去的动画由界面里的 CSS 完成。

const LINE_H = 540

let win: BrowserWindow | null = null
let open = false
let pinned = false
let hideTimer: NodeJS.Timeout | null = null
/** 因为失焦收起的时间：点把手上的圆钮时晾衣绳会先失焦收起，紧跟着的那次「切换」不能又把它放下来 */
let blurClosedAt = 0

function bounds(): Rectangle {
  const wa = workArea()
  return { x: wa.x, y: wa.y, width: wa.width, height: Math.min(LINE_H, wa.height) }
}

export function createLine(deps: Deps): void {
  pinned = settings.getLinePinned()
  win = new BrowserWindow({
    ...floating,
    ...bounds(),
    webPreferences: { ...deps.webPreferences, backgroundThrottling: false }
  })
  makeFloating(win)
  win.setIgnoreMouseEvents(true, { forward: true })
  win.on('blur', () => {
    if (!open || pinned) return
    blurClosedAt = Date.now()
    setLineOpen(false)
  })
  deps.load(win, 'line')
  // 上次固定着就接着挂出来（界面加载好后会用 lineState 取到状态）
  if (pinned) win.once('ready-to-show', () => setLineOpen(true))

  const relayout = (): void => win?.setBounds(bounds())
  screen.on('display-metrics-changed', relayout)
  screen.on('display-added', relayout)
  screen.on('display-removed', relayout)
}

export function lineState(): LineState {
  return { open, pinned }
}

function broadcastState(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('line-state', lineState())
}

export function setLineOpen(next: boolean): void {
  if (!win) return
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  // 不管放下还是收起，先让空白处的点击穿过去；鼠标移到卡片上时界面会再打开
  win.setIgnoreMouseEvents(true, { forward: true })
  if (next) {
    open = true
    win.setBounds(bounds())
    // 固定时只是挂着，不抢走正在用的软件的焦点
    if (pinned) {
      win.showInactive()
    } else {
      win.show()
      win.focus()
    }
  } else {
    if (!open) return
    open = false
    // 界面播完收起动画后会调用 finishLineClose；万一没调用，兜底隐藏
    hideTimer = setTimeout(finishLineClose, 1200)
  }
  broadcastState()
}

/** 单击圆钮：放下 / 收起。收起固定着的晾衣绳时顺便取消固定 */
export function toggleLine(): void {
  if (open) {
    setPinned(false)
    setLineOpen(false)
  } else if (Date.now() - blurClosedAt > 350) {
    setLineOpen(true)
  }
}

/** 双击圆钮：固定 / 取消固定。固定时如果还没放下来，就放下来 */
export function togglePin(): void {
  setPinned(!pinned)
  if (pinned && !open) setLineOpen(true)
  else broadcastState()
}

function setPinned(next: boolean): void {
  if (pinned === next) return
  pinned = next
  settings.setLinePinned(next)
}

/** 按 Esc、或者侧边栏要展开时：固定着就不收（要收起点圆钮，或者先取消固定） */
export function closeLine(): void {
  if (pinned) return
  setLineOpen(false)
}

export function finishLineClose(): void {
  if (open) return
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  win?.hide()
}

export function setLineInteractive(on: boolean): void {
  if (open) win?.setIgnoreMouseEvents(!on, { forward: true })
}
