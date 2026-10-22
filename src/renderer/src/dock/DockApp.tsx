import { useEffect, useRef, useState } from 'react'
import type { DockState } from '../../../shared/types'
import { api, onMainEvent, useData } from '../api'
import { ProcessView } from '../board/ProcessView'
import { ProjectView } from '../board/ProjectView'
import { CopyFlash } from '../components/Copy'
import { isDragging } from '../components/Sortable'
import { cx } from '../util'
import { DockTask } from './DockTask'
import { Icon, IconButton, Toast } from './parts'

type View = 'project' | 'process'

/** 侧边栏 */
export function DockApp() {
  const [state, setState] = useState<DockState>()
  const [taskId, setTaskId] = useState<string | null>(null)
  const [view, setViewState] = useState<View>(() => (localStorage.getItem('baton.view') as View) || 'project')
  const leaveTimer = useRef(0)
  const mouseInside = useRef(false)

  const setView = (v: View): void => {
    setViewState(v)
    setTaskId(null)
    localStorage.setItem('baton.view', v)
  }

  useEffect(() => {
    api.getDockState().then(setState)
    const offState = onMainEvent('dock-state', (s) => setState(s as DockState))
    const offTask = onMainEvent('dock-show-task', (id) => setTaskId(id as string))
    return () => {
      offState()
      offTask()
    }
  }, [])

  // 鼠标碰把手展开的，如果鼠标一直没进来，过一会儿自己收回去
  useEffect(() => {
    if (!state?.open || !state.openedByHover || state.pinned) return
    const timer = window.setTimeout(() => {
      if (!mouseInside.current) api.dockClose()
    }, 1500)
    return () => clearTimeout(timer)
  }, [state])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 在输入框里按的 Esc 是「取消编辑」，不收起侧边栏。
      // 要看事件发生在哪：等这里收到事件时，输入框可能已经因为取消编辑被移除了
      const inField = (e.target as HTMLElement | null)?.closest?.('input, textarea, select')
      if (e.key === 'Escape' && !inField) api.dockClose({ force: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const typing = (): boolean => document.hasFocus() && !!document.activeElement?.matches('input, textarea, select')

  const onLeave = (): void => {
    mouseInside.current = false
    if (!state || state.pinned || !state.hoverOpen || typing() || isDragging()) return
    clearTimeout(leaveTimer.current)
    leaveTimer.current = window.setTimeout(() => {
      if (!isDragging()) api.dockClose()
    }, 420)
  }

  const onEnter = (): void => {
    mouseInside.current = true
    clearTimeout(leaveTimer.current)
  }

  const open = Boolean(state?.open)

  return (
    <div className={cx('dock-root', `side-${state?.side ?? 'right'}`, open && 'open')}>
      <div
        className="dock-panel"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && e.propertyName === 'transform' && !open) api.dockClosed()
        }}
      >
        <header className="dock-header">
          <div className="dock-brand">
            <span className="baton-mark" />
            Baton
          </div>
          <div className="dock-actions">
            <IconButton
              title={state?.pinned ? '取消钉住（移开鼠标会收起）' : '钉住（一直展开）'}
              active={state?.pinned}
              onClick={() => api.setDockPinned(!state?.pinned)}
            >
              <Icon.pin />
            </IconButton>
            <IconButton title="在大窗口里打开" onClick={() => api.openMainWindow(taskId ?? undefined)}>
              <Icon.expand />
            </IconButton>
          </div>
        </header>

        <div className="view-switch">
          <button className={cx(view === 'project' && !taskId && 'active')} onClick={() => setView('project')}>
            项目
          </button>
          <button className={cx(view === 'process' && !taskId && 'active')} onClick={() => setView('process')}>
            进程
          </button>
          <span className={cx('view-thumb', view === 'process' && 'right')} />
        </div>

        <div className="dock-scroll">
          {taskId ? (
            <DockTask key={taskId} id={taskId} onBack={() => setTaskId(null)} />
          ) : view === 'project' ? (
            <DockProjects onOpenTask={setTaskId} onShowProcess={() => setView('process')} />
          ) : (
            <DockProcess onOpenTask={setTaskId} />
          )}
        </div>
        <Toast />
        <CopyFlash />
      </div>
    </div>
  )
}

function DockProjects({ onOpenTask, onShowProcess }: { onOpenTask: (id: string) => void; onShowProcess: () => void }) {
  const [trees] = useData(() => api.listProjects(), [])
  const [board] = useData(() => api.processBoard(), [])
  if (!trees) return null

  const all = board ? [...board.unassigned, ...Object.values(board.lanes).flat()] : []
  const running = all.filter((i) => i.status === 'ai_running')
  const activeCount = trees.reduce((n, t) => n + t.tasks.filter((x) => x.status === 'active').length, 0)

  return (
    <div className="dock-home">
      <p className="dock-greeting">
        {new Date().toLocaleDateString('zh-CN', { weekday: 'long' })} ·{' '}
        {activeCount ? `${trees.length} 个项目，${activeCount} 个任务在推进` : '还没有任务'}
      </p>

      {running.length > 0 && (
        <button className="running-link" onClick={onShowProcess}>
          <span className="running-dot" />
          {running.length} 个 AI 正在跑
          <span className="typing">
            <i />
            <i />
            <i />
          </span>
          <span className="running-go">看进程 →</span>
        </button>
      )}

      {trees.length === 0 ? <EmptyBaton /> : <ProjectView trees={trees} onOpenTask={onOpenTask} />}
    </div>
  )
}

function DockProcess({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const [board] = useData(() => api.processBoard(), [])
  if (!board) return null
  return (
    <div className="dock-home">
      <ProcessView board={board} onOpenTask={onOpenTask} />
    </div>
  )
}

function EmptyBaton() {
  const [title, setTitle] = useState<string | null>(null)
  return (
    <div className="empty-baton">
      <div className="baton-art">
        <span />
      </div>
      <p>还没有接力棒。</p>
      <p className="muted">先建一个项目，再把要做的事拆成任务。</p>
      {title === null ? (
        <button className="spark-btn" onClick={() => setTitle('')}>
          <Icon.plus /> 新建第一个项目
        </button>
      ) : (
        <input
          className="new-inline-input"
          autoFocus
          value={title}
          placeholder="项目叫什么？回车创建"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Escape') setTitle(null)
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && title.trim()) {
              await api.createProject({ title })
              setTitle(null)
            }
          }}
        />
      )}
    </div>
  )
}
