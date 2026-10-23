import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { SubtaskStatus } from '../../../shared/types'
import { api } from '../api'
import { cx } from '../util'

// ---------- 小图标 ----------

const svg = (path: ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
)

export const Icon = {
  plus: () => svg(<path d="M12 5v14M5 12h14" />),
  pin: () => svg(<path d="M9 4h6l-1 6 4 3H6l4-3-1-6zM12 13v7" />),
  expand: () => svg(<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />),
  back: () => svg(<path d="M15 18l-6-6 6-6" />, 18),
  copy: () => svg(<><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>, 14),
  check: () => svg(<path d="M5 12.5l4.5 4.5L19 7.5" />, 14),
  grip: () => svg(<><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>, 14),
  sparkle: () => svg(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />, 14),
  send: () => svg(<path d="M12 19V5M6 11l6-6 6 6" />, 16),
  /** 晾衣绳：一根绳上夹着三张小卡片 */
  line: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M0.5 2.5Q8 8.5 15.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <g className="mini-card a">
        <rect x="2.9" y="3.2" width="1" height="2.2" />
        <rect x="1.6" y="5" width="3.6" height="4.4" rx="0.9" />
      </g>
      <g className="mini-card b">
        <rect x="7.5" y="4.3" width="1" height="2.2" />
        <rect x="6.1" y="6.1" width="3.8" height="6.2" rx="0.9" />
      </g>
      <g className="mini-card c">
        <rect x="12.1" y="3.2" width="1" height="2.2" />
        <rect x="10.8" y="5" width="3.6" height="5.2" rx="0.9" />
      </g>
    </svg>
  )
}

// ---------- 轻提示 ----------

const TOAST_EVENT = 'baton-toast'

export function toast(message: string): void {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }))
}

export function Toast() {
  const [msg, setMsg] = useState<{ text: string; key: number } | null>(null)
  useEffect(() => {
    let timer = 0
    const onToast = (e: Event): void => {
      setMsg({ text: (e as CustomEvent<string>).detail, key: Date.now() })
      clearTimeout(timer)
      timer = window.setTimeout(() => setMsg(null), 1800)
    }
    window.addEventListener(TOAST_EVENT, onToast)
    return () => window.removeEventListener(TOAST_EVENT, onToast)
  }, [])
  if (!msg) return null
  return (
    <div key={msg.key} className="dock-toast">
      {msg.text}
    </div>
  )
}

// ---------- 拖放 ----------

/** 从 Baton 自己拖出去的内容带这个标记，避免又被自己接住 */
export const INTERNAL_DRAG = 'application/x-baton'

/** 把拖进来的东西变成一段文字：文件 → 路径，链接 → 网址，文字 → 原文 */
export function readDrop(dt: DataTransfer): string {
  const files = [...dt.files]
  if (files.length > 0) {
    return files.map((f) => `文件：${window.baton.pathForFile(f) || f.name}`).join('\n')
  }
  const text = dt.getData('text/plain').trim()
  if (text) return text
  return dt
    .getData('text/uri-list')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .join('\n')
}

export function useDropTarget(onText: (text: string) => void) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const external = (e: DragEvent): boolean => !e.dataTransfer.types.includes(INTERNAL_DRAG)

  return {
    over,
    props: {
      onDragEnter: (e: DragEvent) => {
        if (!external(e)) return
        e.preventDefault()
        e.stopPropagation()
        depth.current++
        setOver(true)
      },
      onDragOver: (e: DragEvent) => {
        if (!external(e)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
      },
      onDragLeave: (e: DragEvent) => {
        e.stopPropagation()
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        depth.current = 0
        setOver(false)
        if (!external(e)) return
        const text = readDrop(e.dataTransfer)
        if (text) onText(text)
      }
    }
  }
}

// ---------- 复制按钮：小图标，点一下复制，按住拖进 AI 的输入框 ----------

export function PromptPill({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const [dragging, setDragging] = useState(false)

  return (
    <button
      className={cx('copy-btn', label ? 'with-label' : 'icon-only', copied && 'copied', dragging && 'dragging')}
      draggable
      title={`${label ?? '复制提示词'}：点一下复制，也可以按住直接拖进 ChatGPT / Claude 的输入框`}
      // 别让外层的拖动排序、点一下编辑抢走这次操作
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={async (e) => {
        e.stopPropagation()
        await api.copyText(text)
        setCopied(true)
        toast('✓ 已复制，去粘贴给 AI 吧')
        setTimeout(() => setCopied(false), 1400)
      }}
      onDragStart={(e) => {
        e.stopPropagation()
        e.dataTransfer.setData('text/plain', text)
        e.dataTransfer.setData(INTERNAL_DRAG, '1')
        e.dataTransfer.effectAllowed = 'copy'
        setDragging(true)
      }}
      onDragEnd={(e) => {
        setDragging(false)
        if (e.dataTransfer.dropEffect !== 'none') toast('✓ 提示词送过去了')
      }}
    >
      {copied ? <Icon.check /> : <Icon.copy />}
      {label && <span>{copied ? '已复制' : label}</span>}
    </button>
  )
}

// ---------- 接力跑道：每段是一个子任务 ----------

export function Track({ statuses }: { statuses: SubtaskStatus[] }) {
  if (statuses.length === 0) return <div className="track empty" />
  return (
    <div className="track">
      {statuses.map((s, i) => (
        <span key={i} className={cx('seg', `s-${s}`)} />
      ))}
    </div>
  )
}

export function IconButton({
  title,
  active,
  onClick,
  children
}: {
  title: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button className={cx('icon-btn', active && 'active')} title={title} onClick={onClick}>
      {children}
    </button>
  )
}

/** 由 id 算出一个 -0.5° ~ 0.5° 的小倾角，让卡片像夹在板子上 */
export function tiltOf(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 17 + ch.charCodeAt(0)) >>> 0
  return `${((h % 5) - 2) * 0.25}deg`
}
