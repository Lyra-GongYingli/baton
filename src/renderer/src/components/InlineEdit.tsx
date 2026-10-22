import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '../util'
import { copyWithFlash, useDelayedClick } from './Copy'
import { AutoTextarea } from './Editable'

// 点一下就地编辑，双击复制。标题、提示词、目标都用它。

export interface RefChip {
  token: string
  label: string
}

interface Props {
  value: string
  onSave: (value: string) => void
  placeholder: string
  multiline?: boolean
  /** 双击时复制的内容（比如展开占位符后的完整提示词）；不传就复制原文 */
  copyText?: string
  /** 编辑时下面列出的可插入占位符 */
  chips?: RefChip[]
  /** 不在编辑时怎么显示（比如把 {{S1}} 高亮） */
  render?: (value: string) => ReactNode
  className?: string
}

export function InlineEdit({ value, onSave, placeholder, multiline, copyText, chips, render, className }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const click = useDelayedClick(() => setEditing(true))

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const commit = (): void => {
    setEditing(false)
    if (draft !== value) onSave(draft)
  }
  const cancel = (): void => {
    setDraft(value)
    setEditing(false)
  }

  /** 把占位符插到光标位置 */
  const insert = (token: string): void => {
    const el = areaRef.current
    const start = el?.selectionStart ?? draft.length
    const end = el?.selectionEnd ?? draft.length
    setDraft(draft.slice(0, start) + token + draft.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  if (editing) {
    // 编辑时按下不要触发外层的拖动排序
    const stop = { onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation() }
    if (!multiline) {
      return (
        <input
          className={cx('inline-input', className)}
          autoFocus
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel()
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit()
          }}
          {...stop}
        />
      )
    }
    return (
      <div className={cx('inline-area', className)} onClick={(e) => e.stopPropagation()} {...stop}>
        <AutoTextarea
          ref={areaRef}
          autoFocus
          minRows={3}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel()
            if (e.key === 'Enter' && e.metaKey) commit()
          }}
        />
        {chips && chips.length > 0 && (
          <div className="ref-chips">
            <span className="muted">插入：</span>
            {chips.map((c) => (
              <button
                key={c.token}
                className="chip"
                title={`在光标处插入 ${c.token}，复制时会换成${c.label}的内容`}
                // 用 mousedown + preventDefault，输入框不会失焦
                onMouseDown={(e) => {
                  e.preventDefault()
                  insert(c.token)
                }}
              >
                {c.token} {c.label}
              </button>
            ))}
            <span className="ref-hint">⌘↩ 完成 · esc 取消</span>
          </div>
        )}
      </div>
    )
  }

  const Tag = multiline ? 'div' : 'span'
  return (
    <Tag
      className={cx('inline-display', multiline && 'multi', !value && 'empty', className)}
      title={value ? '点一下编辑，双击复制' : '点一下填写'}
      onClick={(e) => {
        e.stopPropagation()
        click.onClick(e)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (value) copyWithFlash(copyText ?? value, e)
      }}
    >
      {value ? (render ? render(value) : value) : placeholder}
    </Tag>
  )
}

/** 提示词里的 {{S1}}、{{目标}} 高亮显示 */
export function renderPrompt(text: string): ReactNode {
  return text.split(/(\{\{\s*(?:S\d+|目标)\s*\}\})/gi).map((part, i) =>
    /^\{\{/.test(part) ? (
      <span key={i} className="token">
        {part}
      </span>
    ) : (
      part
    )
  )
}
