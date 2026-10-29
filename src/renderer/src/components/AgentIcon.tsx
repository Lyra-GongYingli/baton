import { LIVE_LABEL, type Assignee, type LiveState } from '../../../shared/types'
import { AGENT_BY_ID } from '../../../shared/agents'
import { cx } from '../util'

// 执行者头像：自己画的简化图标，不是官方 logo
// busy = 正在干活，会有小动画；live = 认出来的 AI 会话这会儿的状态，等你批准、等你看时右上角亮个小点

function Claude() {
  const rays = Array.from({ length: 12 }, (_, i) => i * 30)
  return (
    <>
      <rect width="32" height="32" rx="10" fill="#F6E7DC" />
      <g className="rays" stroke="#D97757" strokeWidth="2.6" strokeLinecap="round">
        {rays.map((deg) => (
          <line key={deg} x1="16" y1="16" x2="16" y2={deg % 60 === 0 ? 5 : 7.5} transform={`rotate(${deg} 16 16)`} />
        ))}
      </g>
    </>
  )
}

function Codex() {
  return (
    <>
      <rect width="32" height="32" rx="10" fill="#1F1F1F" />
      <path d="M9 11l5 5-5 5" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect className="cursor" x="16" y="19.5" width="7" height="2.6" rx="1.3" fill="#7CF0B5" />
    </>
  )
}

function Muse() {
  return (
    <>
      <defs>
        <linearGradient id="muse-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#A855F7" />
          <stop offset="1" stopColor="#EC4899" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="10" fill="url(#muse-g)" />
      <path
        className="spark"
        d="M16 6.5c.9 4.6 2.9 6.6 7.5 7.5-4.6.9-6.6 2.9-7.5 7.5-.9-4.6-2.9-6.6-7.5-7.5 4.6-.9 6.6-2.9 7.5-7.5z"
        fill="#fff"
      />
      <circle className="spark2" cx="23" cy="22.5" r="1.8" fill="#fff" opacity="0.85" />
    </>
  )
}

function Cat() {
  return (
    <>
      <rect width="32" height="32" rx="10" fill="#FFF0D1" />
      <g className="ears">
        <path d="M7.5 13 9.2 5.2l5.6 4.6z" fill="#F59E0B" />
        <path d="M24.5 13 22.8 5.2l-5.6 4.6z" fill="#F59E0B" />
        <path d="M9.4 11.2l.8-3.6 2.6 2.2z" fill="#FCA5A5" />
        <path d="M22.6 11.2l-.8-3.6-2.6 2.2z" fill="#FCA5A5" />
      </g>
      <ellipse cx="16" cy="18" rx="9.6" ry="8.2" fill="#F59E0B" />
      <path d="M14 10.6v2.2M16 10.2v2.6M18 10.6v2.2" stroke="#D97706" strokeWidth="1.3" strokeLinecap="round" />
      <g className="eyes" fill="#2B2118">
        <ellipse cx="12.3" cy="17.4" rx="1.35" ry="1.6" />
        <ellipse cx="19.7" cy="17.4" rx="1.35" ry="1.6" />
      </g>
      <path d="M15 20.2h2l-1 1.1z" fill="#E8697A" />
      <path d="M16 21.3c-.3 1-1.5 1.3-2.2.6M16 21.3c.3 1 1.5 1.3 2.2.6" stroke="#7C4A12" strokeWidth="0.9" fill="none" strokeLinecap="round" />
      <path d="M8.5 20.5l-3 -.6M8.5 22l-3 .6M23.5 20.5l3 -.6M23.5 22l3 .6" stroke="#B45309" strokeWidth="0.8" strokeLinecap="round" opacity="0.7" />
    </>
  )
}

function Nobody() {
  return (
    <>
      <rect x="1" y="1" width="30" height="30" rx="10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3.5 3" opacity="0.5" />
      <path d="M16 11v10M11 16h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
    </>
  )
}

const ART = { claude: Claude, codex: Codex, muse: Muse, me: Cat }

export function AgentIcon({
  agent,
  size = 24,
  busy,
  live,
  title
}: {
  agent: Assignee
  size?: number
  busy?: boolean
  live?: LiveState
  title?: string
}) {
  const Art = agent ? ART[agent] : Nobody
  const name = agent ? AGENT_BY_ID[agent].name : '未分配'
  const label = title ?? (live ? `${name} · ${LIVE_LABEL[live]}` : name)
  return (
    <svg
      className={cx('agent-icon', `agent-${agent || 'none'}`, busy && 'busy', live && `live-${live}`)}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <Art />
      {(live === 'waiting' || live === 'idle') && <circle className="live-dot" cx="28.5" cy="3.5" r="5.5" />}
    </svg>
  )
}
