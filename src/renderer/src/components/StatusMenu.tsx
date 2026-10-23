import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { STATUS_LABEL, STATUS_ORDER, type Status } from '../../../shared/types'
import { cx } from '../util'
import { StatusGlyph } from './StatusPicker'

// 右键菜单：在任务、子任务、子子任务上右击，就地换状态。每个窗口放一个 <StatusMenuHost />。

interface Menu {
  x: number
  y: number
  title: string
  value: Status
  onChange: (status: Status) => void
  /** 状态下面再放几个动作，比如「在侧边栏打开」 */
  actions?: { label: string; onClick: () => void }[]
}

const EVENT = 'baton-status-menu'

export function openStatusMenu(e: MouseEvent, menu: Omit<Menu, 'x' | 'y'>): void {
  // 正在输入框里打字时右击，不抢
  if ((e.target as HTMLElement).closest('input, textarea')) return
  e.preventDefault()
  e.stopPropagation()
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { ...menu, x: e.clientX, y: e.clientY } }))
}

export function StatusMenuHost() {
  const [menu, setMenu] = useState<Menu | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onOpen = (e: Event): void => setMenu((e as CustomEvent<Menu>).detail)
    window.addEventListener(EVENT, onOpen)
    return () => window.removeEventListener(EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onDown = (e: globalThis.MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    // 菜单开着时 Esc 只关菜单，不让窗口拿去收起自己
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', close)
    window.addEventListener('wheel', close, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('wheel', close, true)
    }
  }, [menu])

  // 贴着鼠标弹出；靠近窗口边缘时往里收
  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const { width, height } = ref.current.getBoundingClientRect()
    setPos({
      x: Math.max(6, Math.min(menu.x, window.innerWidth - width - 6)),
      y: Math.max(6, Math.min(menu.y, window.innerHeight - height - 6))
    })
  }, [menu])

  if (!menu) return null
  const pick = (fn: () => void): void => {
    setMenu(null)
    fn()
  }
  return createPortal(
    // line-hit：在晾衣绳窗口里，鼠标在菜单上时要接住点击
    <div ref={ref} className="ctx-menu line-hit" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <div className="ctx-title">{menu.title}</div>
      {STATUS_ORDER.map((s) => (
        <button
          key={s}
          className={cx('agent-option', `t-${s}`, s === menu.value && 'active')}
          onClick={() => pick(() => s !== menu.value && menu.onChange(s))}
        >
          <StatusGlyph status={s} />
          {STATUS_LABEL[s]}
        </button>
      ))}
      {menu.actions?.map((a) => (
        <button key={a.label} className="agent-option ctx-action" onClick={() => pick(a.onClick)}>
          {a.label}
        </button>
      ))}
    </div>,
    document.body
  )
}
