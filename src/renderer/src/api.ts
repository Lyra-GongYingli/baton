import { useCallback, useEffect, useState } from 'react'
import type { BatonApi, MainEvent } from '../../shared/types'

interface Bridge {
  call(name: string, ...args: unknown[]): Promise<unknown>
  on(event: MainEvent, cb: (...args: unknown[]) => void): () => void
  pathForFile(file: File): string
}

declare global {
  interface Window {
    baton: Bridge
  }
}

/** api.xxx(...) 会调用主进程里同名的方法 */
export const api = new Proxy({} as BatonApi, {
  get:
    (_target, name: string) =>
    (...args: unknown[]) =>
      window.baton.call(name, ...args)
})

export function onMainEvent(event: MainEvent, cb: (...args: unknown[]) => void): () => void {
  return window.baton.on(event, cb)
}

/** 读取数据；主进程数据变化时自动重新读取 */
export function useData<T>(loader: () => Promise<T>, deps: unknown[]): [T | undefined, () => void] {
  const [data, setData] = useState<T>()
  const load = useCallback(loader, deps)
  const reload = useCallback(() => {
    load().then(setData)
  }, [load])
  useEffect(() => {
    reload()
    return onMainEvent('data-changed', reload)
  }, [reload])
  return [data, reload]
}
