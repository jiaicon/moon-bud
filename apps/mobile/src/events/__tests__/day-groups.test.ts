import { describe, expect, it } from 'vitest'
import { groupByDay } from '../day-groups'

const ev = (id: string, occurredAt: string) => ({ id, occurredAt })

describe('按天分组', () => {
  it('凌晨的记录按账号时区算今天，不按设备', () => {
    // 设备在 UTC，账号在 Asia/Shanghai：17:30Z 已经是上海时间次日 01:30。
    const groups = groupByDay(
      [ev('a', '2026-10-18T17:30:00.000Z'), ev('b', '2026-10-18T16:10:00.000Z')],
      'Asia/Shanghai',
      new Date('2026-10-18T18:10:00.000Z'),
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('今天')
    expect(groups[0].items.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('跨过账号时区的午夜才分两组', () => {
    const groups = groupByDay(
      [ev('newer', '2026-10-18T16:20:00.000Z'), ev('older', '2026-10-18T15:40:00.000Z')],
      'Asia/Shanghai',
      new Date('2026-10-18T21:00:00.000Z'),
    )
    expect(groups.map((g) => g.label)).toEqual(['今天', '昨天'])
    expect(groups.map((g) => g.items.map((e) => e.id))).toEqual([['newer'], ['older']])
  })

  it('更早的日子写出月日', () => {
    const groups = groupByDay([ev('a', '2026-10-01T02:00:00.000Z')], 'UTC', new Date('2026-10-18T02:00:00.000Z'))
    expect(groups[0].label).toBe('10月1日')
  })

  it('时间解析不出来时归到"未知时间"，不丢记录', () => {
    const groups = groupByDay([ev('a', 'not-a-date')], 'UTC', new Date('2026-10-18T02:00:00.000Z'))
    expect(groups[0]).toMatchObject({ key: 'unknown', label: '未知时间' })
  })

  it('时区名非法时退回设备本地日期，而不是整页空白', () => {
    const groups = groupByDay([ev('a', '2026-10-18T02:00:00.000Z')], 'Mars/Olympus', new Date('2026-10-18T03:00:00.000Z'))
    expect(groups).toHaveLength(1)
  })
})
