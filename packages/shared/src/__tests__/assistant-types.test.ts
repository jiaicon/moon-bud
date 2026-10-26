import { describe, expect, it } from 'vitest'
import { isConsistentWallClock, isFaithfulRrule, sanitizeAssistantDraft } from '../assistant-types'

/**
 * 服务端把模型的话交出去之前，只经过这里这一道闸。
 * 判据写成"一个正常用软件的人会怎么理解这次结果"：
 * 认不出来的东西要说没看懂（ok:false），认得出来但有一栏填不进去的要照旧给草稿，
 * 但必须把丢掉的东西说出来（dropped），不能让人以为都填上了。
 */
describe('sanitizeAssistantDraft', () => {
  it('合法的事件草稿原样通过，墙钟不动它', () => {
    const r = sanitizeAssistantDraft(
      {
        intent: 'event',
        event: {
          type: 'feeding',
          occurredAtWallClock: '2026-10-26T09:30',
          payload: { method: 'bottle', amountMl: 120 },
        },
      },
      'Asia/Shanghai',
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.intent).toBe('event')
    expect(r.data.event?.occurredAtWallClock).toBe('2026-10-26T09:30')
    expect(r.data.event?.payload).toEqual({ method: 'bottle', amountMl: 120 })
    expect(r.data.dropped).toEqual([])
  })

  it('合法的提醒草稿原样通过，周期规则与动作负载都留着', () => {
    const r = sanitizeAssistantDraft(
      {
        intent: 'reminder',
        reminder: {
          title: '吃维D',
          type: 'RECURRING',
          dueAtWallClock: null,
          rrule: 'FREQ=DAILY;BYHOUR=08;BYMINUTE=0',
          eventType: 'medicine',
          actionPayload: { name: '维D', dose: '400IU' },
        },
      },
      'Asia/Shanghai',
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.reminder?.rrule).toBe('FREQ=DAILY;BYHOUR=08;BYMINUTE=0')
    expect(r.data.reminder?.actionPayload).toEqual({ name: '维D', dose: '400IU' })
    expect(r.data.dropped).toEqual([])
  })

  it('unknown 意图不要求任何负载', () => {
    const r = sanitizeAssistantDraft({ intent: 'unknown' }, 'Asia/Shanghai')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.event).toBeNull()
    expect(r.data.reminder).toBeNull()
    expect(r.data.dropped).toEqual([])
  })

  it('信封不合契约就是坏输出：意图不认识、事件负载缺必填、多余键都算', () => {
    expect(sanitizeAssistantDraft({ intent: 'vaccine' }, 'Asia/Shanghai').ok).toBe(false)
    expect(sanitizeAssistantDraft({ intent: 'event', event: null }, 'Asia/Shanghai').ok).toBe(false)
    expect(
      sanitizeAssistantDraft({ intent: 'unknown', bogus: 1 }, 'Asia/Shanghai').ok,
    ).toBe(false)
  })

  it('模型认不出的记录类型不透传：整份判坏', () => {
    // 客户端的 isEventType 会静默把脏类型当"没带"，于是表单落在当前孩子、类型空白，
    // 而屏幕上那句"已按你说的话填好"就是谎话。挡在这里，别让它出门。
    const r = sanitizeAssistantDraft(
      {
        intent: 'event',
        event: { type: 'vaccine', occurredAtWallClock: '2026-10-26T09:30', payload: {} },
      },
      'Asia/Shanghai',
    )
    expect(r.ok).toBe(false)
  })

  it('墙钟格式不对或那天/那刻不存在就判坏', () => {
    const base = { type: 'feeding', payload: { method: 'bottle' } }
    for (const bad of ['2026-10-26', '2026-10-26T25:99', '2026-02-30T08:00', '26-10-26T08:00']) {
      expect(
        sanitizeAssistantDraft(
          { intent: 'event', event: { ...base, occurredAtWallClock: bad } },
          'Asia/Shanghai',
        ).ok,
      ).toBe(false)
    }
  })

  it('钟点为 null 不算坏：留空让人补，不替人编一个时刻', () => {
    const r = sanitizeAssistantDraft(
      {
        intent: 'event',
        event: { type: 'feeding', occurredAtWallClock: null, payload: { method: 'bottle' } },
      },
      'Asia/Shanghai',
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.event?.occurredAtWallClock).toBeNull()
  })

  it('payload 整份不合格就整份清空、类型留着，并在 dropped 里说实话', () => {
    // 只带药名不带剂量：这不是"填好了一半的草稿"，而是一张会让人以为记全了的表单。
    const r = sanitizeAssistantDraft(
      {
        intent: 'event',
        event: { type: 'medicine', occurredAtWallClock: null, payload: { name: '维D' } },
      },
      'Asia/Shanghai',
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.event?.type).toBe('medicine')
    expect(r.data.event?.payload).toEqual({})
    expect(r.data.dropped).toContain('event.payload')
  })

  it('提醒那一格的预填同理：清空但留住类型，并写明丢的是哪一份', () => {
    const r = sanitizeAssistantDraft(
      {
        intent: 'reminder',
        reminder: {
          title: '吃维D',
          type: 'ONE_TIME',
          dueAtWallClock: '2026-10-26T20:00',
          rrule: null,
          eventType: 'medicine',
          actionPayload: { name: '维D' },
        },
      },
      'Asia/Shanghai',
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.reminder?.eventType).toBe('medicine')
    expect(r.data.reminder?.actionPayload).toEqual({})
    expect(r.data.dropped).toContain('reminder.actionPayload')
  })

  it('全角数字与数字串先归一化再校验（"３７。５" 是 37.5，不是坏数据）', () => {
    const r = sanitizeAssistantDraft(
      {
        intent: 'event',
        event: { type: 'temperature', occurredAtWallClock: null, payload: { celsius: '３７。５' } },
      },
      'Asia/Shanghai',
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.event?.payload).toEqual({ celsius: 37.5 })
    expect(r.data.dropped).toEqual([])
  })

  it('越界的体温不被当成合法预填（98.6 是华氏度，不能当 98.6 ℃ 存下去）', () => {
    const r = sanitizeAssistantDraft(
      {
        intent: 'event',
        event: { type: 'temperature', occurredAtWallClock: null, payload: { celsius: 98.6 } },
      },
      'Asia/Shanghai',
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.event?.payload).toEqual({})
    expect(r.data.dropped).toContain('event.payload')
  })

  it('多余键是坏输出而不是"看见了但没用上"（模型爱加解释字段）', () => {
    const r = sanitizeAssistantDraft(
      {
        intent: 'event',
        event: {
          type: 'feeding',
          occurredAtWallClock: null,
          payload: { method: 'bottle', note: '我帮你记好了' },
        },
      },
      'Asia/Shanghai',
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // payload 的 strict 校验会拒掉 note → 整份清空并说出来，而不是静默少一栏。
    expect(r.data.event?.payload).toEqual({})
    expect(r.data.dropped).toContain('event.payload')
  })

  it('标题空白与周期缺规则都判坏：这两样没法让人补', () => {
    expect(
      sanitizeAssistantDraft(
        {
          intent: 'reminder',
          reminder: {
            title: '   ',
            type: 'ONE_TIME',
            dueAtWallClock: '2026-10-26T20:00',
            rrule: null,
            eventType: null,
            actionPayload: {},
          },
        },
        'Asia/Shanghai',
      ).ok,
    ).toBe(false)
    expect(
      sanitizeAssistantDraft(
        {
          intent: 'reminder',
          reminder: {
            title: '吃维D',
            type: 'RECURRING',
            dueAtWallClock: null,
            rrule: null,
            eventType: null,
            actionPayload: {},
          },
        },
        'Asia/Shanghai',
      ).ok,
    ).toBe(false)
  })

  it('一次性提醒缺时刻判坏，周期提醒可以不带时刻', () => {
    const draft = (over: Record<string, unknown>) => ({
      intent: 'reminder',
      reminder: {
        title: '吃维D',
        type: 'ONE_TIME',
        dueAtWallClock: null,
        rrule: null,
        eventType: null,
        actionPayload: {},
        ...over,
      },
    })
    expect(sanitizeAssistantDraft(draft({}), 'Asia/Shanghai').ok).toBe(false)
    expect(
      sanitizeAssistantDraft(
        draft({ type: 'RECURRING', dueAtWallClock: null, rrule: 'FREQ=DAILY;BYHOUR=08;BYMINUTE=0' }),
        'Asia/Shanghai',
      ).ok,
    ).toBe(true)
  })

  it('动作类型认不出来就只清这一格，标题与时刻照旧出门', () => {
    const r = sanitizeAssistantDraft(
      {
        intent: 'reminder',
        reminder: {
          title: '打针',
          type: 'ONE_TIME',
          dueAtWallClock: '2026-11-02T09:00',
          rrule: null,
          eventType: 'vaccine',
          actionPayload: {},
        },
      },
      'Asia/Shanghai',
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.reminder?.eventType).toBeNull()
    expect(r.data.reminder?.title).toBe('打针')
    expect(r.data.dropped).toContain('reminder.eventType')
  })

  it('intent 说了 event 却把 reminder 也带上：判坏，不能悄悄扔掉另一半话', () => {
    // 客户端的 draft-target 按 intent 分支取负载，另一半年静不吭声地消失；
    // 而 dropped 是空的，屏幕上那句"已按你说的话填好"就成了谎话。
    const r = sanitizeAssistantDraft(
      {
        intent: 'event',
        event: { type: 'feeding', occurredAtWallClock: null, payload: { method: 'bottle', amountMl: 120 } },
        reminder: {
          title: '吃维D',
          type: 'RECURRING',
          dueAtWallClock: null,
          rrule: 'FREQ=DAILY;BYHOUR=08;BYMINUTE=0',
          eventType: null,
          actionPayload: {},
        },
      },
      'Asia/Shanghai',
    )
    expect(r.ok).toBe(false)
    expect(
      sanitizeAssistantDraft(
        {
          intent: 'reminder',
          event: { type: 'feeding', occurredAtWallClock: null, payload: {} },
          reminder: {
            title: '吃维D',
            type: 'RECURRING',
            dueAtWallClock: null,
            rrule: 'FREQ=DAILY;BYHOUR=08;BYMINUTE=0',
            eventType: null,
            actionPayload: {},
          },
        },
        'Asia/Shanghai',
      ).ok,
    ).toBe(false)
  })

  it('契约错误的日志串里不许出现用户原话', () => {
    // 模型把用户那句话整份塞进 intent 是最常见的跑偏，而 errors 是要进服务日志的。
    const r = sanitizeAssistantDraft({ intent: '刚刚瓶喂 120 毫升' }, 'Asia/Shanghai')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join(' | ')).not.toContain('刚刚瓶喂')
  })

  it('界面摆不出来的周期规则判坏：多日、不支持的频率、每周却不带 BYDAY', () => {
    const draft = (rrule: string) => ({
      intent: 'reminder',
      reminder: {
        title: '吃维D',
        type: 'RECURRING',
        dueAtWallClock: null,
        rrule,
        eventType: null,
        actionPayload: {},
      },
    })
    for (const bad of [
      'FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=20;BYMINUTE=30',
      'FREQ=HOURLY;BYHOUR=8',
      'FREQ=WEEKLY;BYHOUR=20',
      'FREQ=MONTHLY;BYMONTHDAY=1,15;BYHOUR=8',
      'FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1;BYHOUR=8',
      'FREQ=DAILY;BYMONTHDAY=1;BYHOUR=8',
      'FREQ=DAILY;COUNT=3;BYHOUR=8',
      'FREQ=DAILY;INTERVAL=0;BYHOUR=8',
    ]) {
      expect(sanitizeAssistantDraft(draft(bad), 'Asia/Shanghai').ok).toBe(false)
    }
    for (const good of [
      'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
      'FREQ=DAILY;INTERVAL=2;BYHOUR=7;BYMINUTE=30',
      'FREQ=WEEKLY;BYDAY=WE;BYHOUR=20;BYMINUTE=30',
      'FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=8;BYMINUTE=0',
    ]) {
      expect(sanitizeAssistantDraft(draft(good), 'Asia/Shanghai').ok).toBe(true)
    }
  })
})

