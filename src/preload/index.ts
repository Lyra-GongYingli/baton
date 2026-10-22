import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { MainEvent } from '../shared/types'

contextBridge.exposeInMainWorld('baton', {
  call: (name: string, ...args: unknown[]) => ipcRenderer.invoke('api', name, ...args),
  on: (event: MainEvent, cb: (...args: unknown[]) => void) => {
    const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...args)
    ipcRenderer.on(event, listener)
    return () => {
      ipcRenderer.removeListener(event, listener)
    }
  }
})
