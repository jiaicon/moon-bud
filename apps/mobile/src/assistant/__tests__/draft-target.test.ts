import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AssistantParseDto } from '@moonbud/shared'
import { assistantTarget } from '../draft-target'

const draft = (over: Partial<AssistantParseDto>): AssistantParseDto => ({
  intent: 'unknown',
  event: null,
  reminder: null,
  dropped: [],
  ...over,
})

const event = assistantTarget(
  draft({
    intent: 'event',
    event: { type: 'feeding', occurredAtWallClock: '2026-10-26T09:30', payload: { method: 'bottle' } },
  }),
)

const once = assistantTarget(
  draft({
    intent: 'reminder',
    reminder: {
      title: '吃维D',
      type: 'ONE_TIME',
      dueAtWallClock: '2026-10-27T08:00',
      rrule: null,
      eventType: 'medicine',
      actionPayload: { name: '维D', dose: '400IU' },
    },
  }),
)

const everyDay = assistantTarget(
  draft({
    intent: 'reminder',
    reminder: {
      title: '吃维D',
      type: 'RECURRING',
      dueAtWallClock: null,
      rrule: 'FREQ=DAILY;BYHOUR=08;BYMINUTE=00',
      eventType: null,
      actionPayload: {},
    },
  }),
)

describe('assistantTarget', () => {
  it('事件草稿进记一笔，提醒草稿进新建提醒', () => {
    expect(event).toEqual({ kind: 'form', url: '/pages/event-form/index' })
    expect(once).toEqual({ kind: 'form', url: '/pages/reminder-form/index' })
    expect(everyDay).toEqual({ kind: 'form', url: '/pages/reminder-form/index' })
  })

  /**
   * App 端 navigateTo 会把 query 的每个值再 encodeURIComponent 一遍，onLoad 只解一次，
   * 于是中文标题在手机上变成 %E5%AE%9D…（2026-10-26 真机看到的就是这个）。
   * url 上不带值 = 这条链路上没有任何编码环节，草稿走本地一次性交接。
   */
  it('url 上不许出现任何参数：草稿一律不走 url', () => {
    for (const t of [event, once, everyDay]) {
      if (t.kind !== 'form') return expect(t.kind).toBe('form')
      expect(t.url).not.toContain('?')
    }
  })

  it('钟点为 null 也照样进表单（让人补，不替人编一个）', () => {
    expect(
      assistantTarget(draft({ intent: 'event', event: { type: 'sleep', occurredAtWallClock: null, payload: {} } })),
    ).toEqual({ kind: 'form', url: '/pages/event-form/index' })
  })

  it('unknown 意图不换页面', () => {
    expect(assistantTarget(draft({}))).toEqual({ kind: 'unknown' })
    // 意图说 event 却没带负载（服务端已挡住，这里只是不让它长出半个跳转）
    expect(assistantTarget(draft({ intent: 'event' }))).toEqual({ kind: 'unknown' })
    expect(assistantTarget(draft({ intent: 'reminder' }))).toEqual({ kind: 'unknown' })
  })

  it('429 有一句话，不再露出英文那类串', () => {
    const source = readFileSync(new URL('../../api/errors.ts', import.meta.url), 'utf8')
    expect(source).toContain("429: '说得有点快了")
  })

  /**
   * 交接的字段与表单的取用点两边必须对得上：哪一边单独改了，症状都是
   * "说了句话却跳到一个空表单"——而这正是这个功能最不该有的样子。
   */
  it('草稿里有的字段，表单确实读了；表单读的字段，草稿里都有', () => {
    const eventPage = readFileSync(new URL('../../pages/event-form/index.vue', import.meta.url), 'utf8')
    const reminderPage = readFileSync(new URL('../../pages/reminder-form/index.vue', import.meta.url), 'utf8')

    expect(eventPage).toContain('takeEventDraft()')
    expect(reminderPage).toContain('takeReminderDraft()')
    for (const field of ['event.type', 'event.occurredAtWallClock', 'event.payload']) {
      expect(eventPage, `记一笔没读 ${field}`).toContain(`asked.${field}`)
    }
    for (const field of ['reminder.title', 'reminder.dueAtWallClock', 'reminder.rrule', 'reminder.eventType', 'reminder.actionPayload']) {
      expect(reminderPage, `新建提醒没读 ${field}`).toContain(`asked.${field}`)
    }
    // 两边都要认孩子：带动作的提醒没归属会被服务端 400 挡回来。
    expect(eventPage).toContain('asked.childId')
    expect(reminderPage).toContain('asked.childId')
  })
})
