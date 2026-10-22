import { useState } from 'react'
import { MODEL_OPTIONS } from '../../../shared/types'
import { api, useData } from '../api'

/** Electron 的快捷键写法 → Mac 符号 */
function prettyShortcut(acc: string): string {
  return acc
    .replace('Control', '⌃')
    .replace('Alt', '⌥')
    .replace('Shift', '⇧')
    .replace(/Command|CommandOrControl/, '⌘')
    .replaceAll('+', '')
}

export function Settings() {
  const [settings, reload] = useData(() => api.getSettings(), [])
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState('')

  if (!settings) return <div className="page" />

  const saveKey = async (): Promise<void> => {
    try {
      await api.setApiKey(key)
      setKey('')
      setMsg('已保存（用系统钥匙串加密）')
    } catch (err) {
      setMsg(String((err as Error).message).replace(/^.*?Error: /, ''))
    }
    reload()
  }

  return (
    <div className="page settings-page">
      <header className="page-header">
        <h1>设置</h1>
      </header>

      <section className="settings-section">
        <h2>AI</h2>
        <div className="setting-row">
          <div>
            <div className="setting-label">Anthropic API key</div>
            <div className="muted small">
              {settings.hasApiKey ? '已设置。' : '未设置。'}用于生成断点卡。在 platform.claude.com 创建，和 Claude
              会员订阅分开计费。
            </div>
          </div>
          <div className="setting-control">
            <input
              type="password"
              value={key}
              placeholder={settings.hasApiKey ? '••••••••（输入新的会覆盖）' : 'sk-ant-…'}
              onChange={(e) => setKey(e.target.value)}
            />
            <button className="btn primary small" disabled={!key.trim()} onClick={saveKey}>
              保存
            </button>
            {settings.hasApiKey && (
              <button
                className="btn ghost small danger"
                onClick={async () => {
                  await api.clearApiKey()
                  setMsg('已清除')
                  reload()
                }}
              >
                清除
              </button>
            )}
          </div>
        </div>
        {msg && <p className="muted small">{msg}</p>}

        <div className="setting-row">
          <div>
            <div className="setting-label">模型</div>
            <div className="muted small">断点卡用哪个模型生成。</div>
          </div>
          <div className="setting-control">
            <select
              className="select"
              value={settings.model}
              onChange={async (e) => {
                await api.setModel(e.target.value)
                reload()
              }}
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>全局快捷键</h2>
        <p className="muted small">在任何软件里都能用。关掉主窗口后 Baton 仍在菜单栏运行，快捷键继续有效。</p>
        <div className="setting-row">
          <div className="setting-label">记断点（打开快速记录小窗）</div>
          <kbd>{prettyShortcut(settings.shortcuts.capture)}</kbd>
        </div>
        <div className="setting-row">
          <div className="setting-label">把剪贴板存到当前线程</div>
          <kbd>{prettyShortcut(settings.shortcuts.clipboard)}</kbd>
        </div>
      </section>

      <section className="settings-section">
        <h2>数据</h2>
        <div className="setting-row">
          <div>
            <div className="setting-label">数据存在本机</div>
            <div className="muted small mono">{settings.dataDir}</div>
          </div>
          <button className="btn small" onClick={() => api.showDataDir()}>
            在 Finder 中显示
          </button>
        </div>
      </section>
    </div>
  )
}
