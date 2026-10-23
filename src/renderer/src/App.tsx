import { useEffect, useState } from 'react'
import type { ProjectTree } from '../../shared/types'
import { api, onMainEvent, useData } from './api'
import { ProcessView } from './board/ProcessView'
import { ProjectView } from './board/ProjectView'
import { CopyFlash } from './components/Copy'
import { StatusMenuHost } from './components/StatusMenu'
import { Toast, toast } from './dock/parts'
import { cx } from './util'
import { NewTaskDialog } from './views/NewTaskDialog'
import { Settings } from './views/Settings'
import { TaskView } from './views/TaskView'

export type View = { type: 'projects' } | { type: 'process' } | { type: 'settings' } | { type: 'task'; id: string }

/** 大窗口 */
export function App() {
  const [view, setView] = useState<View>({ type: 'projects' })
  const [creating, setCreating] = useState(false)
  const [trees] = useData(() => api.listProjects(), [])
  const [settings] = useData(() => api.getSettings(), [])

  // 侧边栏 / 菜单栏让大窗口跳到某个任务
  useEffect(() => onMainEvent('navigate', (id) => setView({ type: 'task', id: id as string })), [])
  useEffect(() => onMainEvent('remote-change', (msg) => toast(`🤖 ${msg}`)), [])

  // 打开哪个任务，哪个就是「当前任务」（剪贴板快捷键会存到这里）
  useEffect(() => {
    if (view.type === 'task') api.setCurrentTask(view.id)
  }, [view])

  const open = (id: string): void => setView({ type: 'task', id })

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-drag" />
        <div className="brand">
          <span className="baton-mark" />
          Baton
        </div>
        <nav className="main-nav">
          <button
            className={cx('nav-item', view.type === 'projects' && 'active')}
            onClick={() => setView({ type: 'projects' })}
          >
            项目视图
          </button>
          <button
            className={cx('nav-item', view.type === 'process' && 'active')}
            onClick={() => setView({ type: 'process' })}
          >
            进程视图
          </button>
        </nav>

        <div className="thread-groups">
          {(trees ?? []).map((tree) => (
            <ProjectTreeItem
              key={tree.project.id}
              tree={tree}
              currentId={settings?.currentTaskId ?? null}
              activeId={view.type === 'task' ? view.id : null}
              onOpen={open}
            />
          ))}
        </div>

        <div className="sidebar-footer">
          <button className="new-thread" onClick={() => setCreating(true)}>
            ＋ 新任务
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
        {view.type === 'projects' && (
          <div className="page wide">
            <header className="page-header">
              <h1>项目</h1>
              <p className="muted">按住卡片拖动可以排序，也可以拖到别的项目里。双击文字复制。</p>
            </header>
            {trees && <ProjectView wide trees={trees} onOpenTask={open} />}
          </div>
        )}
        {view.type === 'process' && <ProcessPage onOpenTask={open} />}
        {view.type === 'settings' && <Settings />}
        {view.type === 'task' && (
          <TaskView key={view.id} id={view.id} onDeleted={() => setView({ type: 'projects' })} />
        )}
      </main>

      {creating && (
        <NewTaskDialog
          trees={trees ?? []}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            open(id)
          }}
        />
      )}
      <Toast />
      <CopyFlash />
      <StatusMenuHost />
    </div>
  )
}

function ProcessPage({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const [board] = useData(() => api.processBoard(), [])
  return (
    <div className="page wide">
      <header className="page-header">
        <h1>进程</h1>
        <p className="muted">按状态看所有在推进的子任务。把卡片拖到另一列，就是改成那个状态。</p>
      </header>
      {board && <ProcessView board={board} onOpenTask={onOpenTask} />}
    </div>
  )
}

function ProjectTreeItem(props: {
  tree: ProjectTree
  currentId: string | null
  activeId: string | null
  onOpen: (id: string) => void
}) {
  const { project, tasks } = props.tree
  const [collapsed, setCollapsed] = useState(false)
  const visible = tasks.filter((t) => t.status !== 'done')
  return (
    <div className="thread-group">
      <button className="group-title" onClick={() => setCollapsed(!collapsed)}>
        <span className={cx('chevron', collapsed && 'collapsed')}>▾</span>
        <span className="thread-color" style={{ background: project.color }} />
        {project.title}
        <span className="count">{visible.length}</span>
      </button>
      {!collapsed &&
        visible.map((t) => (
          <button
            key={t.id}
            className={cx('thread-item', props.activeId === t.id && 'active', t.status === 'paused' && 'paused')}
            onClick={() => props.onOpen(t.id)}
          >
            <span className="thread-item-title">{t.title}</span>
            {props.currentId === t.id && <span className="current-mark" title="当前任务：剪贴板快捷键会存到这里" />}
          </button>
        ))}
      {!collapsed && visible.length === 0 && <div className="group-empty">还没有任务</div>}
    </div>
  )
}
