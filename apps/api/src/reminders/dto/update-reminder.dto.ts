import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'
import { IsIanaTimezone } from '../../common/validators/is-iana-timezone'

/**
 * 刻意**不含 `type`**：一次性提醒改成重复提醒等于换了一个东西，
 * 让它可以原地变形会让"这条提醒的实例都是哪条规则产生的"变得无法回答。
 * 需要换类型就删掉重建。
 */
export class UpdateReminderDto {
  @IsOptional()
  @IsUUID()
  childId?: string | null

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  title?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null

  @IsOptional()
  @IsISO8601()
  dueAt?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  rrule?: string

  @IsOptional()
  @IsIanaTimezone()
  timezone?: string

  @IsOptional()
  @IsUUID()
  assigneeId?: string | null
}
