import { useState, type CSSProperties, type FocusEvent, type MouseEvent, type ReactNode } from 'react'
import { AGENT_BY_ID } from '../../../shared/agents'
import { STATUS_LABEL, type CalendarItem, type Dashboard as DashboardData, type Status } from '../../../shared/types'
import { api, useData } from '../api'
import { AgentIcon } from '../components/AgentIcon'
import { StatusGlyph } from '../components/StatusPicker'
import { cx } from '../util'

// 总看板：大窗口的首页。一排数字，一张日程热力图，项目进度、谁手上有活、每周完成、逾期和接下来几天。
// 图表规则：热力图单一蓝色由浅到深；状态分段按「已完成 → 进行中 → 已暂停 → 待办」排（色弱也分得开），
// 每个数都有文字，悬停提示只是补充。

const WEEKDAYS = '日一二三四五六'
/** 状态分段的顺序：从做完到没开始，读起来就是进度 */
const STACK: Status[] = ['done', 'active', 'paused', 'todo']

function parse(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function md(day: string): string {
  const d = parse(day)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

function mdShort(day: string): string {
  const d = parse(day)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 热力图分档：0、1、2、3–4、5 及以上 */
function binOf(n: number): number {
  return n <= 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4
}

// ---------- 悬停提示：数值在前、说明在后 ----------

type Tip = { x: number; y: number; value: string; label: string } | null

function useTip() {
  const [tip, setTip] = useState<Tip>(null)
  const bind = (value: string, label: string) => ({
    onMouseEnter: (e: MouseEvent) => setTip({ x: e.clientX, y: e.clientY, value, label }),
    onMouseMove: (e: MouseEvent) => setTip({ x: e.clientX, y: e.clientY, value, label }),
    onMouseLeave: () => setTip(null),
    onFocus: (e: FocusEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      setTip({ x: r.left + r.width / 2, y: r.top, value, label })
    },
    onBlur: () => setTip(null)
  })
  const node = tip && (
    <div className="viz-tip" style={{ left: tip.x, top: tip.y }}>
      <b>{tip.value}</b>
      <span>{tip.label}</span>
    </div>
  )
  return { bind, node }
}

export function Dashboard({ onOpenTask, onOpenDay }: { onOpenTask: (id: string) => void; onOpenDay: (day: string) => void }) {
  const [data] = useData(() => api.dashboard(), [])
  const tip = useTip()
  if (!data) return null
  const now = new Date()

  return (
    <div className="page dash">
      <header className="page-header">
        <h1>总看板</h1>
        <p className="muted">
          {now.getMonth() + 1} 月 {now.getDate()} 日 · 周{WEEKDAYS[now.getDay()]}。所有项目放在一起看：忙不忙、做到哪、谁手上有活。
        </p>
      </header>

      <Tiles d={data} />
      <HeatCard d={data} tip={tip} onOpenDay={onOpenDay} />

      <div className="dash-grid">
        <ProjectsCard d={data} tip={tip} />
        <AgentsCard d={data} tip={tip} />
        <WeeklyCard d={data} tip={tip} />
        <AgendaCard d={data} onOpenTask={onOpenTask} />
      </div>
      {tip.node}
    </div>
  )
}

type TipApi = ReturnType<typeof useTip>

function Card({ title, sub, children, className }: { title: string; sub?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('dash-card', className)}>
      <header className="dash-card-head">
        <h2>{title}</h2>
        {sub && <div className="dash-card-sub">{sub}</div>}
      </header>
      {children}
    </section>
  )
}

// ---------- 一排数字 ----------

function Tiles({ d }: { d: DashboardData }) {
  const t = d.tiles
  const tiles: { label: string; value: number; note?: string; alert?: boolean }[] = [
    { label: '进行中的任务', value: t.activeTasks },
    { label: '进行中的子任务', value: t.activeSubtasks },
    { label: '本周安排', value: t.scheduledThisWeek, note: '个子任务' },
    { label: '本周完成', value: t.doneThisWeek, note: `今天 ${t.doneToday}` },
    { label: '逾期', value: t.overdue, note: t.overdue ? '排在今天以前、还没做完' : '没有拖着的', alert: t.overdue > 0 }
  ]
  return (
    <div className="dash-tiles">
      {tiles.map((x) => (
        <div key={x.label} className={cx('dash-tile', x.alert && 'alert')}>
          <div className="dash-tile-label">
            {x.alert && <span className="dash-alert-icon" aria-hidden>!</span>}
            {x.label}
          </div>
          <div className="dash-tile-value">{x.value}</div>
          {x.note && <div className="dash-tile-note">{x.note}</div>}
        </div>
      ))}
    </div>
  )
}

// ---------- 日程热力图 ----------

function HeatCard({ d, tip, onOpenDay }: { d: DashboardData; tip: TipApi; onOpenDay: (day: string) => void }) {
  const [mode, setMode] = useState<'scheduled' | 'done'>('scheduled')
  const counts = mode === 'scheduled' ? d.scheduled : d.done
  const start = parse(d.heatFrom)
  const weeks = Math.round((parse(d.heatTo).getTime() - start.getTime()) / (7 * 86400000)) + 1
  const columns = Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, i) => {
      const day = new Date(start)
      day.setDate(start.getDate() + w * 7 + i)
      return ymd(day)
    })
  )
  // 每列上面标月份：这一列里有某个月的 1 号。第一列也标，除非紧接着两列就换月（不然两个字挤在一起）
  const startsMonth = (col: string[]): string | undefined => col.find((day) => parse(day).getDate() === 1)
  const monthLabel = (col: string[], w: number): string => {
    const first = startsMonth(col)
    if (first) return `${parse(first).getMonth() + 1} 月`
    if (w === 0 && !columns.slice(1, 3).some(startsMonth)) return `${parse(col[0]).getMonth() + 1} 月`
    return ''
  }
  const verb = mode === 'scheduled' ? '安排' : '完成'
  const busiest = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
  const max = busiest[0]?.[1] ?? 0

  return (
    <Card
      title="日程热力图"
      className="dash-heat"
      sub={
        <div className="dash-seg" role="tablist">
          <button className={cx(mode === 'scheduled' && 'active')} onClick={() => setMode('scheduled')}>
            安排了几件
          </button>
          <button className={cx(mode === 'done' && 'active')} onClick={() => setMode('done')}>
            完成了几件
          </button>
        </div>
      }
    >
      <div className="heat-wrap">
        <div className="heat">
          <div className="heat-weekdays">
            {['', '一', '', '三', '', '五', '', '日'].map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>
          <div className="heat-cols">
            {columns.map((col, w) => (
              <div key={col[0]} className="heat-col">
                <span className="heat-month">{monthLabel(col, w)}</span>
                {col.map((day) => {
                  const n = counts[day] ?? 0
                  const future = day > d.today
                  return (
                    <button
                      key={day}
                      className={cx('heat-cell', `h${binOf(n)}`, day === d.today && 'today', future && mode === 'done' && 'future')}
                      aria-label={`${md(day)} ${verb} ${n} 件`}
                      onClick={() => onOpenDay(day)}
                      {...tip.bind(`${n} 件`, `${md(day)} 周${WEEKDAYS[parse(day).getDay()]} · ${verb}`)}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="heat-side">
          <div className="heat-side-title">最忙的日子</div>
          {busiest.length === 0 ? (
            <p className="muted small">这段时间还没有{verb}什么。{mode === 'scheduled' && '在月历里把子任务拖到某一天，就会显示在这里。'}</p>
          ) : (
            busiest.map(([day, n]) => (
              <button key={day} className="heat-busy" onClick={() => onOpenDay(day)}>
                <span className="heat-busy-day">
                  {md(day)} <span className="muted">周{WEEKDAYS[parse(day).getDay()]}</span>
                </span>
                <span className="heat-busy-bar">
                  <i style={{ width: `${(n / max) * 100}%` }} />
                </span>
                <b>{n}</b>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="heat-legend">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((b) => (
          <span key={b} className="heat-legend-step">
            <i className={cx('heat-cell', `h${b}`)} />
            {['0', '1', '2', '3–4', '5+'][b]}
          </span>
        ))}
        <span>多</span>
        <span className="heat-legend-note">每格一天，点一下在月历里打开那天</span>
      </div>
    </Card>
  )
}

// ---------- 项目进度：每个项目一条分段条 ----------

function StatusKey({ s }: { s: Status }) {
  return (
    <span className="viz-key">
      <i className={cx('viz-swatch', `v-${s}`)} />
      {STATUS_LABEL[s]}
    </span>
  )
}

function ProjectsCard({ d, tip }: { d: DashboardData; tip: TipApi }) {
  return (
    <Card
      title="项目进度"
      sub={
        <div className="viz-legend">
          {STACK.map((s) => (
            <StatusKey key={s} s={s} />
          ))}
        </div>
      }
    >
      {d.projects.length === 0 && <p className="muted small">还没有项目。</p>}
      {d.projects.map((p) => {
        const total = STACK.reduce((n, s) => n + p.subtasks[s], 0)
        const taskTotal = STACK.reduce((n, s) => n + p.tasks[s], 0)
        return (
          <div key={p.id} className="proj-row" style={{ '--c': p.color } as CSSProperties}>
            <div className="proj-name">
              <i />
              {p.title}
              <span className="muted">
                {taskTotal} 个任务 · 进行中 {p.tasks.active}
              </span>
            </div>
            {total === 0 ? (
              <div className="muted small">还没有子任务</div>
            ) : (
              <>
                <div className="stack">
                  {STACK.filter((s) => p.subtasks[s] > 0).map((s) => (
                    <span
                      key={s}
                      className={cx('stack-seg', `v-${s}`)}
                      style={{ flexGrow: p.subtasks[s] }}
                      {...tip.bind(`${p.subtasks[s]} 个`, `${p.title} · ${STATUS_LABEL[s]}`)}
                    />
                  ))}
                </div>
                <div className="proj-counts">
                  {STACK.map((s) => (
                    <span key={s}>
                      {STATUS_LABEL[s]} <b>{p.subtasks[s]}</b>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )
      })}
    </Card>
  )
}

// ---------- 谁手上有活：每个执行者进行中的子任务 ----------

function AgentsCard({ d, tip }: { d: DashboardData; tip: TipApi }) {
  const max = Math.max(1, ...d.agents.map((a) => a.active))
  return (
    <Card title="谁手上有活" sub={<span className="muted small">条的长度 = 进行中的子任务</span>}>
      {d.agents.map((a) => {
        const name = a.agent ? AGENT_BY_ID[a.agent].name : '未分配'
        return (
          <div key={a.agent || 'none'} className="agent-row">
            <span className="agent-row-who">
              <AgentIcon agent={a.agent} size={20} busy={a.active > 0} />
              {name}
            </span>
            <span className="hbar" {...tip.bind(`${a.active} 个进行中`, `${name} · 待办 ${a.todo} · 已暂停 ${a.paused}`)}>
              {a.active > 0 && <i style={{ width: `${(a.active / max) * 100}%` }} />}
              <b>{a.active}</b>
            </span>
            <span className="agent-row-rest muted">
              待办 {a.todo} · 暂停 {a.paused}
            </span>
          </div>
        )
      })}
    </Card>
  )
}

// ---------- 每周完成：12 根柱子 ----------

function WeeklyCard({ d, tip }: { d: DashboardData; tip: TipApi }) {
  const max = Math.max(1, ...d.weekly.map((w) => w.done))
  const last = d.weekly[d.weekly.length - 1]
  // 纵轴取不小于最大值的「整」刻度，别空出半截
  const top = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100].find((n) => n >= max) ?? Math.ceil(max / 50) * 50
  return (
    <Card title="每周完成" sub={<span className="muted small">最近 12 周完成的子任务</span>}>
      <div className="cols">
        <div className="cols-axis">
          <span>{top}</span>
          <span>0</span>
        </div>
        <div className="cols-plot">
          {d.weekly.map((w, i) => {
            const isLast = i === d.weekly.length - 1
            return (
              <div key={w.week} className="col-slot" {...tip.bind(`${w.done} 个`, `${mdShort(w.week)} 那周完成`)} tabIndex={0}>
                <div className="col-track">
                  {/* 数值顶在本周那根柱子的帽上 */}
                  <div className="col-bar" style={{ height: `${(w.done / top) * 100}%` }}>
                    {isLast && <span className="col-value">{w.done}</span>}
                    {w.done > 0 && <i className={cx(isLast && 'current')} />}
                  </div>
                </div>
                <span className="col-label">{i % 3 === 0 || isLast ? (isLast ? '本周' : mdShort(w.week)) : ''}</span>
              </div>
            )
          })}
        </div>
      </div>
      <p className="muted small">本周完成 {last?.done ?? 0} 个；最多的一周 {max} 个。</p>
    </Card>
  )
}

// ---------- 逾期 + 接下来 7 天 ----------

function AgendaRow({ item, onOpenTask }: { item: CalendarItem; onOpenTask: (id: string) => void }) {
  return (
    <button className="agenda-row" style={{ '--c': item.color } as CSSProperties} onClick={() => onOpenTask(item.taskId)}>
      <span className="agenda-day">{mdShort(item.scheduledOn)}</span>
      <i className="agenda-bar" />
      <span className="agenda-main">
        <b>S{item.ref}</b> {item.title}
        <span className="muted"> · {item.taskTitle}</span>
      </span>
      <span className={cx('now-status', `t-${item.status}`)}>
        <StatusGlyph status={item.status} />
        {STATUS_LABEL[item.status]}
      </span>
    </button>
  )
}

function AgendaCard({ d, onOpenTask }: { d: DashboardData; onOpenTask: (id: string) => void }) {
  return (
    <Card title="接下来要做的" sub={<span className="muted small">按安排的日子</span>}>
      {d.overdue.length > 0 && (
        <>
          <div className="agenda-head alert">
            <span className="dash-alert-icon" aria-hidden>
              !
            </span>
            逾期 {d.overdue.length}
          </div>
          {d.overdue.slice(0, 6).map((i) => (
            <AgendaRow key={i.subtaskId} item={i} onOpenTask={onOpenTask} />
          ))}
        </>
      )}
      <div className="agenda-head">接下来 7 天 {d.upcoming.length}</div>
      {d.upcoming.length === 0 ? (
        <p className="muted small">接下来一周还没排东西。在月历里把子任务拖到某一天。</p>
      ) : (
        d.upcoming.slice(0, 8).map((i) => <AgendaRow key={i.subtaskId} item={i} onOpenTask={onOpenTask} />)
      )}
    </Card>
  )
}
