import { IsString, Matches } from 'class-validator'
import { USERNAME_PATTERN } from '@moonbud/shared'

export class ResetRequestDto {
  @IsString()
  @Matches(USERNAME_PATTERN, { message: '账号需为 4–20 位字母、数字或下划线' })
  username!: string
}
