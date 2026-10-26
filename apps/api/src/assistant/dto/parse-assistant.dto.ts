import { Transform } from 'class-transformer'
import { IsNotEmpty, IsString, Length } from 'class-validator'
import { ASSISTANT_TEXT_MAX_LENGTH } from '@moonbud/shared'

/**
 * `@Transform` 在这里不是便利，是判据：纯空白那句话经 `@IsNotEmpty` 时还是非空串，
 * 于是它会一路走到模型面前——花一次钱换一个"没看懂"。先 trim，让长度校验按真话说事。
 */
export class ParseAssistantDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: '请说一句话' })
  @IsNotEmpty({ message: '请说一句话' })
  @Length(1, ASSISTANT_TEXT_MAX_LENGTH, {
    message: `一句话请控制在 ${ASSISTANT_TEXT_MAX_LENGTH} 字以内`,
  })
  text: string
}
