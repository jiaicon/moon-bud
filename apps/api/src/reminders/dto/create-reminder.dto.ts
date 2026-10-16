import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator'
import type { ReminderType } from '@moonbud/shared'
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
}
