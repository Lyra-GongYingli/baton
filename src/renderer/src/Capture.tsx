import { useEffect, useRef, useState } from 'react'
import type { ThreadSummary } from '../../shared/types'
import { api, onMainEvent } from './api'
import { AutoTextarea } from './components/Editable'

const NEW_THREAD = '__new__'

/** 全局快捷键呼出的"记断点"小窗 */
export function Capture() {
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [threadId, setThreadId] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [note, setNote] = useState('')
  const [clip, setClip] = useState('')
  const [withClip, setWithClip] = useState(false)
  const [refresh, setRefresh] = useState(true)
  const [hasKey, setHasKey] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  // 每次呼出都重新读取线程、剪贴板，清空表单
  const reset = async (): Promise<void> => {
    const [list, settings, clipboard] = await Promise.all([
      api.listThreads(),
      api.getSettings(),
      api.readClipboard()
    ])
    const active = list.filter((t) => t.status !== 'done')
    setThreads(active)
    const current = active.find((t) => t.id === settings.currentThreadId) ?? active[0]
    setThreadId(current ? current.id : NEW_THREAD)
    setNewTitle('')
    setNote('')
    setClip(clipboard.trim())
    setWithClip(false)
    setHasKey(settings.hasApiKey)
    setTimeout(() => noteRef.current?.focus(), 30)
  }

  useEffect(() => {
    reset()
    return onMainEvent('capture-opened', reset)
  }, [])

  const close = (): void => {
    api.closeCapture()
  }

  const save = async (): Promise<void> => {
    const content = [note.trim(), withClip && clip ? `【剪贴板】\n${clip}` : ''].filter(Boolean).join('\n\n')
    if (!content) return
    let id = threadId
    if (id === NEW_THREAD) {
      if (!newTitle.trim()) return
      id = await api.createThread({ title: newTitle })
    }
    await api.createLog({ threadId: id, content, source: 'quick' })
    await api.setCurrentThread(id)
    if (refresh && hasKey) api.refreshBreakpointInBackground(id)
    close()
  }

  const canSave = (note.trim() || (withClip && clip)) && (threadId !== NEW_THREAD || newTitle.trim())

  return (
    <div
      className="capture"
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
        if (e.key === 'Enter' && e.metaKey) save()
      }}
    >
      <div className="capture-head">
        <span className="capture-title">记断点</span>
        <select className="select" value={threadId} onChange={(e) => setThreadId(e.target.value)}>
          {threads.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
          <option value={NEW_THREAD}>＋ 新建线程…</option>
        </select>
      </div>

      {threadId === NEW_THREAD && (
        <input
          className="capture-new"
          value={newTitle}
          placeholder="新线程的名字"
          onChange={(e) => setNewTitle(e.target.value)}
        />
      )}

      <AutoTextarea
        ref={noteRef}
        className="capture-note"
        minRows={4}
        value={note}
        placeholder="做到哪了？下一步打算做什么？"
        onChange={(e) => setNote(e.target.value)}
      />

      {clip && (
        <label className="capture-clip">
          <input type="checkbox" checked={withClip} onChange={(e) => setWithClip(e.target.checked)} />
          <span>
            附上剪贴板内容（{clip.length} 字）
            <span className="capture-clip-preview">{clip.slice(0, 120)}</span>
          </span>
        </label>
      )}

      <div className="capture-foot">
        {hasKey ? (
          <label className="capture-refresh">
            <input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} />
            保存后让 AI 更新断点卡
          </label>
        ) : (
          <span className="muted small">在设置里填 API key 后，可以自动更新断点卡</span>
        )}
        <div className="spacer" />
        <button className="btn ghost small" onClick={close}>
          取消 <kbd>esc</kbd>
        </button>
        <button className="btn primary small" disabled={!canSave} onClick={save}>
          保存 <kbd>⌘↩</kbd>
        </button>
      </div>
    </div>
  )
}
