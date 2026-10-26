import { Transform } from 'class-transformer'
import { IsNotEmpty, IsString, IsIn, Length, ValidateIf } from 'class-validator'
import { ASSISTANT_TEXT_MAX_LENGTH, type AssistantIntentHint } from '@moonbud/shared'

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

  /**
   * 人在面板里点过"是要记一笔，还是设提醒"之后带上来的那一个。
   * 用 `@ValidateIf(v => v !== undefined)` 而不用 `@IsOptional()`：后者把 null 也当"没带"放过，
   * 而 `intentHint: null` 是客户端的一个 bug，不是一个人的选择，放过去就一路走到提示词里。
   * 只收这两个值：unknown 是"没听懂"，不是一句确认。
   */
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['event', 'reminder'], { message: '这句是要记一笔，还是设提醒？' })
  intentHint?: AssistantIntentHint
}
