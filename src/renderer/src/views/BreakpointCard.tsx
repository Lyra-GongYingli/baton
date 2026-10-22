import { useState } from 'react'
import { expandPrompt } from '../../../shared/prompt'
import type { Breakpoint, ThreadDetail } from '../../../shared/types'
import { api } from '../api'
import { AutoTextarea } from '../components/Editable'
import { CopyButton } from '../components/CopyButton'
import { timeAgo } from '../util'

const EMPTY: Breakpoint = {
  where: '',
  done: '',
  next: '',
  blockers: '',
  nextPrompt: '',
  nextTool: '',
  source: 'manual',
  updatedAt: 0
}

const FIELDS: { key: keyof Pick<Breakpoint, 'where' | 'done' | 'next' | 'blockers'>; label: string }[] = [
  { key: 'where', label: '停在哪' },
  { key: 'next', label: '下一步' },
  { key: 'done', label: '已完成' },
  { key: 'blockers', label: '卡点' }
]

export function BreakpointCard({ detail }: { detail: ThreadDetail }) {
  const { thread, steps } = detail
  const bp = thread.breakpoint
  const [editing, setEditing] = useState<Breakpoint | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const generate = async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      await api.refreshBreakpoint(thread.id)
    } catch (err) {
      // 主进程抛出的错误会带上 "Error invoking remote method..." 前缀
      setError(String((err as Error).message).replace(/^.*?Error: /, ''))
    } finally {
      setLoading(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!editing) return
    await api.updateThread(thread.id, { breakpoint: { ...editing, source: 'manual', updatedAt: Date.now() } })
    setEditing(null)
  }

  if (editing) {
    return (
      <section className="breakpoint editing">
        <div className="breakpoint-head">
          <h2>断点卡</h2>
        </div>
        <div className="bp-grid">
          {FIELDS.map((f) => (
            <label key={f.key} className="bp-field">
              <span>{f.label}</span>
              <AutoTextarea
                minRows={2}
                value={editing[f.key]}
                onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <label className="bp-field">
          <span>下一步提示词（可以用 {'{{S1}}'} 引用步骤产物）</span>
          <AutoTextarea
            className="mono"
            minRows={4}
            value={editing.nextPrompt}
            onChange={(e) => setEditing({ ...editing, nextPrompt: e.target.value })}
          />
        </label>
        <label className="bp-field">
          <span>建议工具</span>
          <input value={editing.nextTool} onChange={(e) => setEditing({ ...editing, nextTool: e.target.value })} />
        </label>
        <div className="bp-actions">
          <button className="btn ghost" onClick={() => setEditing(null)}>
            取消
          </button>
          <button className="btn primary" onClick={save}>
            保存
          </button>
        </div>
      </section>
    )
  }

  if (!bp) {
    return (
      <section className="breakpoint empty">
        <div>
          <h2>断点卡</h2>
          <p className="muted">
            切回这个线程时看这里：停在哪、下一步做什么、下一步的提示词。先记录一些进展，再让 AI 生成，或者自己写。
          </p>
          {error && <p className="error">{error}</p>}
        </div>
        <div className="bp-actions">
          <button className="btn ghost" onClick={() => setEditing({ ...EMPTY })}>
            手动写
          </button>
          <button className="btn primary" disabled={loading} onClick={generate}>
            {loading ? 'AI 生成中…' : 'AI 生成'}
          </button>
        </div>
      </section>
    )
  }

  // 断点卡生成之后线程又有了新动静，提醒刷新
  const stale = thread.updatedAt - bp.updatedAt > 5000

  return (
    <section className="breakpoint">
      <div className="breakpoint-head">
        <h2>断点卡</h2>
        <span className="muted small">
          {bp.source === 'ai' ? 'AI 生成' : '手动'} · {timeAgo(bp.updatedAt)}
        </span>
        {stale && <span className="stale-tag">之后有新进展</span>}
        <div className="spacer" />
        <button className="btn ghost small" onClick={() => setEditing({ ...bp })}>
          编辑
        </button>
        <button className="btn small" disabled={loading} onClick={generate}>
          {loading ? 'AI 生成中…' : 'AI 刷新'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="bp-grid">
        {FIELDS.map((f) =>
          bp[f.key] ? (
            <div key={f.key} className={`bp-item bp-${f.key}`}>
              <span className="bp-label">{f.label}</span>
              <p>{bp[f.key]}</p>
            </div>
          ) : null
        )}
      </div>

      {bp.nextPrompt && (
        <div className="bp-prompt">
          <div className="bp-prompt-head">
            <span className="bp-label">下一步提示词</span>
            {bp.nextTool && <span className="tool-tag">建议用 {bp.nextTool}</span>}
            <div className="spacer" />
            <CopyButton label="复制提示词" getText={() => expandPrompt(bp.nextPrompt, thread, steps)} />
          </div>
          <pre className="prompt-text">{bp.nextPrompt}</pre>
        </div>
      )}
    </section>
  )
}
