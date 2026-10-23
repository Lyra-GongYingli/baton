import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addDays, dayLabel, parseDay, today, ymd } from '../../../shared/dates'
import { cx } from '../util'

// 子任务的「哪天做」：一个小日期标签，点开选日子。今天 / 明天 / 10/25；排在今天以前、还没做完的标「逾期」。

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

export function CalendarIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="2" y="3" width="12" height="11" rx="2.5" />
      <path d="M2 7h12M5.5 1.5v3M10.5 1.5v3" strokeLinecap="round" />
    </svg>
  )
}

export function DateChip({
  value,
  done,
  onChange,
  title
}: {
  /** YYYY-MM-DD；空字符串 = 还没排 */
  value: string
  /** 做完的不算逾期 */
  done?: boolean
  onChange: (day: string) => void
  title?: string
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const now = today()
  const overdue = Boolean(value) && value < now && !done
  return (
    <>
      <button
        className={cx('date-chip', !value && 'empty', overdue && 'overdue', value === now && !done && 'today', done && 'done')}
        title={title ?? (value ? '哪天做：点一下改日子' : '还没排日子：点一下选一天')}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())
        }}
      >
        <CalendarIcon />
        {value ? dayLabel(value, now) : '未安排'}
        {overdue && <span className="date-chip-late">逾期</span>}
      </button>
      {anchor && (
        <DatePopover
          anchor={anchor}
          value={value}
          onPick={(day) => {
            setAnchor(null)
            if (day !== value) onChange(day)
          }}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  )
}

/** 选日子的小面板：几个常用的 + 一个月的格子；放到 body 下面，免得被卡片的旋转、裁切影响 */
function DatePopover({
  anchor,
  value,
  onPick,
  onClose
}: {
  anchor: DOMRect
  value: string
  onPick: (day: string) => void
  onClose: () => void
}) {
  const now = today()
  const [month, setMonth] = useState(() => {
    const d = parseDay(value || now)
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 6 })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    // Esc 只关这个面板，别让窗口拿去收起自己
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  // 贴着标签下面弹出；放不下就往上、往左收
  useLayoutEffect(() => {
    if (!ref.current) return
    // 用排版尺寸量：弹出动画一开始是缩小的，getBoundingClientRect 量出来偏小，会以为放得下、结果超出窗口
    const width = ref.current.offsetWidth
    const height = ref.current.offsetHeight
    const below = anchor.bottom + 6 + height <= window.innerHeight - 6
    setPos({
      // 左右离窗口边缘留 20px：侧边栏窗口四周有 14px 透明边，别伸到面板外面去
      left: Math.max(20, Math.min(anchor.left, window.innerWidth - width - 20)),
      top: below ? anchor.bottom + 6 : Math.max(6, anchor.top - height - 6)
    })
  }, [anchor])

  // 这个月的格子：从 1 号那周的周一开始，6 行
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
  const nextMonday = addDays(now, ((8 - parseDay(now).getDay()) % 7) || 7)
  const quick: [string, string][] = [
    ['今天', now],
    ['明天', addDays(now, 1)],
    ['后天', addDays(now, 2)],
    ['下周一', nextMonday]
  ]

  return createPortal(
    <div
      ref={ref}
      className="date-pop line-hit"
      style={{ left: pos.left, top: pos.top }}
      // 面板虽然放在 body 下面，React 的事件还是会冒到卡片上（卡片单击 = 打开任务），在这里拦住
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className="date-pop-quick">
        {quick.map(([label, day]) => (
          <button key={label} className={cx(day === value && 'active')} onClick={() => onPick(day)}>
            {label}
          </button>
        ))}
      </div>
      <div className="date-pop-head">
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
        <span>
          {month.getFullYear()} 年 {month.getMonth() + 1} 月
        </span>
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
      </div>
      <div className="date-pop-grid">
        {WEEKDAYS.map((w) => (
          <span key={w} className="date-pop-wd">
            {w}
          </span>
        ))}
        {cells.map((d) => {
          const day = ymd(d)
          return (
            <button
              key={day}
              className={cx(
                'date-pop-day',
                d.getMonth() !== month.getMonth() && 'outside',
                day === now && 'today',
                day === value && 'selected'
              )}
              onClick={() => onPick(day)}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
      {value && (
        <div className="date-pop-foot">
          <button className="date-pop-clear" onClick={() => onPick('')}>
            清除日期（放回待安排）
          </button>
        </div>
      )}
    </div>,
    document.body
  )
}
