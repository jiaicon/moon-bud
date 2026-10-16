import { validateEventPayload } from '@moonbud/shared'
import { describe, expect, it } from 'vitest'
import { MOCK_CHILD, MOCK_EVENTS, MOCK_FAMILY, MOCK_REMINDERS, PREVIEW_SCREENS } from '../mock-data'

describe('预览假数据', () => {
  it('提供 4 屏预览且每屏都有说明文案', () => {
    expect(PREVIEW_SCREENS).toHaveLength(4)
    for (const s of PREVIEW_SCREENS) {
      expect(s.title.length).toBeGreaterThan(0)
      expect(s.caption.length).toBeGreaterThan(10)
    }
  })

  it('假数据自洽：记录与提醒都属于同一个家庭与孩子', () => {
    expect(MOCK_CHILD.familyId).toBe(MOCK_FAMILY.id)
    for (const e of MOCK_EVENTS) {
      expect(e.familyId).toBe(MOCK_FAMILY.id)
      expect(e.childId).toBe(MOCK_CHILD.id)
    }
    for (const r of MOCK_REMINDERS) {
      expect(r.familyId).toBe(MOCK_FAMILY.id)
      expect(r.childId === null || r.childId === MOCK_CHILD.id).toBe(true)
    }
  })

  it('记录时间都在过去（否则"20 分钟前"会显示成负数）', () => {
    for (const e of MOCK_EVENTS) {
      expect(new Date(e.occurredAt).getTime()).toBeLessThanOrEqual(Date.now())
    }
  })

  it('提醒同时包含已过期与未来两项，便于展示两种状态', () => {
    const times = MOCK_REMINDERS.map((r) => (r.dueAt ? new Date(r.dueAt).getTime() : 0))
    expect(times.some((t) => t < Date.now())).toBe(true)
    expect(times.some((t) => t > Date.now())).toBe(true)
  })

  it('每种记录的 payload 都能通过 shared 的校验（假数据不能是脏数据）', () => {
    for (const e of MOCK_EVENTS) {
      const r = validateEventPayload(e.type, e.payload)
      expect(r.ok, `${e.type} 假数据不合法: ${r.ok ? '' : r.errors.join(', ')}`).toBe(true)
    }
  })
})
