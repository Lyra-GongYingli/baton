import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MODEL_OPTIONS, type PublicSettings } from '../shared/types'

export const SHORTCUTS = {
  capture: 'Control+Alt+B',
  clipboard: 'Control+Alt+V'
}

interface StoredSettings {
  currentThreadId: string | null
  model: string
  /** 用系统钥匙串加密后的 API key（base64） */
  apiKeyEnc: string | null
}

const DEFAULTS: StoredSettings = {
  currentThreadId: null,
  model: MODEL_OPTIONS[0].id,
  apiKeyEnc: null
}

let cache: StoredSettings | null = null

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function load(): StoredSettings {
  if (cache) return cache
  cache = { ...DEFAULTS }
  if (existsSync(file())) {
    try {
      cache = { ...DEFAULTS, ...JSON.parse(readFileSync(file(), 'utf8')) }
    } catch {
      // 文件坏了就用默认值
    }
  }
  return cache!
}

function save(patch: Partial<StoredSettings>): void {
  cache = { ...load(), ...patch }
  writeFileSync(file(), JSON.stringify(cache, null, 2))
}

export function getPublicSettings(): PublicSettings {
  const s = load()
  return {
    currentThreadId: s.currentThreadId,
    model: s.model,
    hasApiKey: Boolean(s.apiKeyEnc),
    dataDir: app.getPath('userData'),
    shortcuts: SHORTCUTS
  }
}

export function getCurrentThreadId(): string | null {
  return load().currentThreadId
}

export function setCurrentThread(id: string | null): void {
  save({ currentThreadId: id })
}

export function getModel(): string {
  return load().model
}

export function setModel(model: string): void {
  save({ model })
}

export function setApiKey(key: string): void {
  const trimmed = key.trim()
  if (!trimmed) return
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统钥匙串不可用，无法安全保存 key')
  save({ apiKeyEnc: safeStorage.encryptString(trimmed).toString('base64') })
}

export function clearApiKey(): void {
  save({ apiKeyEnc: null })
}

export function getApiKey(): string | null {
  const enc = load().apiKeyEnc
  if (!enc) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}
