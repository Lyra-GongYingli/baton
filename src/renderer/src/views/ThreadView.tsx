import { useState } from 'react'
import { THREAD_STATUS_LABEL, type ThreadStatus } from '../../../shared/types'
import { api, useData } from '../api'
import { Editable } from '../components/Editable'
import { BreakpointCard } from './BreakpointCard'
import { StepRow } from './StepRow'
import { Timeline } from './Timeline'

interface Props {
  id: string
  focusStepId?: string
  onDeleted: () => void
}

export function ThreadView({ id, focusStepId, onDeleted }: Props) {
  const [detail] = useData(() => api.getThread(id), [id])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(focusStepId ? [focusStepId] : []))
  const [newStep, setNewStep] = useState('')

  if (detail === undefined) return <div className="page" />
  if (detail === null) return <div className="page muted">这个线程不存在了。</div>

  const { thread, steps, logs } = detail

  const toggle = (stepId: string): void => {
    const next = new Set(expanded)
    if (next.has(stepId)) next.delete(stepId)
    else next.add(stepId)
    setExpanded(next)
  }

  const addStep = async (): Promise<void> => {
    if (!newStep.trim()) return
    const stepId = await api.createStep(thread.id, { title: newStep })
    setNewStep('')
    setExpanded(new Set([...expanded, stepId]))
  }

  const remove = async (): Promise<void> => {
    if (!confirm(`删除线程「${thread.title}」？步骤、产物和记录会一起删掉。`)) return
    await api.deleteThread(thread.id)
    onDeleted()
  }

  return (
    <div className="page thread-page">
      <header className="thread-header">
        <Editable
          className="thread-title"
          value={thread.title}
          onSave={(title) => api.updateThread(thread.id, { title })}
        />
        <div className="thread-header-actions">
          <select
            className="select"
            value={thread.status}
            onChange={(e) => api.updateThread(thread.id, { status: e.target.value as ThreadStatus })}
          >
            {(Object.keys(THREAD_STATUS_LABEL) as ThreadStatus[]).map((s) => (
              <option key={s} value={s}>
                {THREAD_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <button className="btn ghost danger" onClick={remove}>
            删除
          </button>
        </div>
      </header>

      <div className="thread-meta">
        <label className="meta-field">
          <span>目标</span>
          <Editable
            multiline
            rows={1}
            value={thread.goal}
            placeholder="做完之后是什么样子？"
            onSave={(goal) => api.updateThread(thread.id, { goal })}
          />
        </label>
        <label className="meta-field">
          <span>完成标准</span>
          <Editable
            multiline
            rows={1}
            value={thread.doneCriteria}
            placeholder="怎样算做完？"
            onSave={(doneCriteria) => api.updateThread(thread.id, { doneCriteria })}
          />
        </label>
      </div>

      <BreakpointCard detail={detail} />

      <section>
        <h2 className="section-title">
          步骤 <span className="muted small">{steps.filter((s) => s.status === 'done').length}/{steps.length}</span>
        </h2>
        <div className="steps">
          {steps.map((s, i) => (
            <StepRow
              key={s.id}
              step={s}
              thread={thread}
              steps={steps}
              expanded={expanded.has(s.id)}
              isFirst={i === 0}
              isLast={i === steps.length - 1}
              onToggle={() => toggle(s.id)}
            />
          ))}
          <div className="add-step">
            <span className="ref muted">S+</span>
            <input
              value={newStep}
              placeholder="添加步骤，回车确认"
              onChange={(e) => setNewStep(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) addStep()
              }}
            />
          </div>
        </div>
      </section>

      <Timeline threadId={thread.id} logs={logs} steps={steps} />
    </div>
  )
}
