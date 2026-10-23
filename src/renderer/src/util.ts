export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}

/** 拖进来的一段文字变成子任务时，用第一行（文件就用文件名）当标题 */
export function titleFromText(text: string): string {
  const first = text.split('\n').find((l) => l.trim())?.trim() ?? '新子任务'
  const line = first.startsWith('文件：') ? first.slice(3).split('/').pop() || first : first
  return line.length > 30 ? `${line.slice(0, 30)}…` : line
}
