import { useEffect, useRef, useState } from 'react'
import { titleFromText } from '../../../shared/prompt'
import type { DockState, LineState } from '../../../shared/types'
import { api, onMainEvent, useData } from '../api'
import { useDelayedClick } from '../components/Copy'
import { cx } from '../util'
import { Icon, useDropTarget } from './parts'

/**
 * 贴在屏幕边上的小把手：点一下展开侧边栏，也可以把东西直接扔上来。
 * 上面的小圆钮放下晾衣绳（进程）：单击放下 / 收起，双击固定住。
 */
export function Handle() {
  const [trees] = useData(() => api.listProjects(), [])
  const [state, setState] = useState<DockState>()
  const [line, setLine] = useState<LineState>({ open: false, pinned: false })
  const [saved, setSaved] = useState(false)
  // 单击要等一下，确认不是双击（双击 = 固定）
  const lineClick = useDelayedClick(() => api.lineToggle())
  const springTimer = useRef(0)
  const drag = useRef<{ startY: number; moved: boolean } | null>(null)

  useEffect(() => {
    api.getDockState().then(setState)
    const offDock = onMainEvent('dock-state', (s) => setState(s as DockState))
    api.lineState().then(setLine)
    const offLine = onMainEvent('line-state', (s) => setLine(s as LineState))
    return () => {
      offDock()
      offLine()
    }
  }, [])

  const active = (trees ?? []).flatMap((t) => t.tasks).filter((t) => t.status === 'active' || t.status === 'todo')

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

  // 点开的拿到焦点（点别处、按 Esc 收起）；拖着东西停留弹开的只是「探出来」，鼠标没进去会自己收回
  const open = (peek: boolean): void => {
    api.dockOpen(peek ? { peek } : { focus: true })
  }

  return (
    <div className={cx('handle', `side-${state?.side ?? 'right'}`, drop.over && 'drop-over', saved && 'saved')}>
      <button
        className={cx('handle-line-btn', line.open && 'on', line.pinned && 'pinned')}
        title={
          line.pinned
            ? '晾衣绳已固定。单击收起，双击取消固定'
            : line.open
              ? '单击收起晾衣绳，双击固定住'
              : '晾出进程：单击放下，双击固定住（点别的软件也不收）'
        }
        onClick={lineClick.onClick}
        onDoubleClick={() => {
          lineClick.cancel()
          api.lineTogglePin()
        }}
      >
        <Icon.line />
        {line.pinned && <span className="handle-line-pin" />}
      </button>
      <div
        className="handle-pill"
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
              className={cx('handle-dot', t.statuses.includes('active') && 'running')}
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
