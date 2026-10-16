import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { PASSWORD_MIN_LENGTH, USERNAME_PATTERN } from '@moonbud/shared'
import { IsIanaTimezone } from '../../common/validators/is-iana-timezone'

export class RegisterDto {
  @IsString()
  @Matches(USERNAME_PATTERN, { message: '账号需为 4–20 位字母、数字或下划线' })
  username!: string

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: `密码至少 ${PASSWORD_MIN_LENGTH} 位` })
  @MaxLength(128)
  password!: string

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  nickname!: string

  @IsIanaTimezone()
  timezone!: string

  // 仅作联系方式，不参与鉴权。两个都可省略。
  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string
}
