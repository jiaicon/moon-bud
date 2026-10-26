import { afterEach, describe, expect, it } from 'vitest'
import type { AssistantParseDto } from '@moonbud/shared'
import { stageDraft, takeEventDraft, takeReminderDraft } from '../draft-handoff'

const KEY = 'assistantDraft'

const eventDraft = (): AssistantParseDto => ({
  intent: 'event',
  event: { type: 'feeding', occurredAtWallClock: '2026-10-26T09:30', payload: { amountMl: 120 } },
  reminder: null,
  dropped: [],
})

const reminderDraft = (): AssistantParseDto => ({
  intent: 'reminder',
  event: null,
  reminder: {
    title: '吃维D',
    type: 'RECURRING',
    dueAtWallClock: null,
    rrule: 'FREQ=DAILY;BYHOUR=08;BYMINUTE=00',
    eventType: 'medicine',
    actionPayload: { name: '维D' },
  },
  dropped: [],
})

afterEach(() => uni.removeStorageSync(KEY))

describe('助手草稿的一次性交接', () => {
  it('存进去再取出来是原样：中文标题不经过任何编码，所以不会在手机上变成 %E5%AE%9D…', () => {
    stageDraft({ draft: reminderDraft(), childId: 'c1' })
    const taken = takeReminderDraft()
    expect(taken?.reminder.title).toBe('吃维D')
    expect(taken?.childId).toBe('c1')
  })

  it('取一次就没了：第二次打开表单不该再被半小时前那句话预填', () => {
    stageDraft({ draft: reminderDraft(), childId: 'c1' })
    expect(takeReminderDraft()).not.toBeNull()
    expect(takeReminderDraft()).toBeNull()
  })

  it('草稿是给哪一页的就只给那一页：记一笔打开时不能把提醒草稿吃掉', () => {
    stageDraft({ draft: reminderDraft(), childId: 'c1' })
    expect(takeEventDraft()).toBeNull()
    // 不消费，所以人退回首页再进新建提醒，预填还在。
    expect(takeReminderDraft()?.reminder.rrule).toBe('FREQ=DAILY;BYHOUR=08;BYMINUTE=00')
  })

  it('太旧的草稿丢掉而不是预填：跳转失败留下的那句不该在十分钟后冒出来', () => {
    const staged = Date.now() - 11 * 60 * 1000
    stageDraft({ draft: reminderDraft(), childId: 'c1' }, staged)
    expect(takeReminderDraft()).toBeNull()
    expect(uni.getStorageSync(KEY)).toBe('')
  })

  it('storage 里是乱七八糟的东西时当没带，不抛错也不预填', () => {
    uni.setStorageSync(KEY, 'not-an-object')
    expect(takeReminderDraft()).toBeNull()
    uni.setStorageSync(KEY, { stagedAt: Date.now() })
    expect(takeReminderDraft()).toBeNull()
  })

  it('事件那一路带出类型、钟点与负载，没有孩子就是 null', () => {
    stageDraft({ draft: eventDraft(), childId: null })
    const taken = takeEventDraft()
    expect(taken?.event.type).toBe('feeding')
    expect(taken?.event.occurredAtWallClock).toBe('2026-10-26T09:30')
    expect(taken?.childId).toBeNull()
  })

  it('被丢掉的字段一路带到表单：顶部那条横幅要说"没填上"，靠的就是这份名单', () => {
    stageDraft({ draft: { ...eventDraft(), dropped: ['event.payload'] }, childId: null })
    expect(takeEventDraft()?.dropped).toEqual(['event.payload'])
    stageDraft({ draft: { ...reminderDraft(), dropped: ['reminder.eventType'] }, childId: 'c1' })
    expect(takeReminderDraft()?.dropped).toEqual(['reminder.eventType'])
    stageDraft({ draft: reminderDraft(), childId: 'c1' })
    expect(takeReminderDraft()?.dropped).toEqual([])
  })
})
