import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AgentHooksState, HookAgent } from '../shared/types'

// 自动认出 AI 在做哪个任务：把 Baton 的 hooks 写进 Claude Code 和 Codex 的配置文件。
// 它们每开始一轮、用完一个工具、停下来等你批准、跑完一轮，就跑一下这条命令，把事件 POST 给 Baton 的本机服务（见 live.ts）。
// Baton 没开着时 curl 连不上，马上退出；命令什么也不输出，不会被当成给 AI 的上下文，也不会拦住它。
// 两边的格式一样：{ hooks: { 事件名: [{ matcher?, hooks: [{ type: 'command', command, timeout }] }] } }

const EVENTS: Record<HookAgent, string[]> = {
  claude: ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd'],
  codex: ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PermissionRequest', 'Stop', 'SessionEnd']
}

const NAMES: Record<HookAgent, string> = { claude: 'Claude Code', codex: 'Codex' }

/** Baton 加的那条命令：认它靠地址里的 /hooks/claude、/hooks/codex */
const OURS = /127\.0\.0\.1:\d+\/hooks\/(claude|codex)\b/

type Handler = { type?: unknown; command?: unknown; [key: string]: unknown }
type Group = { matcher?: unknown; hooks?: Handler[]; [key: string]: unknown }
type Config = { hooks?: Record<string, Group[]>; [key: string]: unknown }

/** 配置文件：Claude Code 是 ~/.claude/settings.json，Codex 是 ~/.codex/hooks.json（两边各自的环境变量改了位置也跟着走） */
function configFile(agent: HookAgent): string {
  if (agent === 'claude') return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json')
  return join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'hooks.json')
}

function tilde(path: string): string {
  return path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path
}

/** hooks 跑的命令：把收到的事件原样转给 Baton。$PPID 是跑这条命令的 Claude Code / Codex 进程，Baton 拿它判断会话关没关 */
export function hookCommand(url: string, token: string): string {
  return [
    '/usr/bin/curl -s -o /dev/null --connect-timeout 1 -m 3',
    `-H 'Authorization: Bearer ${token}'`,
    "-H 'Content-Type: application/json'",
    '-H "X-Baton-Pid: $PPID"',
    `--data-binary @- ${url} 2>/dev/null || true`
  ].join(' ')
}

function isOurs(h: Handler | undefined): boolean {
  return typeof h?.command === 'string' && OURS.test(h.command)
}

/** 读配置文件；不存在或是空的算 {}，格式不对就抛出来（这时不能改它） */
function read(file: string): Config {
  if (!existsSync(file)) return {}
  const raw = readFileSync(file, 'utf8')
  if (!raw.trim()) return {}
  const data = JSON.parse(raw)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('不是一个 JSON 对象')
  const hooks = (data as Config).hooks
  if (hooks !== undefined && (!hooks || typeof hooks !== 'object' || Array.isArray(hooks))) throw new Error('hooks 不是对象')
  return data as Config
}

/** 直接写回原文件（是链接也写到它指向的地方），保持两格缩进 */
function write(file: string, config: Config): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
}

/** 拿掉 Baton 加的 hooks，别人的原样留着 */
function strip(config: Config): Record<string, Group[]> {
  const kept: Record<string, Group[]> = {}
  for (const [event, groups] of Object.entries(config.hooks ?? {})) {
    if (!Array.isArray(groups)) {
      kept[event] = groups
      continue
    }
    const rest = groups
      .map((g) => (Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isOurs(h)) } : g))
      .filter((g) => !Array.isArray(g?.hooks) || g.hooks.length > 0)
    if (rest.length) kept[event] = rest
  }
  return kept
}

/** 某个事件下 Baton 的那几条命令 */
function oursIn(config: Config, event: string): string[] {
  const groups = config.hooks?.[event]
  if (!Array.isArray(groups)) return []
  return groups.flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks.filter(isOurs).map((h) => h.command as string) : []))
}

/** hooks 被整个关掉的话，接了也收不到 */
function disabledReason(agent: HookAgent, config: Config): string | null {
  if (agent === 'claude') {
    return config.disableAllHooks === true ? 'Claude Code 的设置里关掉了所有 hooks（disableAllHooks），接了也收不到' : null
  }
  const toml = join(dirname(configFile('codex')), 'config.toml')
  if (!existsSync(toml)) return null
  return /^\s*(codex_)?hooks\s*=\s*false\b/m.test(readFileSync(toml, 'utf8'))
    ? 'Codex 的 config.toml 里关掉了 hooks（[features] hooks = false），接了也收不到'
    : null
}

export function hooksState(agent: HookAgent, url: string, token: string): AgentHooksState {
  const file = configFile(agent)
  const base = { agent, file: tilde(file), found: existsSync(dirname(file)) }
  let config: Config
  try {
    config = read(file)
  } catch {
    return { ...base, status: 'off', problem: `${tilde(file)} 的格式不对，Baton 读不了` }
  }
  const want = hookCommand(`${url}/${agent}`, token)
  const found = EVENTS[agent].map((event) => oursIn(config, event))
  const any = found.some((cmds) => cmds.length > 0)
  const exact = found.every((cmds) => cmds.length === 1 && cmds[0] === want)
  return { ...base, status: exact ? 'on' : any ? 'outdated' : 'off', problem: disabledReason(agent, config) }
}

/** 接入了的 AI：头像动不动按真的在不在跑来 */
export function hooksEnabled(url: string, token: string): Record<HookAgent, boolean> {
  return {
    claude: hooksState('claude', url, token).status !== 'off',
    codex: hooksState('codex', url, token).status !== 'off'
  }
}

export function connectHooks(agent: HookAgent, url: string, token: string): { ok: boolean; message: string } {
  const file = configFile(agent)
  let config: Config
  try {
    config = read(file)
  } catch {
    return { ok: false, message: `${tilde(file)} 的格式不对，Baton 没敢改。修好它再来接` }
  }
  const handler = { type: 'command', command: hookCommand(`${url}/${agent}`, token), timeout: 5 }
  const hooks = strip(config)
  for (const event of EVENTS[agent]) hooks[event] = [...(hooks[event] ?? []), { hooks: [handler] }]
  write(file, { ...config, hooks })
  return { ok: true, message: `已接入：写进了 ${tilde(file)}。新开的 ${NAMES[agent]} 会话生效` }
}

export function disconnectHooks(agent: HookAgent): { ok: boolean; message: string } {
  const file = configFile(agent)
  let config: Config
  try {
    config = read(file)
  } catch {
    return { ok: false, message: `${tilde(file)} 的格式不对，Baton 没敢改` }
  }
  if (!config.hooks) return { ok: true, message: '本来就没接入' }
  const hooks = strip(config)
  const next: Config = { ...config, hooks }
  // Claude Code 的设置里没有别的 hooks 了，就连 hooks 这一项一起拿掉；Codex 的 hooks.json 留个空壳
  if (agent === 'claude' && Object.keys(hooks).length === 0) delete next.hooks
  write(file, next)
  return { ok: true, message: `已断开：从 ${tilde(file)} 里拿掉了 Baton 的 hooks，别的没动` }
}
