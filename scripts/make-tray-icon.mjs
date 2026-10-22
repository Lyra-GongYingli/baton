// 生成菜单栏图标（macOS 模板图：黑色 + 透明度，系统会自动适配深浅色）
// 图案：一个圆环 + 中心圆点，表示"断点"
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size) {
  const s = size / 18
  const cx = size / 2, cy = size / 2
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = [0]
    for (let x = 0; x < size; x++) {
      // 4x4 超采样抗锯齿
      let cover = 0
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const d = Math.hypot(x + (sx + 0.5) / 4 - cx, y + (sy + 0.5) / 4 - cy)
        if ((d <= 7.5 * s && d >= 5.6 * s) || d <= 2.6 * s) cover++
      }
      row.push(0, 0, 0, Math.round((cover / 16) * 255))
    }
    rows.push(Buffer.from(row))
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ])
}

writeFileSync(new URL('../resources/trayTemplate.png', import.meta.url), png(18))
writeFileSync(new URL('../resources/trayTemplate@2x.png', import.meta.url), png(36))
console.log('done')
