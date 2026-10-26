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

const eventDraft = draft({
  intent: 'event',
  event: { type: 'feeding', occurredAtWallClock: '2026-10-26T09:30', payload: { method: 'bottle' } },
})

const onceDraft = draft({
  intent: 'reminder',
  reminder: {
    title: '吃维D',
    type: 'ONE_TIME',
    dueAtWallClock: '2026-10-27T08:00',
    rrule: null,
    eventType: 'medicine',
    actionPayload: { name: '维D', dose: '400IU' },
  },
})

const everyDayDraft = draft({
  intent: 'reminder',
  reminder: {
    title: '吃维D',
    type: 'RECURRING',
    dueAtWallClock: null,
    rrule: 'FREQ=DAILY;BYHOUR=08;BYMINUTE=00',
    eventType: null,
    actionPayload: {},
  },
})

describe('assistantTarget', () => {
  it('事件草稿进记一笔，提醒草稿进新建提醒，草稿原样交出去', () => {
    expect(assistantTarget(eventDraft)).toEqual({ kind: 'form', url: '/pages/event-form/index', draft: eventDraft })
    expect(assistantTarget(onceDraft)).toEqual({ kind: 'form', url: '/pages/reminder-form/index', draft: onceDraft })
    expect(assistantTarget(everyDayDraft)).toEqual({
      kind: 'form',
      url: '/pages/reminder-form/index',
      draft: everyDayDraft,
    })
  })

  /**
   * App 端 navigateTo 会把 query 的每个值再 encodeURIComponent 一遍，onLoad 只解一次，
   * 于是中文标题在手机上变成 %E5%AE%9D…（2026-10-26 真机看到的就是这个）。
   * url 上不带值 = 这条链路上没有任何编码环节，草稿走本地一次性交接。
   */
  it('url 上不许出现任何参数：草稿一律不走 url', () => {
    for (const t of [eventDraft, onceDraft, everyDayDraft].map((d) => assistantTarget(d))) {
      if (t.kind !== 'form') return expect(t.kind).toBe('form')
      expect(t.url).not.toContain('?')
    }
  })

  it('钟点为 null 也照样进表单（让人补，不替人编一个）', () => {
    const d = draft({ intent: 'event', event: { type: 'sleep', occurredAtWallClock: null, payload: {} } })
    expect(assistantTarget(d)).toEqual({ kind: 'form', url: '/pages/event-form/index', draft: d })
  })

  it('unknown 意图不换页面', () => {
    expect(assistantTarget(draft({}))).toEqual({ kind: 'unknown' })
    // 意图说 event 却没带负载（服务端已挡住，这里只是不让它长出半个跳转）
    expect(assistantTarget(draft({ intent: 'event' }))).toEqual({ kind: 'unknown' })
    expect(assistantTarget(draft({ intent: 'reminder' }))).toEqual({ kind: 'unknown' })
  })

  /**
   * 2026-10-26 线上实测：那句「今天心情不好」带着 intentHint=reminder 重发，模型照旧回 unknown
   * （两次都是）。人在面板里点过"设提醒"，界面却把那两颗 chip 再摆一遍——点一下没有任何反应，
   * 这比"没听懂"更伤。确认过的意图是**人**给的，比模型的判断权威：这一趟至少把人带去那张表单。
   * 但只带人、不带草稿：手里没有内容，就别在表单顶部说一句"助手按你说的话填好了"。
   */
  it('人已确认过意图：模型还是听不懂也带去那张表单，只是不带草稿', () => {
    expect(assistantTarget(draft({}), 'reminder')).toEqual({
      kind: 'form',
      url: '/pages/reminder-form/index',
      draft: null,
    })
    expect(assistantTarget(draft({}), 'event')).toEqual({
      kind: 'form',
      url: '/pages/event-form/index',
      draft: null,
    })
  })

  it('模型自己就听懂了时，hint 不改写它给出的那一页', () => {
    // 面板只在 unknown 时才摆那两个 chip，所以这一路是给"以后接的入口"留的下限：
    // 一份已经填好的草稿不该因为一次点错就被丢掉。
    expect(assistantTarget(onceDraft, 'event')).toEqual({
      kind: 'form',
      url: '/pages/reminder-form/index',
      draft: onceDraft,
    })
  })

  it('没确认过意图就还是留在原地问（不许凭空把人带去一张空表单）', () => {
    expect(assistantTarget(draft({ intent: 'event' }), undefined).kind).toBe('unknown')
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
