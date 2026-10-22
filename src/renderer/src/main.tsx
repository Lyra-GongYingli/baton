import { StrictMode, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { DockApp } from './dock/DockApp'
import { Handle } from './dock/Handle'
import './styles.css'
import './dock/dock.css'

// 同一份界面代码，按窗口地址里的 #xxx 决定显示哪个
const route = location.hash.slice(1)
document.body.classList.add(`route-${route || 'main'}`)

// 文件拖进窗口时，默认会让页面跳转到那个文件，拦掉
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => e.preventDefault())

const screens: Record<string, () => JSX.Element> = {
  dock: DockApp,
  handle: Handle
}
const Screen = screens[route] ?? App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Screen />
  </StrictMode>
)
