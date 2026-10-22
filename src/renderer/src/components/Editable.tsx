import { useEffect, useRef, useState, type KeyboardEvent, type RefObject, type TextareaHTMLAttributes } from 'react'
import { cx } from '../util'

interface Props {
  value: string
  onSave: (value: string) => void
  placeholder?: string
  multiline?: boolean
  className?: string
  rows?: number
  autoFocus?: boolean
}

/**
 * 编辑时保留本地草稿，失焦时保存；没在编辑时跟随外部数据更新。
 * 单行：回车保存，Esc 撤销。多行：⌘+回车保存。
 */
export function Editable({ value, onSave, placeholder, multiline, className, rows = 3, autoFocus }: Props) {
  const [draft, setDraft] = useState(value)
  const editing = useRef(false)

  useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value])

  const commit = (): void => {
    editing.current = false
    if (draft !== value) onSave(draft)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      setDraft(value)
      editing.current = false
      e.currentTarget.blur()
    } else if (e.key === 'Enter' && (!multiline || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }

  const shared = {
    value: draft,
    placeholder,
    autoFocus,
    className: cx('editable', className),
    onFocus: () => (editing.current = true),
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown
  }

  return multiline ? <AutoTextarea {...shared} minRows={rows} /> : <input {...shared} />
}

/** 高度随内容自动变化的输入框 */
export function AutoTextarea({
  minRows = 3,
  ref: outerRef,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  minRows?: number
  ref?: RefObject<HTMLTextAreaElement | null>
}) {
  const innerRef = useRef<HTMLTextAreaElement>(null)
  const ref = outerRef ?? innerRef
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [props.value, ref])
  return <textarea ref={ref} rows={minRows} {...props} />
}