describe('isFaithfulRrule', () => {
  it('只接受表单能原样摆出来、也能原样拼回去的那几种规则', () => {
    for (const good of [
      'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
      'FREQ=DAILY;INTERVAL=3;BYHOUR=8;BYMINUTE=0',
      'FREQ=WEEKLY;BYDAY=SU;BYHOUR=21;BYMINUTE=15',
      'FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0',
      // 时分不补零也读得对，界面回填的是同一个数值。
      'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
    ]) {
      expect(isFaithfulRrule(good)).toBe(true)
    }
    for (const bad of [
      '',
      'FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=8',
      'FREQ=WEEKLY;BYDAY=XX;BYHOUR=8',
      'FREQ=YEARLY;BYHOUR=8',
      'FREQ=DAILY;BYHOUR=24',
      'FREQ=DAILY;BYMINUTE=60',
      'FREQ=DAILY;BYHOUR=8;BYHOUR=9',
      'FREQ=DAILY;UNTIL=20261231T000000Z',
      'FREQ=DAILY;BYSETPOS=1;BYHOUR=8',
      'every day',
    ]) {
      expect(isFaithfulRrule(bad)).toBe(false)
    }
  })

  it('缺失的键不判坏：BYHOUR/BYMINUTE 没说就是界面按 00:00 起步，数值仍然一致', () => {
    expect(isFaithfulRrule('FREQ=DAILY')).toBe(true)
    expect(isFaithfulRrule('FREQ=WEEKLY;BYDAY=MO')).toBe(true)
  })
})

describe('isConsistentWallClock', () => {
  it('换算回来还是同一个钟点才算数（夏令时不存在的那一格不算）', () => {
    // 2026-03-08 凌晨纽约从 02:00 直接跳到 03:00：这一格在墙上根本不存在。
    expect(isConsistentWallClock('America/New_York', '2026-03-08T02:30')).toBe(false)
    expect(isConsistentWallClock('Asia/Shanghai', '2026-10-26T08:00')).toBe(true)
  })

  it('时区名不可用不判坏，交给上层按账号兜底', () => {
    expect(isConsistentWallClock('Not/AZone', '2026-10-26T08:00')).toBe(false)
  })
})
