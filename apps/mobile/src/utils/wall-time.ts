import { instantFromWallClock, wallClockAt } from '@moonbud/shared'

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * 表单里用户按的是钟点（"明天 08:00"），后端存的是时刻，中间这一步必须由账号
 * 时区来翻译：设备在 UTC+0 而家在上海时，按设备本地换算会把上海早 8 点的喂药
 * 提醒排到下午 4 点，而列表念出来的又是账号时区的钟点——同一屏自相矛盾。
 *
 * 时区名认不出来（脏数据、或运行环境没有 Intl）时退回设备本地时间：
 * 排错几个小时的提醒比当场报错更能让人把事办完。
 */
export function isoFromWallTime(timezone: string, day: string, minute: string): string {
  const [year, month, date] = day.split('-').map(Number)
  const [hour, min] = minute.split(':').map(Number)
  const clock = {
    year: year || 1970,
    month: month || 1,
    day: date || 1,
    hour: hour || 0,
    minute: min || 0,
  }
  const instant = instantFromWallClock(timezone, clock)
  if (instant) return instant.toISOString()
  return new Date(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute).toISOString()
}

/** 某个时刻在账号时区里的年月日与钟点，用来写"10月19日 09:30"这类文案。 */
export function wallStamp(
  timezone: string,
  instant: Date,
): { year: number; month: number; day: number; clock: string } {
  const clock = wallClockAt(timezone, instant)
  if (clock) {
    return {
      year: clock.year,
      month: clock.month,
      day: clock.day,
      clock: `${pad(clock.hour)}:${pad(clock.minute)}`,
    }
  }
  return {
    year: instant.getFullYear(),
    month: instant.getMonth() + 1,
    day: instant.getDate(),
    clock: `${pad(instant.getHours())}:${pad(instant.getMinutes())}`,
  }
}

/** 某个时刻在账号时区里的日期与钟点，用来给日期选择器预填"现在"。 */
export function wallFields(timezone: string, now: Date = new Date()): { date: string; time: string } {
  const stamp = wallStamp(timezone, now)
  return { date: `${stamp.year}-${pad(stamp.month)}-${pad(stamp.day)}`, time: stamp.clock }
}
