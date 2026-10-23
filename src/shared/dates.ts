// 日期：本地日期一律写成 YYYY-MM-DD 字符串（子任务的 scheduledOn 就是这种），主进程和界面共用

const WEEKDAYS = '日一二三四五六'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 本地日期 → YYYY-MM-DD */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** YYYY-MM-DD → 那天 0 点（本地时间） */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function today(): string {
  return ymd(new Date())
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day)
  d.setDate(d.getDate() + n)
  return ymd(d)
}

export function weekdayOf(day: string): string {
  return `周${WEEKDAYS[parseDay(day).getDay()]}`
}

/** 相差几天（b - a） */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000)
}

/** 给人看的短日期：今天 / 明天 / 后天 / 昨天，一周内带星期，再远就是 10/25（跨年带年份） */
export function dayLabel(day: string, now = today()): string {
  const diff = daysBetween(now, day)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === 2) return '后天'
  if (diff === -1) return '昨天'
  const d = parseDay(day)
  const md = `${d.getMonth() + 1}/${d.getDate()}`
  if (d.getFullYear() !== parseDay(now).getFullYear()) return `${d.getFullYear()}/${md}`
  return diff > 0 && diff < 7 ? `${md} ${weekdayOf(day)}` : md
}

/** 一段日子：同一天就一个，不同就「今天 – 10/25」 */
export function spanLabel(from: string, to: string, now = today()): string {
  return from === to ? dayLabel(from, now) : `${dayLabel(from, now)} – ${dayLabel(to, now)}`
}
