import { isSupportedTimezone, wallClockAt } from '@moonbud/shared'

/**
 * 账号时区是这一版里唯一决定"几点"的东西：记录、提醒、通知的钟点全按它念。
 * 注册时它取自设备且看不见，所以这里既给"我的"页一份可选清单，也负责把
 * 一个 IANA 名念成人能读懂的话。
 */
export interface TimezoneOption {
  zone: string
  /** 中文地名。清单外的时区没有地名，退回原名——编一个地名比不编更容易误导。 */
  name: string
}

const pad = (n: number) => String(n).padStart(2, '0')

export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { zone: 'Asia/Shanghai', name: '上海' },
  { zone: 'Asia/Urumqi', name: '乌鲁木齐' },
  { zone: 'Asia/Hong_Kong', name: '香港' },
  { zone: 'Asia/Taipei', name: '台北' },
  { zone: 'Asia/Tokyo', name: '东京' },
  { zone: 'Asia/Seoul', name: '首尔' },
  { zone: 'Asia/Singapore', name: '新加坡' },
  { zone: 'Asia/Bangkok', name: '曼谷' },
  { zone: 'Asia/Jakarta', name: '雅加达' },
  { zone: 'Asia/Manila', name: '马尼拉' },
  { zone: 'Asia/Kuala_Lumpur', name: '吉隆坡' },
  { zone: 'Asia/Kolkata', name: '加尔各答' },
  { zone: 'Asia/Kathmandu', name: '加德满都' },
  { zone: 'Asia/Dubai', name: '迪拜' },
  { zone: 'Europe/Moscow', name: '莫斯科' },
  { zone: 'Europe/London', name: '伦敦' },
  { zone: 'Europe/Paris', name: '巴黎' },
  { zone: 'Europe/Berlin', name: '柏林' },
  { zone: 'Africa/Johannesburg', name: '约翰内斯堡' },
  { zone: 'America/New_York', name: '纽约' },
  { zone: 'America/Chicago', name: '芝加哥' },
  { zone: 'America/Los_Angeles', name: '洛杉矶' },
  { zone: 'America/Toronto', name: '多伦多' },
  { zone: 'America/Mexico_City', name: '墨西哥城' },
  { zone: 'America/Sao_Paulo', name: '圣保罗' },
  { zone: 'Australia/Sydney', name: '悉尼' },
  { zone: 'Pacific/Auckland', name: '奥克兰' },
  { zone: 'Pacific/Honolulu', name: '檀香山' },
]

/**
 * 某个瞬间在目标时区相对 UTC 差多少分钟。
 *
 * 不用 timeZoneName: 'shortOffset'：那是较新的 Intl 能力，在旧安卓 webview 上会
 * 直接抛错。改成把目标时区的墙上时间当 UTC 读、再与实际时刻相减，任何有 Intl
 * 的运行时都算得出来。
 */
export function zoneOffsetMinutes(timezone: string, at: Date = new Date()): number | null {
  const wall = wallClockAt(timezone, at)
  if (!wall) return null
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)
  const minuteInstant = Math.floor(at.getTime() / 60_000) * 60_000
  let diff = Math.round((wallAsUtc - minuteInstant) / 60_000)
  // 午夜那天可能带着前一日的日期进来，把 ±24 小时折回真实区间（UTC-12 … UTC+14）。
  if (diff > 840) diff -= 1440
  else if (diff < -720) diff += 1440
  return diff
}

export function utcOffsetLabel(timezone: string, at: Date = new Date()): string {
  const minutes = zoneOffsetMinutes(timezone, at)
  if (minutes === null) return ''
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  const hours = Math.floor(abs / 60)
  const rest = abs % 60
  return rest ? `UTC${sign}${hours}:${pad(rest)}` : `UTC${sign}${hours}`
}

/** "上海（UTC+8）"。清单外的合法时区退回原名，但偏移照样给。 */
export function timezoneLabel(timezone: string, at: Date = new Date()): string {
  const name = TIMEZONE_OPTIONS.find((o) => o.zone === timezone)?.name ?? timezone
  const offset = utcOffsetLabel(timezone, at)
  return offset ? `${name}（${offset}）` : name
}

/**
 * 选择器的候选。当前值不在清单里时排在最前：否则打开选择器看到的是清单第一项，
 * 用户没动它按下确定，时区就被改成了上海——而他本来的是一个清单外的值。
 */
export function pickerOptions(currentZone: string): TimezoneOption[] {
  if (!isSupportedTimezone(currentZone) || TIMEZONE_OPTIONS.some((o) => o.zone === currentZone)) {
    return TIMEZONE_OPTIONS
  }
  return [{ zone: currentZone, name: currentZone }, ...TIMEZONE_OPTIONS]
}
