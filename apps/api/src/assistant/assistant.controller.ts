import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { AssistantParseDto } from '@moonbud/shared'
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator'
import { AssistantService } from './assistant.service'
import { ParseAssistantDto } from './dto/parse-assistant.dto'

/**
 * 一句话 → 草稿。它不创建任何东西：预填进表单、由人按下"保存"，才算记了一笔。
 * 这也是 `@HttpCode(200)` 的理由——POST 却不是 201，因为这里没有新资源诞生，
 * 而客户端只看 2xx，状态码本身不该进契约。
 */
@ApiTags('助手')
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('parse')
  @HttpCode(200)
  parse(@CurrentUser() user: AuthUser, @Body() dto: ParseAssistantDto): Promise<AssistantParseDto> {
    return this.assistant.parse(user.id, dto.text, dto.intentHint)
  }
}
