import {
  PointerSensor,
  useSensor,
  useSensors,
  type DraggableAttributes,
  type DraggableSyntheticListeners
} from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CSSProperties } from 'react'

// 拖拽排序：鼠标按住移动 6px 以上才算拖，普通点击不受影响。
// 不开键盘拖动：行里有输入框，按回车会被当成「开始拖动」。

export function useDndSensors() {
  return useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
}

/** 拖动期间在 body 上做个标记，侧边栏看到就不会自动收起 */
export function markDragging(on: boolean): void {
  if (on) document.body.dataset.dragging = '1'
  else delete document.body.dataset.dragging
}

export function isDragging(): boolean {
  return document.body.dataset.dragging === '1'
}

export interface DragHandle {
  setNodeRef: (el: HTMLElement | null) => void
  style: CSSProperties
  attributes: DraggableAttributes
  listeners: DraggableSyntheticListeners
  isDragging: boolean
}

export function useSortableHandle(id: string, disabled = false): DragHandle {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({ id, disabled })
  return {
    setNodeRef,
    style: { transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 5 : undefined },
    attributes,
    listeners,
    isDragging
  }
}
