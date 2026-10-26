import { z } from 'zod'
import type { ReminderType } from './api-types'
import { EVENT_TYPES, isEventType, validateEventPayload, type EventType } from './event-types'
import { instantFromWallClock, isSupportedTimezone, wallClockAt } from './reminder-recurrence'

/**
 * 大模型"一句话记录"的契约。这个文件是助手草稿离开服务端前的**唯一判定点**：
 * api 侧只负责调用它，客户端只负责消费它的输出。判据在这里，不在任何一端，
 * 否则模型改一次输出风格就要改两处，而其中一处总会忘。
 */

/** 一次请求允许的最大字数。既挡住异常输入，也挡住有人拿它当作文器刷算力。 */
export const ASSISTANT_TEXT_MAX_LENGTH = 200

export type AssistantIntent = 'event' | 'reminder' | 'unknown'

export interface AssistantEventDraft {
  type: EventType
  /** `YYYY-MM-DDTHH:mm`，按账号时区解释。null 表示模型没说时间，留给人补。 */
  occurredAtWallClock: string | null
  payload: Record<string, unknown>
}

export interface AssistantReminderDraft {
  title: string
  type: ReminderType
  dueAtWallClock: string | null
  rrule: string | null
  /** 提醒带动作时记的是哪种记录；null 表示只提醒、不代记。 */
  eventType: EventType | null
  actionPayload: Record<string, unknown>
}

export interface AssistantParseDto {
  intent: AssistantIntent
  event: AssistantEventDraft | null
  reminder: AssistantReminderDraft | null
  /**
   * 被清空的字段路径（如 `event.payload`）。界面必须把它说出来：一句"已按你说的话填好"
   * 在有一半内容被丢弃时是谎话，而谎话在育儿记录里的代价是重复喂一次。
   */
  dropped: string[]
}

export type SanitizeResult =
  | { ok: true; data: AssistantParseDto }
  | { ok: false; errors: string[] }

/** 形如 `2026-10-26T09:30`。只到分钟：助手预填不该出现秒，多一格就多一个能对不上的地方。 */
const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const wallClock = z.string().regex(WALL_CLOCK_RE, '时间格式必须是 YYYY-MM-DDTHH:mm')

const eventDraft = z
  .object({
    type: z.enum(EVENT_TYPES),
    occurredAtWallClock: wallClock.nullable(),
    payload: z.record(z.unknown()).default({}),
  })
  .strict()

/**
 * 标题必填（trim 后非空）：一条没有名字的提醒推送到锁屏上只是一句"你有一条提醒"。
 * 时刻与周期规则则按 type 二选一，见下面的 refine。
 */
const reminderDraft = z
  .object({
    title: z.string().trim().min(1).max(50),
    type: z.enum(['ONE_TIME', 'RECURRING']),
    dueAtWallClock: wallClock.nullable(),
    rrule: z.string().max(200).nullable(),
    // 这一格用 string 而不用 z.enum：动作类型不认识时清掉这一格就能用，整份作废太可惜；
    // event.type 反过来是骨架，脏了只能判坏。两处不对称是刻意的。
    eventType: z.string().max(50).nullable(),
    actionPayload: z.record(z.unknown()).default({}),
  })
  .strict()
  .refine((r) => (r.type === 'ONE_TIME' ? r.dueAtWallClock !== null : r.rrule !== null), {
    message: '一次性提醒必须有时刻，周期提醒必须有规则',
  })

const envelope = z
  .object({
    intent: z.enum(['event', 'reminder', 'unknown']),
    event: eventDraft.nullable().default(null),
    reminder: reminderDraft.nullable().default(null),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.intent === 'event' && d.event === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['event'], message: 'intent 是 event 却没有事件' })
    }
    if (d.intent === 'reminder' && d.reminder === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reminder'], message: 'intent 是 reminder 却没有提醒' })
    }
    // 反方向也要挡：客户端按 intent 取负载，多带的那一半会静不吭声地消失，
    // 而 dropped 是空的 —— 屏幕上那句"已按你说的话填好"就成了谎话。
    if (d.intent === 'event' && d.reminder !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reminder'], message: 'intent 是 event 就不该带提醒' })
    }
    if (d.intent === 'reminder' && d.event !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['event'], message: 'intent 是 reminder 就不该带事件' })
    }
    if (d.intent === 'unknown' && (d.event !== null || d.reminder !== null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['intent'], message: 'intent 是 unknown 就不该带负载' })
    }
  })

