import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../util'

/**
 * 点开的小菜单（状态、执行者）：放到 body 下面，贴着按钮弹出，放不下就往上、往里收。
 * 不放在卡片里面：卡片歪着放、各自一层，后面的卡片会把菜单盖住；晾衣绳卡片里能滚动的那一块也会把它截掉。
 */
export function PopMenu({
  anchor,
  owner,
  align,
  className,
  onClose,
  children
}: {
  /** 按钮的位置（点开时量的） */
  anchor: DOMRect
  /** 按钮所在的那一块：在它上面按下不算点在外面，让按钮自己开关菜单 */
  owner: RefObject<HTMLElement | null>
  /** 菜单的哪一边和按钮对齐 */
  align: 'left' | 'right'
  className?: string
  onClose: () => void
  children: ReactNode
}) {
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 6 })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !owner.current?.contains(target)) onClose()
    }
    // Esc 只关菜单，别让窗口拿去收起自己
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    // 位置是点开时算好的，底下一滚就对不上了
    window.addEventListener('scroll', onClose, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose, owner])

  useLayoutEffect(() => {
    if (!ref.current) return
    // 用排版尺寸量：弹出动画一开始是缩小的，getBoundingClientRect 量出来偏小
    const width = ref.current.offsetWidth
    const height = ref.current.offsetHeight
    const below = anchor.bottom + 6 + height <= window.innerHeight - 6
    const left = align === 'right' ? anchor.right - width : anchor.left
    setPos({
      // 左右离窗口边缘留 20px：侧边栏窗口四周有 14px 透明边，别伸到面板外面去
      left: Math.max(20, Math.min(left, window.innerWidth - width - 20)),
      top: below ? anchor.bottom + 6 : Math.max(6, anchor.top - height - 6)
    })
  }, [anchor, align])

  return createPortal(
    <div
      ref={ref}
      // line-hit：在晾衣绳窗口里，鼠标在菜单上时要接住点击
      className={cx('agent-menu', 'pop-menu', `align-${align}`, 'line-hit', className)}
      style={{ left: pos.left, top: pos.top }}
      // 菜单虽然放在 body 下面，React 的事件还是会冒到卡片上（卡片单击 = 打开任务、按住 = 拖动），在这里拦住
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {children}
    </div>,
    document.body
  )
}
