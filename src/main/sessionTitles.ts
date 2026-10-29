import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs'
import { join } from 'node:path'
import type { HookAgent } from '../shared/types'
import { configDir } from './agentHooks'

// AI 给会话起的标题（「Claude/Codex/Muse 任务自检测」这种，说清主体和意图），拿来给自动记下的子任务起名。
// Claude Code 记在对话记录里（custom-title 那一行，第一轮跑完后写上，接着上一段对话开的会话一开头就有）；
// Codex 记在 session_index.jsonl 里（thread_name）。只找标题那一行，对话内容不看也不存。

const CHUNK = 256 * 1024

/** 这个会话现在的标题；还没起好、或者找不到是 null */
export function sessionTitle(agent: HookAgent, sessionId: string, transcript: string): string | null {
  const title = agent === 'claude' ? claudeTitle(transcript || findTranscript(sessionId)) : codexTitle(sessionId)
  return title ? title.replace(/\s+/g, ' ').trim().slice(0, 40) || null : null
}

/** Claude Code 的对话记录在 ~/.claude/projects/<目录>/<会话 id>.jsonl；hooks 每次都会带上路径，以前的会话按 id 找 */
export function findTranscript(sessionId: string): string {
  const root = join(configDir('claude'), 'projects')
  try {
    for (const dir of readdirSync(root)) {
      const file = join(root, dir, `${sessionId}.jsonl`)
      if (existsSync(file)) return file
    }
  } catch {
    // 没有这个目录：没用过 Claude Code
  }
  return ''
}

/** 对话记录里最后一条 custom-title：先看文件末尾（改过名的在后面），没有再看开头 */
function claudeTitle(file: string): string | null {
  if (!file) return null
  let fd: number
  try {
    fd = openSync(file, 'r')
  } catch {
    return null
  }
  try {
    const size = fstatSync(fd).size
    const read = (start: number, length: number): string => {
      const buf = Buffer.alloc(length)
      readSync(fd, buf, 0, length, start)
      return buf.toString('utf8')
    }
    const tail = lastTitle(read(Math.max(0, size - CHUNK), Math.min(size, CHUNK)))
    return tail ?? (size > CHUNK ? lastTitle(read(0, CHUNK)) : null)
  } finally {
    closeSync(fd)
  }
}

function lastTitle(text: string): string | null {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"custom-title"')) continue
    try {
      const entry = JSON.parse(lines[i])
      if (entry.type === 'custom-title' && typeof entry.customTitle === 'string' && entry.customTitle.trim()) {
        return entry.customTitle
      }
    } catch {
      // 切在半行上的那一行
    }
  }
  return null
}

/** Codex 的会话列表：一行一个会话，改名会再记一行，取最后一条 */
function codexTitle(sessionId: string): string | null {
  let text: string
  try {
    text = readFileSync(join(configDir('codex'), 'session_index.jsonl'), 'utf8')
  } catch {
    return null
  }
  let title: string | null = null
  for (const line of text.split('\n')) {
    if (!line.includes(sessionId)) continue
    try {
      const entry = JSON.parse(line)
      if (entry.id === sessionId && typeof entry.thread_name === 'string' && entry.thread_name.trim()) title = entry.thread_name
    } catch {
      // 写到一半的行
    }
  }
  return title
}