/**
 * 只有我们自己写的中文那句能进日志：zod 的默认文案会把收到的原值念出来
 * （`received '刚刚瓶喂 120 毫升'`），而用户那句话是要留在手机里的东西。
 * 所以非 custom 的 issue 只留栏目与错误码，够排查契约对不上哪一格，不够还原用户说了什么。
 */
function issuesOf(error: z.ZodError): string[] {
  return error.issues.map(
    (i) => `${i.path.join('.') || '(root)'}: ${i.code === z.ZodIssueCode.custom ? i.message : i.code}`,
  )
}

const FULL_WIDTH = /[０-９．。－]/g
const WIDTH_MAP: Record<string, string> = {
  '０': '0',
  '１': '1',
  '２': '2',
  '３': '3',
  '４': '4',
  '５': '5',
  '６': '6',
  '７': '7',
  '８': '8',
  '９': '9',
  '．': '.',
  '。': '.',
  '－': '-',
}

/**
 * 模型在中文语境里会吐全角数字和全角句点（`３７。５`），而它就是一个合法的体温。
 * 直接按字符串校验会把这样的输出判坏，于是用户听到"没看懂"——明明看懂了。
 * 所以先归一化，再校验。空串不当数字：把 "" 变成 0 是替用户编了一个值。
 */
export function normalizeAssistantPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== 'string') {
      out[key] = value
      continue
    }
    const halfWidth = value.replace(FULL_WIDTH, (ch) => WIDTH_MAP[ch] ?? ch)
    const trimmed = halfWidth.trim()
    out[key] = trimmed !== '' && Number.isFinite(Number(trimmed)) ? Number(trimmed) : value
  }
  return out
}

/**
 * "换算回来还是同一个钟点"才算这个时刻存在。夏令时跳表会让 `02:30` 这一格在墙上不存在，
 * 按它写入得到一个和口述无关的时刻；2 月 30 日会滚成 3 月 2 日，同样不是用户说的那天。
 * 时区名不可用也返回 false：那一条草稿不该由一个错误的时区来解释。
 */
export function isConsistentWallClock(timezone: string, value: string): boolean {
  const m = isSupportedTimezone(timezone) ? WALL_CLOCK_RE.exec(value) : null
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return false
  const instant = instantFromWallClock(timezone, { year, month, day, hour, minute })
  if (!instant) return false
  const back = wallClockAt(timezone, instant)
  if (!back) return false
  return (
    back.year === year && back.month === month && back.day === day && back.hour === hour && back.minute === minute
  )
}

const RRULE_KEYS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYHOUR', 'BYMINUTE'])
const FAITHFUL_FREQS = ['DAILY', 'WEEKLY', 'MONTHLY']
const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

/**
 * 这条周期规则，表单能不能原样摆出来、再原样拼回去。
 * `parseRruleForUi` 只认第一个 BYDAY、只认那三种 FREQ，认不出来的键一律当没带；
 * 而服务端排期用的是模型给的那一份原样的 rrule。两边不一致时，屏幕显示"每周一 08:00"、
 * 实际周一和周三都响——用户看到的和会发生的是两件事，这比直接判坏更坏。
 * 这一把尺子必须和 `apps/mobile/src/reminders/rrule-presets.ts` 的 parse/build 配对，
 * 那边有测试盯着"通过这里的规则都能被解析并拼回同样的数值"。
 */
