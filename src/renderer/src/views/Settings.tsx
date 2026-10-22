import type { DockSide } from '../../../shared/types'
import { api, useData } from '../api'
import { cx } from '../util'

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

  if (!settings) return <div className="page" />

  return (
    <div className="page settings-page">
      <header className="page-header">
        <h1>设置</h1>
      </header>

      <section className="settings-section">
        <h2>侧边栏</h2>
        <div className="setting-row">
          <div>
            <div className="setting-label">贴在屏幕哪一边</div>
            <div className="muted small">把手也可以按住底部的小点上下拖动换位置。</div>
          </div>
          <div className="segmented">
            {(['left', 'right'] as DockSide[]).map((side) => (
              <button
                key={side}
                className={cx(settings.dock.side === side && 'active')}
                onClick={async () => {
                  await api.setDockSide(side)
                  reload()
                }}
              >
                {side === 'left' ? '左边' : '右边'}
              </button>
            ))}
          </div>
        </div>
        <label className="setting-row">
          <div>
            <div className="setting-label">鼠标碰到把手就展开</div>
            <div className="muted small">关掉后需要点一下把手才展开，避免误碰。</div>
          </div>
          <input
            type="checkbox"
            checked={settings.dock.hoverOpen}
            onChange={async (e) => {
              await api.setDockHoverOpen(e.target.checked)
              reload()
            }}
          />
        </label>
        <label className="setting-row">
          <div>
            <div className="setting-label">一直展开（钉住）</div>
            <div className="muted small">侧边栏右上角的图钉也能切换。</div>
          </div>
          <input
            type="checkbox"
            checked={settings.dock.pinned}
            onChange={async (e) => {
              await api.setDockPinned(e.target.checked)
              reload()
            }}
          />
        </label>
      </section>

      <section className="settings-section">
        <h2>全局快捷键</h2>
        <p className="muted small">在任何软件里都能用。关掉大窗口后 Baton 仍在侧边和菜单栏运行，快捷键继续有效。</p>
        <div className="setting-row">
          <div className="setting-label">展开 / 收起侧边栏</div>
          <kbd>{prettyShortcut(settings.shortcuts.dock)}</kbd>
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
