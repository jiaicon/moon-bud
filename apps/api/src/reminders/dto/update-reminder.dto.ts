import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator'
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

  /**
   * `@IsOptional()` 对 null 是"跳过校验"，null 会一路走到 `new Date(null)` —— 提醒
   * 从此躺在 1970 年里，界面还是 200。改成：要么不传，要么传一个真正的 ISO 时刻。
   */
  @ValidateIf((o: UpdateReminderDto) => o.dueAt !== undefined)
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
