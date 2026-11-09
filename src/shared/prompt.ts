import type { Subtask, Task } from './types'

// 提示词里可以写 {{目标}}，复制时换成任务目标

/** 找出提示词引用了哪些子任务（第一版的 {{S1}} 写法，只在迁移老数据时用） */
export function referencedSubtasks(prompt: string): number[] {
  const refs = new Set<number>()
  for (const m of prompt.matchAll(/\{\{\s*S(\d+)\s*\}\}/gi)) refs.add(Number(m[1]))
  return [...refs].sort((a, b) => a - b)
}

/** 一段文字变成任务 / 子任务时（拖进来的文字、发给 AI 的第一句话），用第一行（文件就用文件名）当标题 */
export function titleFromText(text: string): string {
  const first = text.split('\n').find((l) => l.trim())?.trim() ?? '新子任务'
  const line = first.startsWith('文件：') ? first.slice(3).split('/').pop() || first : first
  return line.length > 30 ? `${line.slice(0, 30)}…` : line
}

/** 复制给 AI 的完整提示词 */
export function expandPrompt(prompt: string, task: Task): string {
  return prompt.replace(/\{\{\s*目标\s*\}\}/g, () => task.goal || '（任务还没写目标）')
}

/** 接力子任务的上一棒（同一层里按当前顺序的前一个） */
export function previousOf(subtask: Subtask, siblings: Subtask[]): Subtask | null {
  if (!subtask.chained) return null
  const i = siblings.findIndex((s) => s.id === subtask.id)
  return i > 0 ? siblings[i - 1] : null
}