export function isFaithfulRrule(rrule: string): boolean {
  const kv: Record<string, string> = {}
  for (const part of rrule.split(';')) {
    const matched = /^([A-Z]+)=([^;]+)$/.exec(part)
    const key = matched?.[1]
    const value = matched?.[2]
    if (!key || !value) return false
    if (!RRULE_KEYS.has(key) || key in kv) return false
    kv[key] = value
  }

  const freq = kv.FREQ
  if (!freq || !FAITHFUL_FREQS.includes(freq)) return false

  if (kv.INTERVAL !== undefined && (freq !== 'DAILY' || !/^\d+$/.test(kv.INTERVAL) || Number(kv.INTERVAL) < 1)) {
    return false
  }
  if (kv.BYDAY !== undefined && (freq !== 'WEEKLY' || !WEEKDAY_CODES.includes(kv.BYDAY))) return false
  if (freq === 'WEEKLY' && kv.BYDAY === undefined) return false
  if (kv.BYMONTHDAY !== undefined && (freq !== 'MONTHLY' || kv.BYMONTHDAY !== '1')) return false
  if (kv.BYHOUR !== undefined && (!/^\d{1,2}$/.test(kv.BYHOUR) || Number(kv.BYHOUR) > 23)) return false
  if (kv.BYMINUTE !== undefined && (!/^\d{1,2}$/.test(kv.BYMINUTE) || Number(kv.BYMINUTE) > 59)) return false
  return true
}

/**
 * 校验并净化模型吐出的那份草稿。判定分三层，顺序是写死的：
 * 1. 信封（意图、键名、记录类型、必填项）——不合法就没有可信的骨架，整份判坏；
 * 2. 钟点——一个不存在的时间比没有的时间更坏，判坏；
 * 3. payload——只有这一层可以局部失败，整份清空并记进 dropped。
 *
 * payload 整份清空而不逐栏剔除：逐栏要一张字段清单，而清单迟早和 `event-types.ts`
 * 里的 schema 对不上；清空 + 明说丢了的代价是用户多填一栏，写错值的代价是数据永久脏。
 */
export function sanitizeAssistantDraft(raw: unknown, timezone: string): SanitizeResult {
  const parsed = envelope.safeParse(raw)
  if (!parsed.success) return { ok: false, errors: issuesOf(parsed.error) }
  const { intent, event, reminder } = parsed.data

  const dropped: string[] = []

  if (event?.occurredAtWallClock != null && !isConsistentWallClock(timezone, event.occurredAtWallClock)) {
    return { ok: false, errors: [`event.occurredAtWallClock: ${event.occurredAtWallClock} 不是 ${timezone} 的一个真实钟点`] }
  }
  if (reminder?.dueAtWallClock != null && !isConsistentWallClock(timezone, reminder.dueAtWallClock)) {
    return { ok: false, errors: [`reminder.dueAtWallClock: ${reminder.dueAtWallClock} 不是 ${timezone} 的一个真实钟点`] }
  }
  // 周期规则和钟点同一层：一条界面摆不出来的规则，比没有规则更坏——表单会显示一个近似的档位，
  // 而服务端按原样的 rrule 排期。清成 null 也不行，RECURRING 没有规则同样落不了地。
  if (reminder?.rrule != null && !isFaithfulRrule(reminder.rrule)) {
    return { ok: false, errors: ['reminder.rrule: 界面摆不出这条周期规则'] }
  }

  let cleanEvent: AssistantEventDraft | null = null
  if (event !== null) {
    const checked = validateEventPayload(event.type, normalizeAssistantPayload(event.payload))
    if (checked.ok) {
      cleanEvent = { ...event, payload: checked.data as Record<string, unknown> }
    } else {
      cleanEvent = { ...event, payload: {} }
      dropped.push('event.payload')
    }
  }

  let cleanReminder: AssistantReminderDraft | null = null
  if (reminder !== null) {
    const slot = reminder.eventType
    const type: EventType | null = slot !== null && isEventType(slot) ? slot : null
    if (slot !== null && type === null) {
      dropped.push('reminder.eventType')
    }
    if (type === null) {
      // 没有动作类型，动作负载就没有归属；留着它只会在表单里长出一栏没人要的预填。
      if (Object.keys(reminder.actionPayload).length > 0) dropped.push('reminder.actionPayload')
      cleanReminder = { ...reminder, eventType: null, actionPayload: {} }
    } else {
      const checked = validateEventPayload(type, normalizeAssistantPayload(reminder.actionPayload))
      if (checked.ok) {
        cleanReminder = { ...reminder, eventType: type, actionPayload: checked.data as Record<string, unknown> }
      } else {
        cleanReminder = { ...reminder, eventType: type, actionPayload: {} }
        dropped.push('reminder.actionPayload')
      }
    }
  }

  return { ok: true, data: { intent, event: cleanEvent, reminder: cleanReminder, dropped } }
}
