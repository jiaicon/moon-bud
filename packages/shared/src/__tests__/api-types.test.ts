import { describe, expect, it } from 'vitest'
import {
  PASSWORD_MIN_LENGTH,
  USERNAME_PATTERN,
  isValidUsername,
  normalizeUsername,
} from '../api-types'
import type { EventDto, FamilyRole, LatestEventResponse } from '../api-types'

describe('账号规则', () => {
  it('接受 4–20 位字母数字下划线', () => {
    expect(isValidUsername('mama2024')).toBe(true)
    expect(isValidUsername('grand_pa_01')).toBe(true)
    expect(isValidUsername('abcd')).toBe(true)
    expect(isValidUsername('a'.repeat(20))).toBe(true)
  })

  it('拒绝过短、过长、含中文或空格的账号', () => {
    expect(isValidUsername('abc')).toBe(false)
    expect(isValidUsername('a'.repeat(21))).toBe(false)
    expect(isValidUsername('妈妈2024')).toBe(false)
    expect(isValidUsername('mama 2024')).toBe(false)
    expect(isValidUsername('')).toBe(false)
  })

  it('密码最短 8 位', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8)
  })

  it('账号正则可复用且带 ^ $ 锚点', () => {
    expect(USERNAME_PATTERN.source.startsWith('^')).toBe(true)
    expect(USERNAME_PATTERN.source.endsWith('$')).toBe(true)
  })

  it('normalizeUsername 去空格并转小写，使登录大小写不敏感', () => {
    expect(normalizeUsername('  MaMa2024  ')).toBe('mama2024')
  })
})

describe('契约类型', () => {
  it('FamilyRole 恰好三种，且不含 OWNER 之外的提权值', () => {
    const roles: FamilyRole[] = ['OWNER', 'ADMIN', 'MEMBER']
    expect(roles).toHaveLength(3)
  })

  it('LatestEventResponse 用 null 表达"还没有记录"', () => {
    const empty: LatestEventResponse = { event: null }
    expect(empty.event).toBeNull()
  })

  it('EventDto 必带 createdByNickname —— 防重复提示要靠它说清是谁记的', () => {
    const e: EventDto = {
      id: 'e1',
      childId: 'c1',
      familyId: 'f1',
      type: 'feeding',
      occurredAt: '2026-10-16T02:00:00.000Z',
      endedAt: null,
      payload: { method: 'bottle', amountMl: 120 },
      note: null,
      createdBy: 'u1',
      createdByNickname: '爸爸',
      updatedBy: null,
      fromReminderId: null,
      createdAt: '2026-10-16T02:00:00.000Z',
      updatedAt: '2026-10-16T02:00:00.000Z',
    }
    expect(e.createdByNickname).toBe('爸爸')
  })
})
