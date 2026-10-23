import { PromptPill } from '../dock/parts'
import { cx } from '../util'
import { InlineEdit, renderPrompt } from './InlineEdit'

/** 提示词框：点一下编辑、双击复制，右上角一个小复制图标（也能按住拖给 AI） */
export function PromptBox({
  value,
  copyText,
  placeholder,
  onSave,
  mini
}: {
  value: string
  /** 复制出去的完整版（{{目标}} 已替换） */
  copyText: string
  placeholder: string
  onSave: (value: string) => void
  mini?: boolean
}) {
  return (
    <div className={cx('prompt-wrap', mini && 'mini', value && 'has-value')}>
      <InlineEdit
        multiline
        className={cx('prompt-field', mini && 'mini')}
        value={value}
        placeholder={placeholder}
        copyText={copyText}
        render={renderPrompt}
        onSave={onSave}
      />
      {value && (
        <span className="prompt-corner">
          <PromptPill text={copyText} />
        </span>
      )}
    </div>
  )
}
