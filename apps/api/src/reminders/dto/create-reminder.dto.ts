import {
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator'
import { EVENT_TYPES, type EventType, type ReminderType } from '@moonbud/shared'
import { IsIanaTimezone } from '../../common/validators/is-iana-timezone'

export class CreateReminderDto {
  /** 可空：家庭级提醒（如"交疫苗本"）不挂在某个孩子身上。 */
  @IsOptional()
  @IsUUID()
  childId?: string

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  title!: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string

  @IsIn(['ONE_TIME', 'RECURRING'])
  type!: ReminderType

  @IsOptional()
  @IsISO8601()
  dueAt?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  rrule?: string

  /** 省略时取用户自己的时区；提醒的"早 8 点"必须落在某个确定的时区里。 */
  @IsOptional()
  @IsIanaTimezone()
  timezone?: string

  /** 省略表示发给全家。 */
  @IsOptional()
  @IsUUID()
  assigneeId?: string

  /** 「到点顺手记」的记录类型，省略 = 这条提醒没有动作。 */
  @IsOptional()
  @IsIn(EVENT_TYPES as unknown as string[], { message: '未知的记录类型' })
  eventType?: EventType

  /**
   * 该动作的预填 payload。这里只认"是个对象"，结构和类型/孩子一起在写入规则里判：
   * 单看这一个字段判不出对错（同一份 payload 换个类型就不合法）。
   */
  @IsOptional()
  @IsObject()
  actionPayload?: Record<string, unknown>
}
