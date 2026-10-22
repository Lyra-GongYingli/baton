import { useEffect, useRef, useState } from 'react'
import type { DockState } from '../../../shared/types'
import { api, onMainEvent, useData } from '../api'
import { cx, titleFromText } from '../util'
import { useDropTarget } from './parts'

/** 贴在屏幕边上的小把手：碰一下展开侧边栏，也可以把东西直接扔上来 */
export function Handle() {
  const [trees] = useData(() => api.listProjects(), [])
  const [state, setState] = useState<DockState>()
  const [saved, setSaved] = useState(false)
  const hoverTimer = useRef(0)
  const springTimer = useRef(0)
  const drag = useRef<{ startY: number; moved: boolean } | null>(null)

  useEffect(() => {
    api.getDockState().then(setState)
    return onMainEvent('dock-state', (s) => setState(s as DockState))
  }, [])

  const active = (trees ?? []).flatMap((t) => t.tasks).filter((t) => t.status === 'active')

  // 扔到把手上 = 在当前任务里加一个子任务（没有当前任务就用第一个），文字就是提示词
  const drop = useDropTarget(async (text) => {
    clearTimeout(springTimer.current)
    const settings = await api.getSettings()
    const target = active.find((t) => t.id === settings.currentTaskId) ?? active[0]
    if (!target) {
      api.dockOpen({ focus: true })
      return
    }
    await api.createSubtask(target.id, { title: titleFromText(text), prompt: text })
    setSaved(true)
    setTimeout(() => setSaved(false), 1300)
  })

  const open = (hover: boolean): void => {
    clearTimeout(hoverTimer.current)
    api.dockOpen({ hover })
  }

  return (
    <div className={cx('handle', `side-${state?.side ?? 'right'}`, drop.over && 'drop-over', saved && 'saved')}>
      <div
        className="handle-pill"
        onMouseEnter={() => {
          if (state?.hoverOpen) hoverTimer.current = window.setTimeout(() => open(true), 140)
        }}
        onMouseLeave={() => clearTimeout(hoverTimer.current)}
        onClick={() => {
          if (!drag.current?.moved) open(false)
        }}
        {...drop.props}
        onDragEnter={(e) => {
          drop.props.onDragEnter(e)
          // 拖着东西停留一会儿，像文件夹一样"弹开"侧边栏
          clearTimeout(springTimer.current)
          springTimer.current = window.setTimeout(() => open(true), 650)
        }}
        onDragLeave={(e) => {
          drop.props.onDragLeave(e)
          clearTimeout(springTimer.current)
        }}
      >
        <div className="handle-dots">
          {active.length === 0 && <span className="handle-dot empty" />}
          {active.slice(0, 7).map((t) => (
            <span
              key={t.id}
              className={cx('handle-dot', t.statuses.includes('ai_running') && 'running')}
              style={{ background: t.color }}
            />
          ))}
        </div>
        <span className="handle-saved">✓</span>
        <div
          className="handle-grip"
          title="上下拖动换位置"
          onPointerDown={(e) => {
            e.stopPropagation()
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { startY: e.screenY, moved: false }
            api.moveHandle('start')
          }}
          onPointerMove={(e) => {
            if (!drag.current) return
            const dy = e.screenY - drag.current.startY
            if (Math.abs(dy) > 2) drag.current.moved = true
            api.moveHandle('move', dy)
          }}
          onPointerUp={() => {
            api.moveHandle('end')
            setTimeout(() => (drag.current = null), 0)
          }}
        />
      </div>
    </div>
  )
}
