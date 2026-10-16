import { IsString, MinLength } from 'class-validator'

export class RefreshDto {
  @IsString()
  @MinLength(1, { message: '缺少 refreshToken' })
  refreshToken!: string
}
