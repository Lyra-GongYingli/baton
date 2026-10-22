import { useEffect, useState } from 'react'
import { THREAD_STATUS_LABEL, type ThreadStatus, type ThreadSummary } from '../../shared/types'
import { api, onMainEvent, useData } from './api'
import { cx } from './util'
import { Dashboard } from './views/Dashboard'
import { NewThreadDialog } from './views/NewThreadDialog'
import { Settings } from './views/Settings'
import { ThreadView } from './views/ThreadView'

export type View = { type: 'dashboard' } | { type: 'settings' } | { type: 'thread'; id: string; focusStepId?: string }

export function App() {
  const [view, setView] = useState<View>({ type: 'dashboard' })
  const [creating, setCreating] = useState(false)
  const [threads] = useData(() => api.listThreads(), [])
  const [settings, reloadSettings] = useData(() => api.getSettings(), [])

  // 菜单栏点击某个步骤时，主进程让这里跳到对应线程
  useEffect(() => onMainEvent('navigate', (id) => setView({ type: 'thread', id: id as string })), [])

  // 打开哪个线程，哪个就是"当前线程"（剪贴板快捷键会存到这里）
  useEffect(() => {
    if (view.type === 'thread') api.setCurrentThread(view.id).then(reloadSettings)
  }, [view, reloadSettings])

  const open = (id: string, focusStepId?: string): void => setView({ type: 'thread', id, focusStepId })

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-drag" />
        <div className="brand">Baton</div>
        <nav>
          <button
            className={cx('nav-item', view.type === 'dashboard' && 'active')}
            onClick={() => setView({ type: 'dashboard' })}
          >
            总览
          </button>
        </nav>

        <div className="thread-groups">
          {(['active', 'paused', 'done'] as ThreadStatus[]).map((status) => (
            <ThreadGroup
              key={status}
              status={status}
              threads={(threads ?? []).filter((t) => t.status === status)}
              currentId={settings?.currentThreadId ?? null}
              activeId={view.type === 'thread' ? view.id : null}
              onOpen={open}
            />
          ))}
        </div>

        <div className="sidebar-footer">
          <button className="new-thread" onClick={() => setCreating(true)}>
            ＋ 新线程
          </button>
          <button
            className={cx('nav-item', view.type === 'settings' && 'active')}
            onClick={() => setView({ type: 'settings' })}
          >
            设置
          </button>
        </div>
      </aside>

      <main className="main">
        {view.type === 'dashboard' && (
          <Dashboard threads={threads ?? []} onOpen={open} onCreate={() => setCreating(true)} />
        )}
        {view.type === 'settings' && <Settings />}
        {view.type === 'thread' && (
          <ThreadView
            key={view.id}
            id={view.id}
            focusStepId={view.focusStepId}
            onDeleted={() => setView({ type: 'dashboard' })}
          />
        )}
      </main>

      {creating && (
        <NewThreadDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            open(id)
          }}
        />
      )}
    </div>
  )
}

function ThreadGroup(props: {
  status: ThreadStatus
  threads: ThreadSummary[]
  currentId: string | null
  activeId: string | null
  onOpen: (id: string) => void
}) {
  const [collapsed, setCollapsed] = useState(props.status === 'done')
  if (props.threads.length === 0 && props.status !== 'active') return null
  return (
    <div className="thread-group">
      <button className="group-title" onClick={() => setCollapsed(!collapsed)}>
        <span className={cx('chevron', collapsed && 'collapsed')}>▾</span>
        {THREAD_STATUS_LABEL[props.status]}
        <span className="count">{props.threads.length}</span>
      </button>
      {!collapsed &&
        props.threads.map((t) => (
          <button
            key={t.id}
            className={cx('thread-item', props.activeId === t.id && 'active')}
            onClick={() => props.onOpen(t.id)}
          >
            <span className="thread-item-title">{t.title}</span>
            {t.reviewCount > 0 && <span className="badge review">{t.reviewCount}</span>}
            {props.currentId === t.id && <span className="current-mark" title="当前线程：剪贴板快捷键会存到这里" />}
          </button>
        ))}
      {!collapsed && props.threads.length === 0 && <div className="group-empty">还没有线程</div>}
    </div>
  )
}
