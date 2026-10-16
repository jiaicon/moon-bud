import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import type { Gender } from '@moonbud/shared'
import { IsNotFutureDate } from '../../common/validators/is-not-future-date'

/** 每个字段都可选：只改名字、只改生日都是常见操作。 */
export class UpdateChildDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  name?: string

  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'UNKNOWN'])
  gender?: Gender

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '生日格式需为 YYYY-MM-DD' })
  @IsNotFutureDate()
  birthday?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string | null
}
