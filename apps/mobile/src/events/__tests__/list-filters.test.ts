import { describe, expect, it } from 'vitest'
import type { MemberDto } from '@moonbud/shared'
import { buildEventQuery, emptyListCopy, recorderOptions } from '../list-filters'

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
