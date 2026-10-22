import type { Step, Thread } from './types'

// 提示词里的占位符：{{S3}} = 步骤 S3 的产物，{{目标}} = 线程目标
const PLACEHOLDER = /\{\{\s*(S(\d+)|目标)\s*\}\}/gi

/** 找出提示词引用了哪些步骤（按编号，去重、升序） */
export function referencedSteps(prompt: string): number[] {
  const refs = new Set<number>()
  for (const m of prompt.matchAll(PLACEHOLDER)) {
    if (m[2]) refs.add(Number(m[2]))
  }
  return [...refs].sort((a, b) => a - b)
}

export function stepOutputText(step: Step): string {
  return step.outputs
    .map((a) => (a.kind === 'link' ? `${a.title ? a.title + '：' : ''}${a.content}` : a.content))
    .join('\n\n---\n\n')
}

/** 把占位符展开成真实内容，复制给 AI 用 */
export function expandPrompt(prompt: string, thread: Thread, steps: Step[]): string {
  const byRef = new Map(steps.map((s) => [s.ref, s]))
  return prompt.replace(PLACEHOLDER, (whole, _key: string, num: string | undefined) => {
    if (!num) return thread.goal || '（线程还没写目标）'
    const step = byRef.get(Number(num))
    if (!step) return `【S${num} 不存在】`
    const text = stepOutputText(step)
    return text || `【S${num}「${step.title}」还没有产物】`
  })
}
