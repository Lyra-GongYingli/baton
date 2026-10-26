import {
  PointerSensor,
  useSensor,
  useSensors,
  type Activators,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type PointerSensorOptions,
  type SensorInstance,
  type SensorProps
} from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CSSProperties, DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from 'react'
import { INTERNAL_DRAG, toast } from '../dock/parts'

// 拖拽排序：鼠标按住移动 6px 以上才算拖，普通点击不受影响。
// 不开键盘拖动：行里有输入框，按回车会被当成「开始拖动」。
// 带着提示词的任务卡（元素上有 draggable）走浏览器自己的拖放：在 Baton 里照样排序、改状态，
// 拖出窗口丢进 ChatGPT / Claude 等别的软件的输入框，就把提示词粘进去。

export function useDndSensors() {
  return useSensors(useSensor(CardPointerSensor, { activationConstraint: { distance: 6 } }), useSensor(DragOutSensor))
}

/** 拖动时带出去的东西：data 里放 { dragOut }，元素上加 draggable */
export interface DragOut {
  /** 丢进别的软件的输入框时粘进去的文字 */
  text: string
  /** 跟着鼠标走的小纸条；不给就用被拖的元素本身的样子 */
  slip?: { title: string; color: string }
}

/** 照旧的鼠标拖动，只是按在 draggable 的任务卡上时让给 DragOutSensor */
class CardPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: (event: ReactPointerEvent, options: PointerSensorOptions): boolean => {
        const card = (event.target as Element).closest?.('[draggable="true"]')
        if (card && (event.currentTarget as Node).contains(card)) return false
        return PointerSensor.activators[0].handler(event, options)
      }
    }
  ]
}

/**
 * 浏览器原生拖放驱动的 dnd-kit 拖动。
 * 鼠标在窗口里：照常把坐标交给 dnd-kit（排序、跨项目、拖到便签）；在 Baton 里松手 = 普通的拖放。
 * 鼠标出了窗口：卡片先回原位；在别的软件里松手，提示词就粘进去了，Baton 这边当作取消。
 */
class DragOutSensor implements SensorInstance {
  // 原生拖放时浏览器自己会在边上滚动
  autoScrollEnabled = false

  static activators: Activators<object> = [
    {
      eventName: 'onDragStart',
      handler: (event: ReactDragEvent, _options, { active }) => {
        const out = (active.data.current as { dragOut?: DragOut } | undefined)?.dragOut
        if (!out?.text) {
          event.preventDefault()
          return false
        }
        const dt = event.dataTransfer
        dt.setData('text/plain', out.text)
        dt.setData(INTERNAL_DRAG, '1')
        dt.effectAllowed = 'copyMove'
        if (out.slip) setSlipImage(dt, out.slip)
        return true
      }
    }
  ]

  private props: SensorProps<object>
  private source: HTMLElement
  private origin: { x: number; y: number }
  private started = false
  private inside = true
  private dropped = false
  private leaveTimer = 0
  private startTimer = 0

  constructor(props: SensorProps<object>) {
    this.props = props
    const e = props.event as DragEvent
    this.source = e.target as HTMLElement
    this.origin = { x: e.clientX, y: e.clientY }
    window.addEventListener('dragenter', this.onEnter, true)
    window.addEventListener('dragover', this.onOver, true)
    window.addEventListener('dragleave', this.onLeave, true)
    window.addEventListener('drop', this.onDrop, true)
    this.source.addEventListener('dragend', this.onEnd)
    // 浏览器在 dragstart 结束后才给被拖的卡片拍「拖动影子」：等它拍完再让卡片变成占位的样子
    this.startTimer = window.setTimeout(() => {
      this.started = true
      props.onStart(this.origin)
    })
  }

  private onEnter = (e: DragEvent): void => {
    e.preventDefault()
    clearTimeout(this.leaveTimer)
  }

  private onOver = (e: DragEvent): void => {
    // 在 Baton 里到处都能松手（松在哪由 dnd-kit 判断），也不让输入框把提示词吃进去
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    clearTimeout(this.leaveTimer)
    this.inside = true
    if (this.started) this.props.onMove({ x: e.clientX, y: e.clientY })
  }

  private onLeave = (): void => {
    // 在窗口里换个元素也会先 leave 再 enter；一小会儿没有新的 enter / over 才算出了窗口
    clearTimeout(this.leaveTimer)
    this.leaveTimer = window.setTimeout(() => {
      this.inside = false
      if (this.started) this.props.onMove(this.origin)
    }, 80)
  }

  private onDrop = (e: DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    this.dropped = true
  }

  private onEnd = (e: DragEvent): void => {
    window.removeEventListener('dragenter', this.onEnter, true)
    window.removeEventListener('dragover', this.onOver, true)
    window.removeEventListener('dragleave', this.onLeave, true)
    window.removeEventListener('drop', this.onDrop, true)
    this.source.removeEventListener('dragend', this.onEnd)
    clearTimeout(this.leaveTimer)
    clearTimeout(this.startTimer)
    if (this.dropped && this.inside && this.started) this.props.onEnd()
    else this.props.onCancel()
    if (!this.dropped && e.dataTransfer && e.dataTransfer.dropEffect !== 'none') toast('✓ 提示词送过去了')
  }
}

/** 拖动时跟着鼠标的小纸条：先画在屏幕外面，浏览器拍完就拿掉 */
function setSlipImage(dt: DataTransfer, slip: { title: string; color: string }): void {
  const el = document.createElement('div')
  el.className = 'drag-slip'
  el.textContent = slip.title
  el.style.setProperty('--c', slip.color)
  document.body.appendChild(el)
  dt.setDragImage(el, 18, 16)
  window.setTimeout(() => el.remove())
}

/** 拖动期间在 body 上做个标记，侧边栏看到就不会自动收起 */
let dragEndedAt = 0

export function markDragging(on: boolean): void {
  if (on) {
    document.body.dataset.dragging = '1'
  } else {
    delete document.body.dataset.dragging
    dragEndedAt = Date.now()
  }
}

/** 正在拖，或者刚松手 / 刚按 Esc 取消拖动：这一下 Esc 是冲着拖动去的，别再拿去收起窗口 */
export function draggingOrJustDragged(): boolean {
  return isDragging() || Date.now() - dragEndedAt < 300
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
  /** 带着提示词，可以拖出窗口：加在按住拖的那个元素上 */
  draggable?: boolean
}

export function useSortableHandle(id: string, dragOut?: DragOut): DragHandle {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({ id, data: { dragOut } })
  return {
    setNodeRef,
    style: { transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 5 : undefined },
    attributes,
    listeners,
    isDragging,
    draggable: Boolean(dragOut?.text)
  }
}
