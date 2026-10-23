import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 把 Baton 的 MCP 服务加到 Claude Code：找到 claude 命令行（系统里装的，或者桌面版 Claude 自带的），
// 用 `claude mcp add` 写进用户级配置，所有项目里都能用。

function versionKey(v: string): number[] {
  return v.split('.').map((n) => Number(n) || 0)
}

function newestFirst(a: string, b: string): number {
  const x = versionKey(a)
  const y = versionKey(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0)
  }
  return 0
}

export function findClaudeCli(): string | null {
  const home = homedir()
  for (const path of [
    join(home, '.claude/local/claude'),
    join(home, '.local/bin/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude'
  ]) {
    if (existsSync(path)) return path
  }
  // 桌面版 Claude 自带的命令行：…/claude-code/<版本>/<哈希>/claude.app/Contents/MacOS/claude
  const base = join(home, 'Library/Application Support/Claude/claude-code')
  if (!existsSync(base)) return null
  for (const version of readdirSync(base).sort(newestFirst)) {
    for (const hash of readdirSync(join(base, version))) {
      const bin = join(base, version, hash, 'claude.app/Contents/MacOS/claude')
      if (existsSync(bin)) return bin
    }
  }
  return null
}

function run(bin: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 30_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: `${stdout}${stderr}`.trim() })
    })
  })
}

export async function claudeCodeStatus(): Promise<{ cli: boolean; connected: boolean }> {
  const bin = findClaudeCli()
  if (!bin) return { cli: false, connected: false }
  const res = await run(bin, ['mcp', 'get', 'baton'])
  return { cli: true, connected: res.ok }
}

export async function connectClaudeCode(url: string, token: string): Promise<{ ok: boolean; message: string }> {
  const bin = findClaudeCli()
  if (!bin) return { ok: false, message: '没找到 Claude Code 的命令行，请在终端运行设置页里的命令' }
  // 先删掉旧的（比如密钥变了），再加新的
  await run(bin, ['mcp', 'remove', 'baton', '--scope', 'user'])
  const res = await run(bin, [
    'mcp',
    'add',
    '--transport',
    'http',
    '--scope',
    'user',
    'baton',
    url,
    '--header',
    `Authorization: Bearer ${token}`
  ])
  return res.ok
    ? { ok: true, message: '已加到 Claude Code。新开一个 Claude Code 会话就能用了' }
    : { ok: false, message: `添加失败：${res.output.slice(0, 200)}` }
}
