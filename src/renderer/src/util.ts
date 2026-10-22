export function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}

/** 拖进来的一段文字变成子任务时，用第一行（文件就用文件名）当标题 */
export function titleFromText(text: string): string {
  const first = text.split('\n').find((l) => l.trim())?.trim() ?? '新子任务'
  const line = first.startsWith('文件：') ? first.slice(3).split('/').pop() || first : first
  return line.length > 30 ? `${line.slice(0, 30)}…` : line
}
