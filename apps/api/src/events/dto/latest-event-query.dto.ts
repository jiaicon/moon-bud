import { IsIn } from 'class-validator'
import { EVENT_TYPES, type EventType } from '@moonbud/shared'

export class LatestEventQueryDto {
  @IsIn(EVENT_TYPES as unknown as string[], { message: '未知的记录类型' })
  type!: EventType
}
