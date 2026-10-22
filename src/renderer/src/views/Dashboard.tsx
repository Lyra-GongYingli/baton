import type { DashboardItem, ThreadSummary } from '../../../shared/types'
import { api, useData } from '../api'
import { StatusDot } from '../components/Status'
import { cx, timeAgo } from '../util'

interface Props {
  threads: ThreadSummary[]
  onOpen: (threadId: string, focusStepId?: string) => void
  onCreate: () => void
}

export function Dashboard({ threads, onOpen, onCreate }: Props) {
  const [board] = useData(() => api.dashboard(), [])
  const active = threads.filter((t) => t.status === 'active')

  return (
    <div className="page">
      <header className="page-header">
        <h1>总览</h1>
        <p className="muted">
          {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
        </p>
      </header>

      <section className="lanes">
        <Lane title="等我审核" tone="review" items={board?.review ?? []} empty="没有等你审核的" onOpen={onOpen} />
        <Lane title="AI 在跑" tone="ai_running" items={board?.running ?? []} empty="没有 AI 在跑" onOpen={onOpen} />
        <Lane title="我在做" tone="doing" items={board?.doing ?? []} empty="手上没有在做的" onOpen={onOpen} />
      </section>

      <section>
        <h2 className="section-title">进行中的线程</h2>
        {active.length === 0 ? (
          <div className="empty-card">
            <p>还没有线程。把你手上同时在推进的事情各建一个线程吧。</p>
            <button className="btn primary" onClick={onCreate}>
              ＋ 新线程
            </button>
          </div>
        ) : (
          <div className="thread-cards">
            {active.map((t) => (
              <ThreadCard key={t.id} thread={t} onOpen={() => onOpen(t.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Lane(props: {
  title: string
  tone: 'review' | 'ai_running' | 'doing'
  items: DashboardItem[]
  empty: string
  onOpen: Props['onOpen']
}) {
  return (
    <div className={cx('lane', `lane-${props.tone}`)}>
      <div className="lane-title">
        <StatusDot status={props.tone} />
        {props.title}
        <span className="count">{props.items.length}</span>
      </div>
      {props.items.length === 0 && <div className="lane-empty">{props.empty}</div>}
      {props.items.map((i) => (
        <button key={i.stepId} className="lane-card" onClick={() => props.onOpen(i.threadId, i.stepId)}>
          <div className="lane-card-title">
            <span className="ref">S{i.stepRef}</span> {i.stepTitle}
          </div>
          <div className="lane-card-meta">
            <span>{i.threadTitle}</span>
            {i.tool && <span className="tool-tag">{i.tool}</span>}
            <span className="muted">{timeAgo(i.updatedAt)}</span>
          </div>
        </button>
      ))}
    </div>
  )
}

function ThreadCard({ thread, onOpen }: { thread: ThreadSummary; onOpen: () => void }) {
  const pct = thread.stepTotal ? Math.round((thread.stepDone / thread.stepTotal) * 100) : 0
  const next = thread.breakpoint?.next || (thread.currentStep ? `S${thread.currentStep.ref} ${thread.currentStep.title}` : '')
  return (
    <button className="thread-card" onClick={onOpen}>
      <div className="thread-card-head">
        <span className="thread-card-title">{thread.title}</span>
        <span className="muted small">{timeAgo(thread.updatedAt)}</span>
      </div>
      {thread.goal && <p className="thread-card-goal">{thread.goal}</p>}
      <div className="progress">
        <div className="progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <div className="thread-card-foot">
        <span className="muted small">
          {thread.stepDone}/{thread.stepTotal} 步
        </span>
        {next && (
          <span className="thread-card-next" title={next}>
            下一步：{next}
          </span>
        )}
      </div>
    </button>
  )
}
