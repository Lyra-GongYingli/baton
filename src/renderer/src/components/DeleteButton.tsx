import { useEffect, useState } from 'react'
import { cx } from '../util'

/**
 * 删除用的小「×」：点第一下变成红色的「删除？」，3 秒内再点一下才真的删，不点就自己变回去。
 * 不用系统的 confirm 弹窗：侧边栏和晾衣绳是不激活的面板，系统弹窗可能被别的软件挡住、看不到。
 */
export function DeleteButton({ title, onConfirm }: { title: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      className={cx('row-del', armed && 'armed')}
      title={armed ? '再点一下确认删除' : title}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        if (armed) onConfirm()
        else setArmed(true)
      }}
    >
      {armed ? '删除？' : '×'}
    </button>
  )
}
