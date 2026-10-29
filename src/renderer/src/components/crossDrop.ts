import { useSyncExternalStore } from 'react'

// 晾衣绳上把子任务、子子任务拖到别的任务卡片上。每张卡片标着 data-drop-task，卡片里每个子任务（连同它下面的子子任务那几行）
// 标着 data-drop-sub。拖着的时候按鼠标所在的位置找停在哪张卡片、哪个子任务上，那张卡片和那一行跟着亮起来，松手就挪过去。

export interface CrossTarget {
  taskId: string
  /** 任务名：拖着时提示「挪到「…」」 */
  title: string
  /** 停在哪个子任务上（它的子子任务那几行也算）；空 = 卡片别处，挪过去当子任务 */
  parentId: string
  /** 那个子任务的编号，S2 */
  label: string
}

let current: CrossTarget | null = null
const listeners = new Set<() => void>()

/** 鼠标在 (x, y) 时停在哪张别的任务卡片上；在自己这张卡片上、或者不在任何卡片上是 null */
export function findCrossTarget(x: number, y: number, fromTaskId: string): CrossTarget | null {
  // 最上面是跟着鼠标走的预览，往下找第一张卡片
  for (const el of document.elementsFromPoint(x, y)) {
    const card = el.closest<HTMLElement>('[data-drop-task]')
    if (!card) continue
    if (card.dataset.dropTask === fromTaskId) return null
    const sub = el.closest<HTMLElement>('[data-drop-sub]')
    const onRow = sub !== null && card.contains(sub)
    return {
      taskId: card.dataset.dropTask ?? '',
      title: card.dataset.dropTitle ?? '',
      parentId: onRow ? (sub.dataset.dropSub ?? '') : '',
      label: onRow ? (sub.dataset.dropLabel ?? '') : ''
    }
  }
  return null
}

export function setCrossTarget(next: CrossTarget | null): void {
  if (next?.taskId === current?.taskId && next?.parentId === current?.parentId) return
  current = next
  for (const l of listeners) l()
}

export function crossTarget(): CrossTarget | null {
  return current
}

export function useCrossTarget(): CrossTarget | null {
  return useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, crossTarget)
}
