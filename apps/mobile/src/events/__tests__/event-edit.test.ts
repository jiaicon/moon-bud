import { afterEach, describe, expect, it } from 'vitest'
import type { EventDto } from '@moonbud/shared'
import { canModifyEvent, eventToFormState, stageForEdit, takeForEdit } from '../event-edit'

const event = {
  id: 'e1',
  childId: 'c1',
  familyId: 'f1',
  type: 'feeding',
  occurredAt: '2026-10-19T01:30:00.000Z',
  endedAt: null,
  payload: { amountMl: 120, bottle: true },
  note: '喝完了一整瓶',
  createdBy: 'u1',
  createdByNickname: '爸爸',
} as unknown as EventDto

describe('记录的可改性', () => {
  it('创建者本人永远能改自己的记录', () => {
    expect(canModifyEvent(event, 'u1', 'MEMBER')).toBe(true)
  })

  it('管理员与创建者能改别人的记录', () => {
    expect(canModifyEvent(event, 'u2', 'ADMIN')).toBe(true)
    expect(canModifyEvent(event, 'u2', 'OWNER')).toBe(true)
  })

  it('普通成员改不了别人记的（与后端 assertCanModify 同口径）', () => {
    expect(canModifyEvent(event, 'u2', 'MEMBER')).toBe(false)
  })

  it('没登录、没角色时一律不可改', () => {
    expect(canModifyEvent(event, null, null)).toBe(false)
  })
})

describe('编辑时把记录填回表单', () => {
  afterEach(() => {
    uni.removeStorageSync('editingEvent')
  })

  it('payload 的数值转成字符串（输入框只吃字符串）', () => {
    const state = eventToFormState(event)
    expect(state.values.amountMl).toBe('120')
  })

  it(' occurredAt 拆成本地的日期与时刻，不是打开页面的现在', () => {
    const state = eventToFormState(event)
    const d = new Date(event.occurredAt)
    expect(state.date).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    expect(state.time).toBe(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
  })

  it('没有备注就是空串，不写出 "null"', () => {
    const state = eventToFormState({ ...event, note: null } as EventDto)
    expect(state.note).toBe('')
  })

  it('睡眠的 endedAt 落在结束日期与时刻上', () => {
    const sleep = {
      ...event,
      type: 'sleep',
      endedAt: '2026-10-19T03:15:00.000Z',
      payload: {},
    } as unknown as EventDto
    const state = eventToFormState(sleep)
    const end = new Date(sleep.endedAt as string)
    expect(state.endTime).toBe(`${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`)
    expect(state.endDate.length).toBe(10)
  })

  it('没有 endedAt 时结束时间是空的', () => {
    expect(eventToFormState(event).endDate).toBe('')
  })

  it('交接是一次性的：取过一次就没了', () => {
    stageForEdit(event)
    expect(takeForEdit('e1')?.id).toBe('e1')
    expect(takeForEdit('e1')).toBeNull()
  })

  it('id 对不上时不返回别人的记录', () => {
    stageForEdit(event)
    expect(takeForEdit('other')).toBeNull()
  })
})
