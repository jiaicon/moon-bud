import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AssistantParseDto } from '@moonbud/shared'
import { assistantTarget, type AssistantTarget } from '../draft-target'

const CTX = { familyId: 'f1', childId: 'c1' }

const draft = (over: Partial<AssistantParseDto>): AssistantParseDto => ({
  intent: 'unknown',
  event: null,
  reminder: null,
  dropped: [],
  ...over,
})

/** 把 url 拆成可断言的形状：参数值应当是解码后的原值，串本身必须是编码过的。 */
function params(url: string): URLSearchParams {
  return new URL(url, 'https://app.local').searchParams
}

describe('assistantTarget', () => {
  it('事件草稿进记一笔：类型、钟点、负载都带上，且都 encode 过', () => {
    const t = assistantTarget(
      draft({
        intent: 'event',
        event: {
          type: 'feeding',
          occurredAtWallClock: '2026-10-26T09:30',
          payload: { method: 'bottle', amountMl: 120 },
        },
      }),
      CTX,
    )
    expect(t.kind).toBe('form')
    if (t.kind !== 'form') return
    const p = params(t.url)
    expect(t.url).toContain('/pages/event-form/index?type=feeding')
    expect(p.get('familyId')).toBe('f1')
    expect(p.get('childId')).toBe('c1')
    expect(p.get('date')).toBe('2026-10-26')
    expect(p.get('time')).toBe('09:30')
    // 冒号不编码的话，二次解析 query 的口子会把它当成协议分隔符吃掉后半截。
    expect(t.url).toContain('time=09%3A30')
    expect(JSON.parse(String(p.get('payload')))).toEqual({ method: 'bottle', amountMl: 120 })
  })

  it('提醒草稿进新建提醒：标题、时刻、周期规则、动作类型与预填', () => {
    const t = assistantTarget(
      draft({
        intent: 'reminder',
        reminder: {
          title: '吃维D',
          type: 'RECURRING',
          dueAtWallClock: null,
          rrule: 'FREQ=DAILY;BYHOUR=08;BYMINUTE=0',
          eventType: 'medicine',
          actionPayload: { name: '维D', dose: '400IU' },
        },
      }),
      CTX,
    )
    expect(t.kind).toBe('form')
    if (t.kind !== 'form') return
    const p = params(t.url)
    expect(t.url).toContain('/pages/reminder-form/index')
    expect(p.get('title')).toBe('吃维D')
    expect(p.get('rrule')).toBe('FREQ=DAILY;BYHOUR=08;BYMINUTE=0')
    // 周期草稿合法地没有 dueAtWallClock，所以 url 里根本没有 date/time：
    // 表单上那个"几点"只能从 rrule 读回来。H5 那一趟是我手工拼的深链、自带 time=，
    // 正好把这条真实的链路蒙过去了 —— 断言它不存在，才轮到表单来证明它会读。
    expect(p.get('date')).toBeNull()
    expect(p.get('time')).toBeNull()
    expect(p.get('eventType')).toBe('medicine')
    expect(JSON.parse(String(p.get('actionPayload')))).toEqual({ name: '维D', dose: '400IU' })
  })

  it('一次性提醒带的是 date/time，不是 rrule', () => {
    const t = assistantTarget(
      draft({
        intent: 'reminder',
        reminder: {
          title: '打疫苗',
          type: 'ONE_TIME',
          dueAtWallClock: '2026-11-02T09:00',
          rrule: null,
          eventType: null,
          actionPayload: {},
        },
      }),
      CTX,
    )
    if (t.kind !== 'form') return expect(t.kind).toBe('form')
    const p = params(t.url)
    expect(p.get('date')).toBe('2026-11-02')
    expect(p.get('time')).toBe('09:00')
    expect(p.get('rrule')).toBeNull()
    // 没带动作就不发这两个键：空的事件类型会让表单说"到点顺手记"却什么也不带。
    expect(p.get('eventType')).toBeNull()
    expect(p.get('actionPayload')).toBeNull()
  })

  it('钟点为 null 就只带类型不带 date/time：让人补，不替人编一个', () => {
    const t = assistantTarget(
      draft({
        intent: 'event',
        event: { type: 'sleep', occurredAtWallClock: null, payload: {} },
      }),
      CTX,
    )
    if (t.kind !== 'form') return expect(t.kind).toBe('form')
    expect(t.url).not.toContain('date=')
    expect(t.url).not.toContain('time=')
    // 空负载不进 url：表单本来就按空开始填，多一个空 JSON 只是多一个能出错的地方。
    expect(t.url).not.toContain('payload=')
  })

  it('没有孩子时不硬塞 childId 参数（表单会自己说"未选择孩子"）', () => {
    const none = assistantTarget(
      draft({
        intent: 'event',
        event: { type: 'diaper', occurredAtWallClock: null, payload: { kind: 'pee' } },
      }),
      { familyId: 'f1', childId: null },
    )
    const some = assistantTarget(
      draft({
        intent: 'event',
        event: { type: 'diaper', occurredAtWallClock: null, payload: { kind: 'pee' } },
      }),
      CTX,
    )
    if (none.kind !== 'form' || some.kind !== 'form') return expect(none.kind).toBe('form')
    expect(none.url).not.toContain('childId=')
    expect(params(some.url).get('childId')).toBe('c1')
  })

  it('提醒那一路也要带上孩子：服务端对"带动作、没归属"直接 400', () => {
    const reminder = draft({
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
    const some = assistantTarget(reminder, CTX)
    const none = assistantTarget(reminder, { familyId: 'f1', childId: null })
    if (some.kind !== 'form' || none.kind !== 'form') return expect(some.kind).toBe('form')
    // 少了这一个参数，表单看着什么都填好了，按下保存才被服务端挡回来。
    expect(params(some.url).get('childId')).toBe('c1')
    expect(none.url).not.toContain('childId=')
  })

  it('unknown 意图不换页面', () => {
    expect(assistantTarget(draft({}), CTX)).toEqual({ kind: 'unknown' })
    // 意图说 event 却没带负载（服务端已挡住，这里只是不让它长出一个 undefined 的 url）
    expect(assistantTarget(draft({ intent: 'event' }), CTX)).toEqual({ kind: 'unknown' })
    expect(assistantTarget(draft({ intent: 'reminder' }), CTX)).toEqual({ kind: 'unknown' })
  })

  it('标题里的 & 与中文都被编码，不会截断 query', () => {
    const t = assistantTarget(
      draft({
        intent: 'reminder',
        reminder: {
          title: '吃 A & B，上午',
          type: 'ONE_TIME',
          dueAtWallClock: null,
          rrule: null,
          eventType: null,
          actionPayload: {},
        },
      }),
      CTX,
    )
    if (t.kind !== 'form') return expect(t.kind).toBe('form')
    expect(t.url).toContain('%26')
    expect(params(t.url).get('title')).toBe('吃 A & B，上午')
  })

  it('429 有一句话，不再露出英文那类串', () => {
    const source = readFileSync(new URL('../../api/errors.ts', import.meta.url), 'utf8')
    expect(source).toContain("429: '说得有点快了")
  })

  /**
   * 跳转参数是两边唯一的接头：draft-target 写、表单的 onLoad 读。哪一边单独改了，症状都是
   * "说了句话却跳到一个空表单"——而这正是这个功能最不该有的样子。
   * 排除掉编辑路径自己用的 id（draft-target 只造新建那一条链）。
   */
  it('url 上的键与表单 onLoad 读的键，两边必须一一对上', () => {
    const reads = (path: string, ignore: string[]): Set<string> => {
      const src = readFileSync(new URL(path, import.meta.url), 'utf8')
      const found = [...src.matchAll(/query\?\.([A-Za-z]+)/g)].map((m) => m[1])
      return new Set(found.filter((k) => !ignore.includes(k)))
    }
    const keys = (target: AssistantTarget): Set<string> => {
      expect(target.kind).toBe('form')
      if (target.kind !== 'form') return new Set()
      return new Set(params(target.url).keys())
    }
    const event = keys(
      assistantTarget(
        draft({
          intent: 'event',
          event: { type: 'feeding', occurredAtWallClock: '2026-10-26T09:30', payload: { method: 'bottle' } },
        }),
        CTX,
      ),
    )
    // 提醒有两种形状：一次性带 date/time，周期带 rrule——两种合起来才是表单读的那一套。
    const once = keys(
      assistantTarget(
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
        CTX,
      ),
    )
    const everyDay = keys(
      assistantTarget(
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
        CTX,
      ),
    )
    expect(event).toEqual(reads('../../pages/event-form/index.vue', ['id', 'reminderId']))
    expect(new Set([...once, ...everyDay])).toEqual(reads('../../pages/reminder-form/index.vue', ['id']))
  })
})
