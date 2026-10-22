import { useState } from 'react'
import type { LogEntry, LogSource, Step } from '../../../shared/types'
import { api } from '../api'
import { AutoTextarea } from '../components/Editable'
import { cx, timeAgo } from '../util'

const SOURCE_LABEL: Record<LogSource, string> = {
  manual: '手动',
  quick: '快捷记录',
  clipboard: '剪贴板'
}

export function Timeline({ threadId, logs, steps }: { threadId: string; logs: LogEntry[]; steps: Step[] }) {
  const [draft, setDraft] = useState('')

  const add = async (): Promise<void> => {
    if (!draft.trim()) return
    await api.createLog({ threadId, content: draft.trim(), source: 'manual' })
    setDraft('')
  }

  return (
    <section>
      <h2 className="section-title">记录</h2>
      <div className="log-input">
        <AutoTextarea
          minRows={2}
          value={draft}
          placeholder="记一笔：做到哪了、想到什么、AI 回了什么…（⌘↩ 保存）"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.metaKey) add()
          }}
        />
        <button className="btn primary small" disabled={!draft.trim()} onClick={add}>
          记录
        </button>
      </div>
      <div className="logs">
        {logs.length === 0 && <p className="muted small">还没有记录。也可以在任何软件里按 ⌃⌥B 记断点，⌃⌥V 把剪贴板存到当前线程。</p>}
        {logs.map((l) => (
          <LogItem key={l.id} log={l} steps={steps} />
        ))}
      </div>
    </section>
  )
}

function LogItem({ log, steps }: { log: LogEntry; steps: Step[] }) {
  const [open, setOpen] = useState(false)
  const long = log.content.length > 240

  /** 把这条记录变成某个步骤的产物 */
  const toArtifact = async (stepId: string): Promise<void> => {
    await api.createArtifact({ threadId: log.threadId, stepId, kind: 'text', title: '', content: log.content })
  }

  return (
    <div className="log">
      <div className="log-head">
        <span className={cx('source-tag', `src-${log.source}`)}>{SOURCE_LABEL[log.source]}</span>
        <span className="muted small" title={new Date(log.createdAt).toLocaleString('zh-CN')}>
          {timeAgo(log.createdAt)}
        </span>
        <div className="spacer" />
        {steps.length > 0 && (
          <select
            className="select small"
            value=""
            onChange={(e) => {
              if (e.target.value) toArtifact(e.target.value)
            }}
          >
            <option value="">存为产物…</option>
            {steps.map((s) => (
              <option key={s.id} value={s.id}>
                S{s.ref} {s.title}
              </option>
            ))}
          </select>
        )}
        <button
          className="btn ghost small danger"
          onClick={() => {
            if (confirm('删除这条记录？')) api.deleteLog(log.id)
          }}
        >
          删除
        </button>
      </div>
      <pre className={cx('log-text', long && !open && 'clamped')}>{log.content}</pre>
      {long && (
        <button className="link-btn" onClick={() => setOpen(!open)}>
          {open ? '收起' : '展开全部'}
        </button>
      )}
    </div>
  )
}
