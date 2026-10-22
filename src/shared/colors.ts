// 项目颜色：创建时挑一个目前用得最少的，存进数据库，保证前几个项目颜色都不一样
export const THREAD_COLORS = [
  '#FF6B57', // 珊瑚
  '#3D7BFF', // 钴蓝
  '#FFAA1C', // 琥珀
  '#3CC48B', // 薄荷
  '#D05CFF', // 紫罗兰
  '#1FB6D4', // 湖蓝
  '#FF5FA2', // 桃粉
  '#7C5CFF' // 靛紫
]

export function pickColor(used: string[]): string {
  const count = new Map(THREAD_COLORS.map((c) => [c, 0]))
  for (const c of used) if (count.has(c)) count.set(c, count.get(c)! + 1)
  const min = Math.min(...count.values())
  return THREAD_COLORS.find((c) => count.get(c) === min)!
}
