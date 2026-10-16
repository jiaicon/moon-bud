import { IsIn, IsISO8601, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'
import { EVENT_TYPES, type EventType } from '@moonbud/shared'

/**
 * payload 的类型故意留成"任意对象"：它的形状取决于 type，只有在 service 里
 * 拿到 type 之后才能用 shared 的 zod schema 校验。
 */
export class CreateEventDto {
  @IsUUID()
  childId!: string

  @IsIn(EVENT_TYPES as unknown as string[], { message: '未知的记录类型' })
  type!: EventType

  @IsISO8601()
  occurredAt!: string

  @IsOptional()
  @IsISO8601()
  endedAt?: string

  @IsObject()
  payload!: Record<string, unknown>

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}
