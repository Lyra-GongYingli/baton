import Anthropic from '@anthropic-ai/sdk'
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema'
import { net } from 'electron'
import type { Breakpoint, ThreadDetail } from '../shared/types'
import { STEP_STATUS_LABEL, THREAD_STATUS_LABEL } from '../shared/types'
import { getApiKey, getModel } from './settings'

// 这些模型支持服务端兜底：被安全分类器拒绝时自动换模型重试
const SERVER_FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-fable-5-1',
  'claude-sonnet-5-5'
])

const BREAKPOINT_SCHEMA = {
  type: 'object',
  properties: {
    where: { type: 'string', description: '停在哪：最后完成或正在进行的具体动作' },
    done: { type: 'string', description: '已完成的要点，简短' },
    next: { type: 'string', description: '下一步具体做什么，一个可以马上动手的动作' },
    blockers: { type: 'string', description: '卡点或需要用户决定的事；没有就是空字符串' },
    next_prompt: {
      type: 'string',
      description: '下一步要发给 AI 的完整提示词；下一步不需要 AI 就是空字符串'
    },
    next_tool: { type: 'string', description: '下一步建议用的工具或软件' }
  },
  required: ['where', 'done', 'next', 'blockers', 'next_prompt', 'next_tool'],
  additionalProperties: false
} as const

const SYSTEM = `你是用户的任务接力助手。用户同时推进好几个任务线程，每个线程要在多个 AI 工具和软件之间来回接力，切换时很容易忘了做到哪、下一步是什么、提示词怎么写。

根据用户给出的线程记录，生成一张"断点卡"，让用户切回这个线程时 30 秒内就能接着干。

要求：
- 只依据记录里的事实，不要编造记录里没有的进展。记录不足时，next 可以是"补充 xx 信息"。
- where 要具体，例如"S2 的 PRD 初稿已由 Claude 生成，还没审核"，不要写"正在推进中"这类空话。
- next 只写一个最该先做的动作。
- next_prompt 写成可以直接复制发给 AI 的完整提示词，交代清楚背景、目标和输出要求。需要引用某个步骤的产物时，写占位符 {{S编号}}（例如 {{S1}}），需要线程目标时写 {{目标}}，复制时会自动替换成真实内容，不要把产物原文抄进提示词。
- 全部用中文，简洁。`

/** 把线程整理成给模型看的文本 */
function buildContext(detail: ThreadDetail): string {
  const { thread, steps, logs } = detail
  const clip = (text: string, max: number): string =>
    text.length > max ? `${text.slice(0, max)}…（后面还有 ${text.length - max} 字，已省略）` : text

  const lines: string[] = [
    `# 线程：${thread.title}`,
    `状态：${THREAD_STATUS_LABEL[thread.status]}`,
    `目标：${thread.goal || '（未填写）'}`,
    `完成标准：${thread.doneCriteria || '（未填写）'}`,
    '',
    '## 步骤（按顺序）'
  ]
  if (steps.length === 0) lines.push('（还没有步骤）')
  for (const s of steps) {
    lines.push(`### S${s.ref} ${s.title} —— ${STEP_STATUS_LABEL[s.status]}${s.tool ? `（用 ${s.tool}）` : ''}`)
    if (s.prompt) lines.push(`提示词：\n${clip(s.prompt, 3000)}`)
    if (s.notes) lines.push(`备注：${clip(s.notes, 2000)}`)
    for (const a of s.outputs) {
      lines.push(
        a.kind === 'link'
          ? `产物（链接）${a.title}：${a.content}`
          : `产物${a.title ? `「${a.title}」` : ''}：\n${clip(a.content, 4000)}`
      )
    }
  }
  lines.push('', '## 最近的记录（新的在前）')
  if (logs.length === 0) lines.push('（还没有记录）')
  for (const l of logs.slice(0, 30)) {
    lines.push(`- [${new Date(l.createdAt).toLocaleString('zh-CN')}] ${clip(l.content, 2000)}`)
  }
  return lines.join('\n')
}

function client(): Anthropic {
  const apiKey = getApiKey()
  // 用 Electron 的网络栈发请求，这样会走系统代理
  const fetch = net.fetch as unknown as typeof globalThis.fetch
  return apiKey ? new Anthropic({ apiKey, fetch }) : new Anthropic({ fetch })
}

export async function generateBreakpoint(detail: ThreadDetail): Promise<Breakpoint> {
  const model = getModel()
  const fallback = SERVER_FALLBACK_MODELS.has(model)
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
    : {}

  let res
  try {
    res = await client().beta.messages.parse({
      model,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: 'medium', format: betaJSONSchemaOutputFormat(BREAKPOINT_SCHEMA) },
      messages: [{ role: 'user', content: buildContext(detail) }],
      ...fallback
    })
  } catch (err) {
    throw new Error(friendlyError(err))
  }

  if (res.stop_reason === 'refusal') throw new Error('模型拒绝了这次请求，换个说法或换个模型试试')
  if (res.stop_reason === 'max_tokens') throw new Error('输出被截断了，线程内容可能太长')
  const out = res.parsed_output
  if (!out) throw new Error('AI 返回的格式不对，再试一次')

  return {
    where: out.where,
    done: out.done,
    next: out.next,
    blockers: out.blockers,
    nextPrompt: out.next_prompt,
    nextTool: out.next_tool,
    source: 'ai',
    updatedAt: Date.now()
  }
}

function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'API key 无效，去「设置」里重新填一下'
  if (err instanceof Anthropic.PermissionDeniedError) return '这个 API key 没有权限使用当前模型'
  if (err instanceof Anthropic.NotFoundError) return '找不到这个模型，去「设置」里换一个'
  if (err instanceof Anthropic.RateLimitError) return '请求太频繁或额度不足，稍后再试'
  if (err instanceof Anthropic.BadRequestError) return `请求有误：${err.message}`
  if (err instanceof Anthropic.APIConnectionError) return '连不上 Anthropic 服务器，检查一下网络或代理'
  if (err instanceof Anthropic.APIError) return `API 出错（${err.status}）：${err.message}`
  const msg = err instanceof Error ? err.message : String(err)
  if (/api.?key|credential|auth/i.test(msg)) return '还没有设置 API key，去「设置」里填一下'
  return msg
}
