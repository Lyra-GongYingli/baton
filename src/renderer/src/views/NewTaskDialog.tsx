import { useState } from 'react'
import type { ProjectTree } from '../../../shared/types'
import { api } from '../api'
import { AutoTextarea } from '../components/Editable'

const NEW_PROJECT = '__new__'

export function NewTaskDialog({
  trees,
  onClose,
  onCreated
}: {
  trees: ProjectTree[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [projectId, setProjectId] = useState(trees[0]?.project.id ?? NEW_PROJECT)
  const [projectTitle, setProjectTitle] = useState('')
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')

  const canSubmit = title.trim() && (projectId !== NEW_PROJECT || projectTitle.trim())

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    const pid = projectId === NEW_PROJECT ? await api.createProject({ title: projectTitle }) : projectId
    onCreated(await api.createTask({ projectId: pid, title, goal }))
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter' && e.metaKey) submit()
        }}
      >
        <h2>新任务</h2>
        <label className="field">
          <span>放在哪个项目</span>
          <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {trees.map((t) => (
              <option key={t.project.id} value={t.project.id}>
                {t.project.title}
              </option>
            ))}
            <option value={NEW_PROJECT}>＋ 新项目…</option>
          </select>
        </label>
        {projectId === NEW_PROJECT && (
          <label className="field">
            <span>新项目叫什么</span>
            <input value={projectTitle} placeholder="比如：Moras" onChange={(e) => setProjectTitle(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span>任务名称</span>
          <input
            autoFocus
            value={title}
            placeholder="比如：新手引导改版"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
            }}
          />
        </label>
        <label className="field">
          <span>目标（可以之后再写）</span>
          <AutoTextarea value={goal} minRows={3} placeholder="做完之后是什么样子？" onChange={(e) => setGoal(e.target.value)} />
        </label>
        <div className="dialog-actions">
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!canSubmit} onClick={submit}>
            创建
          </button>
        </div>
      </div>
    </div>
  )
}
