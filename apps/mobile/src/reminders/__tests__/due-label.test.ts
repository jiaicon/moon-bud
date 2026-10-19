import { describe, expect, it } from 'vitest'
import { formatDueIn } from '../due-label'

describe('提醒的到期文案', () => {
  it('按提醒自己的时区算"今天"和钟点，不按设备', () => {
    // 上海 10-19 00:30 的提醒，此刻是上海 10-19 00:00：设备若在 UTC 会看到 10-18 16:30，
    // 于是把它念成昨天的事。
    const label = formatDueIn('Asia/Shanghai', new Date('2026-10-18T16:30:00.000Z'), new Date('2026-10-18T16:00:00.000Z'))
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

/**
 * 列表里的"待办"和"已过期"两栏都可能画同一条一次性提醒，而卡片只有一行时间。
 * 已经过了点的提醒若还念成"今天 08:00"，家长扫一眼会当成还没到 ——
 * 夜里哄睡的人最怕的就是这种"看起来还在未来"的过期。
 */
describe('已经过了点的时刻要说出来', () => {
  it('今天但已经过了钟点：写清"已过"', () => {
    const label = formatDueIn('Asia/Shanghai', new Date('2026-10-18T00:00:00.000Z'), new Date('2026-10-18T13:00:00.000Z'))
    expect(label).toBe('今天 08:00（已过）')
  })

  it('还没到的今天照旧只写钟点', () => {
    const label = formatDueIn('Asia/Shanghai', new Date('2026-10-18T14:00:00.000Z'), new Date('2026-10-18T13:00:00.000Z'))
    expect(label).toBe('今天 22:00')
  })

  it('昨天用"昨天"，不写成月日让人多算一天', () => {
    const label = formatDueIn('Asia/Shanghai', new Date('2026-10-17T00:00:00.000Z'), new Date('2026-10-18T13:00:00.000Z'))
    expect(label).toBe('昨天 08:00')
  })

  it('夏令时切换那天有 25 个小时，"今天/明天/昨天"按墙上日期算而不是加 24 小时', () => {
    // 洛杉矶 2026-11-01 凌晨回拨一小时：本地 00:30 起算的"明天"是 11-02，
    // 而"此刻 + 24 小时"那个瞬间还落在 11-01 的夜里。
    const now = new Date('2026-11-01T07:30:00.000Z') // 当地 11-01 00:30
    const tomorrow = new Date('2026-11-02T16:00:00.000Z') // 当地 11-02 08:00
    expect(formatDueIn('America/Los_Angeles', tomorrow, now)).toBe('明天 08:00')
    const yesterday = new Date('2026-10-31T15:00:00.000Z') // 当地 10-31 08:00
    expect(formatDueIn('America/Los_Angeles', yesterday, now)).toBe('昨天 08:00')
  })
})

