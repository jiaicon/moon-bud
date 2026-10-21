/**
 * rrule 片段由 UI 拼装，后端只负责解析（packages/shared 的 rrule 库）。
 * 两处约定：时分一律补零两位（RFC 5545 的 BYHOUR/BYMINUTE 是两位数字），
 * 以及 BYDAY 用两位缩写、weekday 入参 0 起于周一。
 */
const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

export type RruleKind = 'daily' | 'everyNDays' | 'weekly' | 'monthly'

export interface BuildRruleFromUiInput {
  kind: RruleKind
  /** 当地墙上时间的 0–23；提醒的"早上 8 点"永远是家长所在时区的 8 点。 */
  hour: number
  minute: number
  n?: number
  /** 0=周一 … 6=周日 */
  weekday?: number
}

const pad = (n: number) => String(n).padStart(2, '0')

function timePart(hour: number, minute: number): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('小时需在 0–23 之间')
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error('分钟需在 0–59 之间')
  return `BYHOUR=${pad(hour)};BYMINUTE=${pad(minute)}`
}

export function buildRruleFromUi(input: BuildRruleFromUiInput): string {
  const time = timePart(input.hour, input.minute)
  switch (input.kind) {
    case 'daily':
      return `FREQ=DAILY;${time}`
    case 'everyNDays': {
      const n = Math.max(1, Math.floor(input.n ?? 1))
      return `FREQ=DAILY;INTERVAL=${n};${time}`
    }
    case 'weekly': {
      const weekday = input.weekday ?? 0
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        throw new Error('星期取值需在 0–6 之间')
      }
      return `FREQ=WEEKLY;BYDAY=${WEEKDAY_CODES[weekday]};${time}`
    }
    case 'monthly':
      return `FREQ=MONTHLY;BYMONTHDAY=1;${time}`
  }
}

export interface RrulePreset {
  key: string
  label: string
  rrule: string
  /** 给用户看的"下次大约什么时候"，必须带时区，否则"每天 08:00"在跨时区家庭里是歧义。 */
  preview: (timezone: string) => string
}
export const RRULE_PRESETS: RrulePreset[] = [
  {
    key: 'daily',
    label: '每天',
    rrule: buildRruleFromUi({ kind: 'daily', hour: 8, minute: 0 }),
    preview: (tz) => `每天 08:00（${tz}）`,
  },
  {
    key: 'every2days',
    label: '每两天',
    rrule: buildRruleFromUi({ kind: 'everyNDays', hour: 8, minute: 0, n: 2 }),
    preview: (tz) => `每隔 2 天 08:00（${tz}）`,
  },
  {
    key: 'weekly',
    label: '每周一',
    rrule: buildRruleFromUi({ kind: 'weekly', hour: 8, minute: 0, weekday: 0 }),
    preview: (tz) => `每周一 08:00（${tz}）`,
  },
  {
    key: 'monthly',
    label: '每月 1 日',
    rrule: buildRruleFromUi({ kind: 'monthly', hour: 8, minute: 0 }),
    preview: (tz) => `每月 1 日 08:00（${tz}）`,
  },
  {
    key: 'custom',
    label: '自定义',
    rrule: '',
    preview: (tz) => `按你选的时间和频率重复（${tz}）`,
  },
]

export interface ParsedRrule {
  /** 回填到预设选择器：预设对不上时是 'custom'。 */
  key: string
  kind: RruleKind
  hour: number
  minute: number
  n?: number
  weekday?: number
}

function field(rrule: string, name: string): string | null {
  const m = new RegExp(`(?:^|;)${name}=(\\d+)`).exec(rrule)
  return m ? m[1] : null
}

/**
 * 编辑已有提醒时必须把 rrule 拆回表单字段：否则表单里的"几点"仍是打开页面的当前时间，
 * 用户只改了标题按下保存，提醒的时间就被静默挪到了"此刻"。
 * 认不出来的频率返回 null，让调用方保持"不覆盖"而不是猜一个。
 */
export function parseRruleForUi(rrule: string | null): ParsedRrule | null {
  if (!rrule) return null
  const freq = /(?:^|;)FREQ=([A-Z]+)/.exec(rrule)?.[1]
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return null

  const hour = Number(field(rrule, 'BYHOUR') ?? 0)
  const minute = Number(field(rrule, 'BYMINUTE') ?? 0)
  const base = { hour, minute }

  if (freq === 'MONTHLY') return { key: 'monthly', kind: 'monthly', ...base }

  if (freq === 'WEEKLY') {
    const code = /(?:^|;)BYDAY=([A-Z]{2})/.exec(rrule)?.[1]
    const weekday = code ? WEEKDAY_CODES.indexOf(code as (typeof WEEKDAY_CODES)[number]) : -1
    if (weekday < 0) return null
    return { key: 'weekly', kind: 'weekly', weekday, ...base }
  }

  const interval = field(rrule, 'INTERVAL')
  if (!interval) return { key: 'daily', kind: 'daily', ...base }
  const n = Number(interval)
  if (!Number.isInteger(n) || n < 1) return null
  return { key: n === 2 ? 'every2days' : 'custom', kind: 'everyNDays', n, ...base }
}
