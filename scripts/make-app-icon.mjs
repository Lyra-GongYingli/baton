// 生成 App 图标：用 Electron 把一段 HTML 画成 1024×1024 的 PNG，再用 sips + iconutil 做成 icon.icns
// 图案：暖白底的圆角方块（带侧边栏那种洞洞板小点），上面斜放一根三色接力棒，和界面里的 baton-mark 一样
// 用法：npx electron scripts/make-app-icon.mjs
import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const html = `<!doctype html><html><body style="margin:0;background:transparent;width:1024px;height:1024px;overflow:hidden">
<style>
  .bg {
    position: absolute; left: 100px; top: 100px; width: 824px; height: 824px; border-radius: 186px;
    background:
      radial-gradient(rgba(0,0,0,0.07) 5px, transparent 5.5px) 0 0 / 56px 56px,
      linear-gradient(165deg, #fffdf8 0%, #f1eee6 100%);
    box-shadow: 0 22px 44px rgba(0,0,0,0.22), inset 0 3px 0 rgba(255,255,255,0.9), inset 0 -4px 0 rgba(0,0,0,0.05);
  }
  .baton {
    position: absolute; left: 50%; top: 50%; width: 640px; height: 196px; margin: -98px 0 0 -320px;
    border-radius: 98px; transform: rotate(-24deg);
    background: linear-gradient(90deg, #ff6b57 0 33.3%, #ffaa1c 33.3% 66.6%, #3d7bff 66.6%);
    box-shadow: 0 34px 50px -12px rgba(30,30,60,0.38), inset 0 -26px 0 rgba(0,0,0,0.13), inset 0 18px 0 rgba(255,255,255,0.22);
  }
</style>
<div class="bg"><div class="baton"></div></div></body></html>`

const root = join(import.meta.dirname, '..', 'resources')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 400))
  let img = await win.webContents.capturePage()
  if (img.getSize().width !== 1024) img = img.resize({ width: 1024, height: 1024, quality: 'best' })
  const master = join(root, 'icon.png')
  writeFileSync(master, img.toPNG())

  // 各种尺寸 → icon.iconset → icon.icns
  const set = join(root, 'icon.iconset')
  rmSync(set, { recursive: true, force: true })
  mkdirSync(set)
  for (const size of [16, 32, 128, 256, 512]) {
    for (const [scale, suffix] of [[1, ''], [2, '@2x']]) {
      const px = size * scale
      execFileSync('sips', ['-z', String(px), String(px), master, '--out', join(set, `icon_${size}x${size}${suffix}.png`)], { stdio: 'ignore' })
    }
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', join(root, 'icon.icns')])
  rmSync(set, { recursive: true, force: true })
  console.log('wrote resources/icon.png and resources/icon.icns')
  app.quit()
})
