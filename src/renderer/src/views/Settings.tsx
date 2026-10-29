import { useEffect, useState } from 'react'
import type { AgentHooksState, DockSide, HookAgent } from '../../../shared/types'
import { api, useData } from '../api'
import { cx } from '../util'
import { toast } from '../dock/parts'

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

      <McpSection mcp={settings.mcp} />

      <AgentHooksSection aiProjectId={settings.aiProjectId} onChange={reload} />

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

/** 让 Claude Code 等 AI 工具通过 MCP 直接操控 Baton */
function McpSection({ mcp }: { mcp: { url: string; token: string; running: boolean; error: string | null } }) {
  const command = `claude mcp add --transport http --scope user baton ${mcp.url} --header "Authorization: Bearer ${mcp.token}"`
  const [cc, setCc] = useState<{ cli: boolean; connected: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    api.claudeCodeStatus().then(setCc)
  }, [])

  const connect = async (): Promise<void> => {
    setBusy(true)
    const res = await api.connectClaudeCode()
    setMsg(res.message)
    setBusy(false)
    api.claudeCodeStatus().then(setCc)
  }

  return (
    <section className="settings-section">
      <h2>让 AI 操控 Baton</h2>
      <p className="muted small">
        Baton 在本机开了一个 MCP 服务。把它加到 Claude Code 之后，就可以直接对 Claude 说「把这个记到 Baton」「帮我把这个任务拆成子任务」「S2
        做完了，标一下」。只有这台电脑能访问，而且要带密钥。Baton 需要开着。
      </p>
      <div className="setting-row">
        <div>
          <div className="setting-label">服务状态</div>
          <div className="muted small">{mcp.running ? `运行中：${mcp.url}` : `没有运行：${mcp.error ?? '正在启动'}`}</div>
        </div>
        <span className={cx('mcp-dot', mcp.running && 'on')} />
      </div>
      <div className="setting-row">
        <div>
          <div className="setting-label">Claude Code</div>
          <div className="muted small">
            {cc === null
              ? '正在检查…'
              : cc.connected
                ? '已连接：在 Claude Code 里就能直接操控 Baton'
                : cc.cli
                  ? '还没连接。点右边的按钮自动加上（所有项目里都能用）'
                  : '没找到 Claude Code 的命令行，可以在终端运行下面的命令'}
          </div>
          {msg && <div className="small mcp-msg">{msg}</div>}
        </div>
        {cc?.cli && (
          <button className="btn primary small" disabled={busy} onClick={connect}>
            {busy ? '正在添加…' : cc.connected ? '重新连接' : '一键加到 Claude Code'}
          </button>
        )}
      </div>
      <div className="setting-block">
        <div className="setting-label">或者在终端运行这条命令</div>
        <pre className="cmd">{command}</pre>
        <button
          className="btn small"
          onClick={async () => {
            await api.copyText(command)
            toast('✓ 命令已复制，去终端粘贴运行')
          }}
        >
          复制命令
        </button>
      </div>
      <p className="muted small">
        其他支持 MCP（Streamable HTTP）的工具也能连：地址 {mcp.url}，请求头 Authorization: Bearer 加上面命令里的密钥。
      </p>
    </section>
  )
}

const HOOK_NAMES: Record<HookAgent, string> = { claude: 'Claude Code', codex: 'Codex' }

/** 自动认出 AI 在做哪个任务：把 Baton 的 hooks 接进 Claude Code、Codex；认不出来的会话建成任务放进哪个项目 */
function AgentHooksSection({ aiProjectId, onChange }: { aiProjectId: string | null; onChange: () => void }) {
  const [states, setStates] = useState<AgentHooksState[] | null>(null)
  const [trees] = useData(() => api.listProjects(), [])
  const [busy, setBusy] = useState<HookAgent | null>(null)
  const [msg, setMsg] = useState<Partial<Record<HookAgent, string>>>({})
  useEffect(() => {
    api.agentHooksStatus().then(setStates)
  }, [])

  const toggle = async (agent: HookAgent, on: boolean): Promise<void> => {
    setBusy(agent)
    const res = on ? await api.connectAgentHooks(agent) : await api.disconnectAgentHooks(agent)
    setMsg((m) => ({ ...m, [agent]: res.message }))
    setBusy(null)
    api.agentHooksStatus().then(setStates)
  }

  const describe = (s: AgentHooksState): string =>
    s.status === 'on'
      ? `已接入（写在 ${s.file}）`
      : s.status === 'outdated'
        ? '接过，但地址或密钥变了，点「更新」重新接一次'
        : s.found
          ? `还没接入。会写进 ${s.file}，你自己的 hooks 原样留着`
          : `这台电脑上没找到 ${HOOK_NAMES[s.agent]} 的配置，装好用过一次再来`

  return (
    <section className="settings-section">
      <h2>自动认出 AI 在做哪个任务</h2>
      <p className="muted small">
        接入以后，Claude Code 和 Codex 每开始一轮、等你批准、跑完一轮，都会告诉 Baton（只发到这台电脑上的 Baton，Baton
        没开着时什么也不会发生）。从 Baton 拖出去或复制的提示词一发出去，Baton 就认得出是哪个任务：待办的自动变成进行中，头像动起来；等你批准时头像上亮黄点，一轮跑完亮蓝点「等你看」，不会自动标成完成。第一句话认不出是哪个任务的会话，会记成「AI 会话」里的一个子任务，名字用 AI 给会话起的标题，和手动建的子任务一样用。正在跑的会话列在晾衣绳便签的最上面。新开的会话生效。
      </p>
      {states === null && <div className="setting-row muted small">正在检查…</div>}
      {states?.map((s) => (
        <div key={s.agent} className="setting-row">
          <div>
            <div className="setting-label">{HOOK_NAMES[s.agent]}</div>
            <div className="muted small">{describe(s)}</div>
            {s.problem && <div className="small mcp-msg warn">{s.problem}</div>}
            {msg[s.agent] && <div className="small mcp-msg">{msg[s.agent]}</div>}
          </div>
          <div className="setting-control">
            {s.status !== 'off' && (
              <button className="btn small" disabled={busy === s.agent} onClick={() => toggle(s.agent, false)}>
                断开
              </button>
            )}
            {s.status !== 'on' && s.found && (
              <button className="btn primary small" disabled={busy === s.agent} onClick={() => toggle(s.agent, true)}>
                {s.status === 'outdated' ? '更新' : '一键接入'}
              </button>
            )}
          </div>
        </div>
      ))}
      <div className="setting-row">
        <div>
          <div className="setting-label">认不出来的会话放进</div>
          <div className="muted small">记成这个项目里「AI 会话」任务的子任务，交给那个 AI；「AI 会话」做完了，下一个会话会另起一个</div>
        </div>
        <div className="setting-control">
          <select
            className="select"
            value={aiProjectId ?? ''}
            onChange={async (e) => {
              await api.setAiProject(e.target.value)
              onChange()
            }}
          >
            {/* 还没有的话，第一次用到时才建「AI 任务」 */}
            {!aiProjectId && <option value="">AI 任务（用到时新建）</option>}
            {trees?.map(({ project }) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  )
}
