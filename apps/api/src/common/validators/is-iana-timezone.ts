import { registerDecorator, type ValidationOptions } from 'class-validator'
import { isSupportedTimezone } from '@moonbud/shared'

/**
 * 校验 IANA 时区名。用 shared 的实现，保证前后端对"合法时区"的判断一致。
 */
export function IsIanaTimezone(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isIanaTimezone',
      target: object.constructor,
      propertyName: String(propertyName),
      options,
      validator: {
        validate: (value: unknown) => isSupportedTimezone(value),
        defaultMessage: () => '时区必须是合法的 IANA 名称，例如 Asia/Shanghai',
      },
    })
  }
}
