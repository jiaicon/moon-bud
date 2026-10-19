import { describe, expect, it } from 'vitest'
import { formatDueIn } from '../due-label'

describe('提醒的到期文案', () => {
  it('按提醒自己的时区算"今天"和钟点，不按设备', () => {
    // 上海 10-19 00:30：设备若在 UTC 会看到 10-18 16:30，写成"昨天 16:30"。
    const label = formatDueIn('Asia/Shanghai', new Date('2026-10-18T16:30:00.000Z'), new Date('2026-10-18T21:00:00.000Z'))
    expect(label).toBe('今天 00:30')
  })

  it('明天', () => {
    const label = formatDueIn('Asia/Shanghai', new Date('2026-10-19T14:00:00.000Z'), new Date('2026-10-18T00:00:00.000Z'))
    expect(label).toBe('明天 22:00')
  })

  it('更远日子写出月日', () => {
    const label = formatDueIn('Asia/Shanghai', new Date('2026-10-25T00:00:00.000Z'), new Date('2026-10-18T00:00:00.000Z'))
    expect(label).toBe('10月25日 08:00')
  })

  it('没有到期时刻时说"待定"，不显示 Invalid Date', () => {
    expect(formatDueIn('Asia/Shanghai', null)).toBe('待定')
    expect(formatDueIn('Asia/Shanghai', new Date('nope'))).toBe('待定')
  })

  it('时区名非法时退回设备本地时间，而不是抛错', () => {
    expect(formatDueIn('Mars/Olympus', new Date('2026-10-18T00:00:00.000Z'))).toMatch(/\d{2}:\d{2}/)
  })
})
