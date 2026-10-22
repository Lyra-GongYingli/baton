import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DraggableAttributes,
  type DraggableSyntheticListeners
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

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

/** 本地先排好再通知主进程，松手时不会闪回原来的顺序 */
export function useLocalOrder(ids: string[]): [string[], (next: string[]) => void] {
  const key = ids.join('|')
  const [order, setOrder] = useState(ids)
  useEffect(() => setOrder(ids), [key])
  return [order, setOrder]
}

/** 单列（或网格）排序 */
export function SortableList<T>({
  items,
  getId,
  onReorder,
  renderItem,
  grid,
  className
}: {
  items: T[]
  getId: (item: T) => string
  onReorder: (ids: string[]) => void
  renderItem: (item: T, handle: DragHandle) => ReactNode
  grid?: boolean
  className?: string
}) {
  const sensors = useDndSensors()
  const [order, setOrder] = useLocalOrder(items.map(getId))
  const byId = new Map(items.map((it) => [getId(it), it]))

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={() => markDragging(true)}
      onDragCancel={() => markDragging(false)}
      onDragEnd={({ active, over }) => {
        markDragging(false)
        if (!over || active.id === over.id) return
        const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)))
        setOrder(next)
        onReorder(next)
      }}
    >
      <SortableContext items={order} strategy={grid ? rectSortingStrategy : verticalListSortingStrategy}>
        <div className={className}>
          {order.map((id) => {
            const item = byId.get(id)
            return item ? <SortableSlot key={id} id={id} render={(h) => renderItem(item, h)} /> : null
          })}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function SortableSlot({ id, render }: { id: string; render: (h: DragHandle) => ReactNode }) {
  return <>{render(useSortableHandle(id))}</>
}
