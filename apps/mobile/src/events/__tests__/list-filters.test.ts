import { describe, expect, it } from 'vitest'
import type { MemberDto } from '@moonbud/shared'
import { buildEventQuery, emptyListCopy, rangeBounds, RANGE_OPTIONS, recorderOptions } from '../list-filters'

describe('emptyListCopy：列表空下来时该说什么', () => {
  it('没筛项就是真的没有', () => {
    expect(emptyListCopy([])).toEqual({
      title: '还没有记录',
      hint: '点右下角 ＋，喂奶、换尿布、睡觉都能记一条。',
    })
  })

  it('带着筛项时空着不等于家里没有：把筛的是谁念出来', () => {
    const copy = emptyListCopy(['爷爷', '喂奶'])
    expect(copy.title).toBe('这个筛选下还没有记录')
    expect(copy.hint).toContain('爷爷、喂奶')
  })
})

describe('buildEventQuery：记录列表的查询串', () => {
  it('只带真正选了的条件', () => {
    expect(buildEventQuery({}, 1, 20)).toEqual({ page: 1, pageSize: 20 })
  })

  it('空字符串不算选过：发出去会被后端当成非法 UUID', () => {
    expect(buildEventQuery({ type: '', childId: '', createdBy: '' }, 2, 20)).toEqual({ page: 2, pageSize: 20 })
  })

  it('三个筛项可以叠在一起', () => {
    expect(buildEventQuery({ type: 'feeding', childId: 'c-1', createdBy: 'u-1' }, 1, 30)).toEqual({
      type: 'feeding',
      childId: 'c-1',
      createdBy: 'u-1',
      page: 1,
      pageSize: 30,
    })
  })

  it('不选孩子就是全家孩子的记录', () => {
    expect(buildEventQuery({ createdBy: 'u-1' }, 1, 20)).toEqual({ createdBy: 'u-1', page: 1, pageSize: 20 })
  })
})

function member(userId: string, nickname: string, displayName: string | null = null): MemberDto {
  return {
    id: `m-${userId}`,
    userId,
    role: 'MEMBER',
    displayName,
    joinedAt: '2026-10-01T00:00:00.000Z',
    nickname,
    username: nickname,
  }
}

describe('recorderOptions：按记录人筛的那一行', () => {
  it('一个人的家庭没有"按谁筛"这回事', () => {
    expect(recorderOptions([member('u-1', '妈妈')], 'u-1')).toEqual([])
  })

  it('全家只有我一人之外，也要能只看自己记的', () => {
    const options = recorderOptions([member('u-1', '妈妈'), member('u-2', '爸爸')], 'u-1')
    expect(options.map((o) => o.label)).toEqual(['全部', '我', '爸爸'])
    expect(options.map((o) => o.value)).toEqual(['', 'u-1', 'u-2'])
  })

  it('别人用的是他自己那一份名字，家人给他起的备注优先', () => {
    const options = recorderOptions(
      [member('u-1', '妈妈'), member('u-2', 'zhangsan', '爷爷')],
      'u-1',
    )
    expect(options[2]?.label).toBe('爷爷')
  })

  it('认不出自己时不硬安一个"我"：宁可念账号名', () => {
    const options = recorderOptions([member('u-1', '妈妈'), member('u-2', '爸爸')], '')
    expect(options.map((o) => o.label)).toEqual(['全部', '妈妈', '爸爸'])
  })

  it('名单还没读到也是空：一行都没有比一行"全部"更诚实', () => {
    expect(recorderOptions([], 'u-1')).toEqual([])
  })
})

// 账号时区固定 Asia/Shanghai（+8，无夏令时），便于断言到毫秒。
// now 取上海墙上 10:00，"今天"的界应正好落在本地午夜的 UTC 瞬间上。
const NOW = new Date('2026-10-20T02:00:00.000Z')

describe('rangeBounds：按账号时区把预设区间算成 from/to', () => {
  it('「全部」不加任何时间界', () => {
    expect(rangeBounds('', 'Asia/Shanghai', NOW)).toEqual({})
  })

  it('「今天」= 本地 00:00 起、到本地 23:59:59.999（后端 lte 取闭区间上界）', () => {
    expect(rangeBounds('today', 'Asia/Shanghai', NOW)).toEqual({
      from: '2026-10-19T16:00:00.000Z',
      to: '2026-10-20T15:59:59.999Z',
    })
  })

  it('「近 7 天」含今天，往前 6 天的本地午夜起', () => {
    expect(rangeBounds('7d', 'Asia/Shanghai', NOW)).toEqual({
      from: '2026-10-13T16:00:00.000Z',
      to: '2026-10-20T15:59:59.999Z',
    })
  })

  it('「近 30 天」含今天，往前 29 天的本地午夜起（跨月按日历日减，不靠 30×24 小时硬减——夏令时那天不是 24 小时）', () => {
    expect(rangeBounds('30d', 'Asia/Shanghai', NOW)).toEqual({
      from: '2026-09-20T16:00:00.000Z',
      to: '2026-10-20T15:59:59.999Z',
    })
  })

  it('按账号时区而不是设备本地：同一 UTC 瞬间在纽约时区算前一天', () => {
    // 2026-10-20T02:00Z 在纽约是 10-19 晚间 → "今天"应从纽约本地 10-19 午夜(=UTC 10-19 04:00)起
    const bounds = rangeBounds('today', 'America/New_York', NOW)
    expect(bounds.from).toBe('2026-10-19T04:00:00.000Z')
    expect(bounds.to).toBe('2026-10-20T03:59:59.999Z')
  })
})

describe('RANGE_OPTIONS + buildEventQuery 把时间界拼进查询串', () => {
  it('四项预设，第一项恒为"全部"', () => {
    expect(RANGE_OPTIONS.map((o) => o.value)).toEqual(['', 'today', '7d', '30d'])
    expect(RANGE_OPTIONS[0]?.label).toBe('全部')
  })

  it('from/to 选了才带，空串不发（否则后端 @IsISO8601 打回 400）', () => {
    expect(buildEventQuery({ from: '', to: '' }, 1, 20)).toEqual({ page: 1, pageSize: 20 })
  })

  it('时间界与其余筛项可叠在一起', () => {
    expect(
      buildEventQuery({ type: 'feeding', from: '2026-10-19T16:00:00.000Z', to: '2026-10-20T15:59:59.999Z' }, 1, 20),
    ).toEqual({
      type: 'feeding',
      from: '2026-10-19T16:00:00.000Z',
      to: '2026-10-20T15:59:59.999Z',
      page: 1,
      pageSize: 20,
    })
  })
})

