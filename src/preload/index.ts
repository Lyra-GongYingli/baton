import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { MainEvent } from '../shared/types'

contextBridge.exposeInMainWorld('baton', {
  call: (name: string, ...args: unknown[]) => ipcRenderer.invoke('api', name, ...args),
  on: (event: MainEvent, cb: (...args: unknown[]) => void) => {
    const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...args)
    ipcRenderer.on(event, listener)
    return () => {
      ipcRenderer.removeListener(event, listener)
    }
  },
  /** 拖进来的文件在磁盘上的路径 */
  pathForFile: (file: File) => webUtils.getPathForFile(file)
})
