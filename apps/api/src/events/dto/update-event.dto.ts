import { IsIn, IsISO8601, IsObject, IsOptional, IsString, MaxLength } from 'class-validator'
import { EVENT_TYPES, type EventType } from '@moonbud/shared'

export class UpdateEventDto {
  @IsOptional()
  @IsIn(EVENT_TYPES as unknown as string[], { message: '未知的记录类型' })
  type?: EventType

  @IsOptional()
  @IsISO8601()
  occurredAt?: string

  @IsOptional()
  @IsISO8601()
  endedAt?: string | null

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null
}
