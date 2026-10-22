import type { Subtask, Task } from './types'

// 提示词里可以写 {{目标}}，复制时换成任务目标

/** 找出提示词引用了哪些子任务（第一版的 {{S1}} 写法，只在迁移老数据时用） */
export function referencedSubtasks(prompt: string): number[] {
  const refs = new Set<number>()
  for (const m of prompt.matchAll(/\{\{\s*S(\d+)\s*\}\}/gi)) refs.add(Number(m[1]))
  return [...refs].sort((a, b) => a - b)
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
