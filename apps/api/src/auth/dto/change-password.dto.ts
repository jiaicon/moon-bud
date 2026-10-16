import { IsString, MaxLength, MinLength } from 'class-validator'
import { PASSWORD_MIN_LENGTH } from '@moonbud/shared'

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  oldPassword!: string

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: `密码至少 ${PASSWORD_MIN_LENGTH} 位` })
  @MaxLength(128)
  newPassword!: string
}
