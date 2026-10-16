import { registerDecorator, type ValidationOptions } from 'class-validator'

/** 允许的"未来"上限：到明天（UTC）为止。 */
const GRACE_MS = 24 * 60 * 60 * 1000

/**
 * 校验一个 `YYYY-MM-DD` 的日期，且不能晚于今天。
 *
 * 允许到"明天（UTC）"为止是刻意的：客户端比 UTC 早的时区（如 UTC+8 的下午）
 * 当地日期已经进入第二天，严格按 UTC 比较会把"今天出生"判成未来。
 * 一天的宽容换掉的是一类没人能复现的报错。
 */
export function IsNotFutureDate(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isNotFutureDate',
      target: object.constructor,
      propertyName: String(propertyName),
      options,
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
          const parsed = new Date(`${value}T00:00:00.000Z`)
          if (Number.isNaN(parsed.getTime())) return false
          // 往返比对：'2026-13-45' 这类形状合法但日期不存在的值会被这里拦住。
          if (parsed.toISOString().slice(0, 10) !== value) return false
          const limit = new Date(Date.now() + GRACE_MS).toISOString().slice(0, 10)
          return value <= limit
        },
        defaultMessage: () => '生日需为 YYYY-MM-DD 且不能是未来的日期',
      },
    })
  }
}
