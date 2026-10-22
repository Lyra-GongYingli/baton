import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { api } from '../api'
import { cx } from '../util'

// 双击复制：双击任何标了 Copyable 的文字，复制它，并在鼠标位置冒出「✓ 已复制」

const EVENT = 'baton-copied'

export function flashCopied(x: number, y: number): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { x, y } }))
}

export async function copyWithFlash(text: string, e: MouseEvent): Promise<void> {
  window.getSelection()?.removeAllRanges()
  await api.copyText(text)
  flashCopied(e.clientX, e.clientY)
}

export function Copyable({
  text,
  children,
  className
}: {
  /** 要复制的内容；不传就复制显示出来的文字 */
  text?: string
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cx('copyable', className)}
      title="双击复制"
      onDoubleClick={(e) => {
        e.stopPropagation()
        copyWithFlash(text ?? e.currentTarget.innerText, e)
      }}
    >
      {children}
    </span>
  )
}

/** 每个窗口放一个，负责显示「✓ 已复制」 */
export function CopyFlash() {
  const [flashes, setFlashes] = useState<{ id: number; x: number; y: number }[]>([])
  useEffect(() => {
    const onCopied = (e: Event): void => {
      const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail
      const id = Date.now() + Math.random()
      setFlashes((f) => [...f, { id, x, y }])
      setTimeout(() => setFlashes((f) => f.filter((it) => it.id !== id)), 1100)
    }
    window.addEventListener(EVENT, onCopied)
    return () => window.removeEventListener(EVENT, onCopied)
  }, [])
  return (
    <>
      {flashes.map((f) => (
        <span key={f.id} className="copy-flash" style={{ left: f.x, top: f.y }}>
          ✓ 已复制
        </span>
      ))}
    </>
  )
}

/**
 * 同一个元素上既要单击（打开）又要双击（复制）时用：单击会等一下，确认不是双击再执行。
 */
export function useDelayedClick(onClick: () => void, delay = 230) {
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  return {
    onClick: (e: MouseEvent) => {
      clearTimeout(timer.current)
      if (e.detail > 1) return
      timer.current = window.setTimeout(onClick, delay)
    },
    cancel: () => clearTimeout(timer.current)
  }
}
