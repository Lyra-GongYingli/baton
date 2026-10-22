import { useState } from 'react'
import { api } from '../api'
import { AutoTextarea } from '../components/Editable'

export function NewThreadDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')

  const submit = async (): Promise<void> => {
    if (!title.trim()) return
    onCreated(await api.createThread({ title, goal }))
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
        <h2>新线程</h2>
        <label className="field">
          <span>名称</span>
          <input
            autoFocus
            value={title}
            placeholder="比如：Moras 新手引导改版"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
            }}
          />
        </label>
        <label className="field">
          <span>目标（可以之后再写）</span>
          <AutoTextarea
            value={goal}
            minRows={3}
            placeholder="做完之后是什么样子？"
            onChange={(e) => setGoal(e.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!title.trim()} onClick={submit}>
            创建
          </button>
        </div>
      </div>
    </div>
  )
}
