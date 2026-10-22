import { useState } from 'react'
import { api } from '../api'
import { cx } from '../util'

export function CopyButton({ label, getText, className }: { label: string; getText: () => string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className={cx('btn small', copied && 'copied', className)}
      onClick={async () => {
        await api.copyText(getText())
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? '已复制 ✓' : label}
    </button>
  )
}
