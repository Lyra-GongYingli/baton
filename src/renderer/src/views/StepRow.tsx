import { useState } from 'react'
import { expandPrompt, referencedSteps } from '../../../shared/prompt'
import { TOOL_SUGGESTIONS, type Artifact, type Step, type Thread } from '../../../shared/types'
import { api } from '../api'
import { CopyButton } from '../components/CopyButton'
import { AutoTextarea, Editable } from '../components/Editable'
import { StatusDot, StatusPicker } from '../components/Status'
import { cx, timeAgo } from '../util'

interface Props {
  step: Step
  thread: Thread
  steps: Step[]
  expanded: boolean
  isFirst: boolean
  isLast: boolean
  onToggle: () => void
}

export function StepRow({ step, thread, steps, expanded, isFirst, isLast, onToggle }: Props) {
  const deps = referencedSteps(step.prompt)
  const byRef = new Map(steps.map((s) => [s.ref, s]))
  const blocked = deps.some((r) => byRef.get(r)?.status !== 'done')

  return (
    <div className={cx('step', expanded && 'expanded', `step-${step.status}`)}>
      <button className="step-row" onClick={onToggle}>
        <span className="ref">S{step.ref}</span>
        <StatusDot status={step.status} />
        <span className="step-title">{step.title}</span>
        {deps.length > 0 && (
          <span className={cx('dep-chip', blocked && 'blocked')} title={blocked ? '有上游步骤还没完成' : '上游都完成了'}>
            ← {deps.map((r) => `S${r}`).join(' ')}
          </span>
        )}
        {step.outputs.length > 0 && <span className="output-count">{step.outputs.length} 个产物</span>}
        {step.tool && <span className="tool-tag">{step.tool}</span>}
        <span className={cx('chevron', !expanded && 'collapsed')}>▾</span>
      </button>

      {expanded && (
        <div className="step-body">
          <div className="step-fields">
            <label className="field">
              <span>步骤名</span>
              <Editable value={step.title} onSave={(title) => api.updateStep(step.id, { title })} />
            </label>
            <label className="field narrow">
              <span>用什么做</span>
              <Editable
                value={step.tool}
                placeholder="Claude / Figma…"
                onSave={(tool) => api.updateStep(step.id, { tool })}
              />
              <ToolSuggestions onPick={(tool) => api.updateStep(step.id, { tool })} />
            </label>
          </div>

          <div className="field">
            <span>状态</span>
            <StatusPicker value={step.status} onChange={(status) => api.updateStep(step.id, { status })} />
          </div>

          <PromptEditor step={step} thread={thread} steps={steps} deps={deps} />

          <Outputs step={step} />

          <label className="field">
            <span>备注</span>
            <Editable
              multiline
              rows={2}
              value={step.notes}
              placeholder="踩过的坑、注意事项…"
              onSave={(notes) => api.updateStep(step.id, { notes })}
            />
          </label>

          <div className="step-footer">
            <button className="btn ghost small" disabled={isFirst} onClick={() => api.moveStep(step.id, -1)}>
              上移
            </button>
            <button className="btn ghost small" disabled={isLast} onClick={() => api.moveStep(step.id, 1)}>
              下移
            </button>
            <div className="spacer" />
            <span className="muted small">更新于 {timeAgo(step.updatedAt)}</span>
            <button
              className="btn ghost small danger"
              onClick={() => {
                if (confirm(`删除步骤 S${step.ref}「${step.title}」？它的产物也会删掉。`)) api.deleteStep(step.id)
              }}
            >
              删除步骤
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ToolSuggestions({ onPick }: { onPick: (tool: string) => void }) {
  return (
    <div className="tool-suggestions">
      {TOOL_SUGGESTIONS.map((t) => (
        <button key={t} className="chip" onClick={() => onPick(t)}>
          {t}
        </button>
      ))}
    </div>
  )
}

function PromptEditor({ step, thread, steps, deps }: { step: Step; thread: Thread; steps: Step[]; deps: number[] }) {
  const [preview, setPreview] = useState(false)
  const byRef = new Map(steps.map((s) => [s.ref, s]))
  const upstream = steps.filter((s) => s.ref !== step.ref)

  return (
    <div className="field">
      <span>提示词</span>
      <Editable
        multiline
        rows={3}
        className="mono"
        value={step.prompt}
        placeholder="这一步要发给 AI 的提示词。用 {{S1}} 引用 S1 的产物，用 {{目标}} 引用线程目标，复制时会自动替换。"
        onSave={(prompt) => api.updateStep(step.id, { prompt })}
      />
      <div className="prompt-tools">
        {upstream.length > 0 && (
          <span className="muted small">
            可引用：
            {upstream.map((s) => (
              <button
                key={s.id}
                className="chip"
                title={`点击复制 {{S${s.ref}}}，粘贴到提示词里`}
                onClick={() => api.copyText(`{{S${s.ref}}}`)}
              >
                {`{{S${s.ref}}}`} {s.title}
              </button>
            ))}
          </span>
        )}
        <div className="spacer" />
        {step.prompt && (
          <>
            <button className="btn ghost small" onClick={() => setPreview(!preview)}>
              {preview ? '收起预览' : '预览展开后'}
            </button>
            <CopyButton label="复制提示词" getText={() => expandPrompt(step.prompt, thread, steps)} />
          </>
        )}
      </div>
      {deps.length > 0 && (
        <div className="deps">
          {deps.map((r) => {
            const s = byRef.get(r)
            return (
              <span key={r} className={cx('dep', s?.status === 'done' ? 'ok' : 'pending')}>
                S{r} {s ? s.title : '（不存在）'} · {s?.status === 'done' ? '已完成' : '未完成'}
                {s && s.outputs.length === 0 && '，还没有产物'}
              </span>
            )
          })}
        </div>
      )}
      {preview && <pre className="prompt-text preview">{expandPrompt(step.prompt, thread, steps)}</pre>}
    </div>
  )
}

function Outputs({ step }: { step: Step }) {
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<Artifact['kind']>('text')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  const reset = (): void => {
    setAdding(false)
    setKind('text')
    setTitle('')
    setContent('')
  }

  const add = async (): Promise<void> => {
    if (!content.trim()) return
    await api.createArtifact({ threadId: step.threadId, stepId: step.id, kind, title: title.trim(), content: content.trim() })
    reset()
  }

  return (
    <div className="field">
      <span>产物（结果，下游步骤可以引用）</span>
      <div className="outputs">
        {step.outputs.map((a) => (
          <OutputItem key={a.id} artifact={a} />
        ))}
        {!adding ? (
          <button className="btn ghost small add-output" onClick={() => setAdding(true)}>
            ＋ 添加产物
          </button>
        ) : (
          <div className="output-form">
            <div className="segmented">
              <button className={cx(kind === 'text' && 'active')} onClick={() => setKind('text')}>
                文本
              </button>
              <button className={cx(kind === 'link' && 'active')} onClick={() => setKind('link')}>
                链接
              </button>
            </div>
            <input value={title} placeholder="标题（可选）" onChange={(e) => setTitle(e.target.value)} />
            {kind === 'text' ? (
              <AutoTextarea
                autoFocus
                minRows={4}
                value={content}
                placeholder="把 AI 的结果粘贴到这里"
                onChange={(e) => setContent(e.target.value)}
              />
            ) : (
              <input
                autoFocus
                value={content}
                placeholder="https://…（Figma 文件、文档、对话链接…）"
                onChange={(e) => setContent(e.target.value)}
              />
            )}
            <div className="output-form-actions">
              <button className="btn ghost small" onClick={async () => setContent(await api.readClipboard())}>
                从剪贴板粘贴
              </button>
              <div className="spacer" />
              <button className="btn ghost small" onClick={reset}>
                取消
              </button>
              <button className="btn primary small" disabled={!content.trim()} onClick={add}>
                添加
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function OutputItem({ artifact: a }: { artifact: Artifact }) {
  const [open, setOpen] = useState(false)
  const long = a.kind === 'text' && a.content.length > 280
  return (
    <div className="output">
      <div className="output-head">
        <span className="output-kind">{a.kind === 'link' ? '链接' : '文本'}</span>
        {a.title && <span className="output-title">{a.title}</span>}
        <span className="muted small">{timeAgo(a.createdAt)}</span>
        <div className="spacer" />
        <CopyButton label="复制" className="ghost" getText={() => a.content} />
        <button
          className="btn ghost small danger"
          onClick={() => {
            if (confirm('删除这个产物？')) api.deleteArtifact(a.id)
          }}
        >
          删除
        </button>
      </div>
      {a.kind === 'link' ? (
        <a className="output-link" href={a.content} target="_blank" rel="noreferrer">
          {a.content}
        </a>
      ) : (
        <>
          <pre className={cx('output-text', long && !open && 'clamped')}>{a.content}</pre>
          {long && (
            <button className="link-btn" onClick={() => setOpen(!open)}>
              {open ? '收起' : `展开全部（${a.content.length} 字）`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
