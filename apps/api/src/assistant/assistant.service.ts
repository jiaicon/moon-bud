import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  isSupportedTimezone,
  sanitizeAssistantDraft,
  type AssistantIntentHint,
  type AssistantParseDto,
} from '@moonbud/shared'
import { PrismaService } from '../prisma/prisma.service'
import { AssistantBadOutputError, AssistantTimeoutError, AssistantUnavailableError } from './assistant-errors'
import { ASSISTANT_PROVIDER, type AssistantProvider } from './assistant-provider.interface'
import { createRateWindow, tryConsume } from './rate-limit'

/** 每人每分钟几次。默认 6：一句大约 0.0016 元，刷满一分钟也只有厘级别，但要有个数在管着它。 */
const DEFAULT_RATE_LIMIT = 6

/**
 * 账号里的时区名不可用时按上海兜底：助手必须有一个时区来解释"刚才"是几点。
 * 兜底会错开一天（对UTC-7 的家庭），但比把 `null` 当"没说时间"少填一栏更接近人想要什么。
 */
const FALLBACK_TIMEZONE = 'Asia/Shanghai'

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name)
  private readonly window = createRateWindow()
  private readonly limit: number

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    @Inject(ASSISTANT_PROVIDER) private readonly provider: AssistantProvider,
  ) {
    this.limit = AssistantService.readLimit(config)
  }

  /** 配成 0、负数或乱码都退回默认值：一个"谁都别想用"的额度比配错更难被发现。 */
  private static readLimit(config: ConfigService): number {
    const raw = Number(config.get<string>('ASSISTANT_RATE_LIMIT'))
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_RATE_LIMIT
  }

  async parse(
    userId: string,
    text: string,
    intentHint?: AssistantIntentHint,
  ): Promise<AssistantParseDto> {
    const now = new Date()
    const verdict = tryConsume(this.window, userId, now, this.limit)
    if (!verdict.allowed) {
      throw new HttpException(
        { code: 'ASSISTANT_RATE_LIMITED', message: '说得有点快了，等一分钟再试' },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    })
    const timezone =
      user?.timezone && isSupportedTimezone(user.timezone) ? user.timezone : FALLBACK_TIMEZONE

    let raw: unknown
    try {
      raw = await this.provider.parse({ userId, text, timezone, now, intentHint })
    } catch (err) {
      throw this.toHttp(err, text)
    }

    const sanitized = sanitizeAssistantDraft(raw, timezone)
    if (!sanitized.ok) {
      // errors 只进日志：它们讲的是哪一栏对不上契约，而契约是我们和模型之间的事，
      // 用户要的是一句"没看懂"和一个能手填的表单。
      this.logger.warn(`助手输出不合契约 errors=${sanitized.errors.join(' | ')}`)
      throw this.badOutput()
    }
    return sanitized.data
  }

  /**
   * 三种失败给三个码，且都不是 500：客户端按 code 说话，而"服务器内部错误"
   * 既不能告诉人该重试还是该改写，也会把没有堆栈的日志当成有。
   */
  private toHttp(err: unknown, text: string): HttpException {
    if (err instanceof AssistantUnavailableError) {
      this.logger.warn(`助手通道不可用 message=${err.message}`)
      return new HttpException(
        { code: 'ASSISTANT_UNAVAILABLE', message: '助手暂时用不了，先手动记一笔' },
        HttpStatus.SERVICE_UNAVAILABLE,
      )
    }
    if (err instanceof AssistantTimeoutError) {
      this.logger.warn(`助手上游超时 textLen=${text.length}`)
      return new HttpException(
        { code: 'ASSISTANT_TIMEOUT', message: '助手想得太久了，再说一次试试' },
        HttpStatus.BAD_GATEWAY,
      )
    }
    if (err instanceof AssistantBadOutputError) {
      this.logger.warn(`助手输出不合格 textLen=${text.length}`)
      return this.badOutput()
    }
    // 未知异常不换成 502：那是我们自己的 bug，伪装成"模型没说好话"会把排查带去错的机房。
    throw err
  }

  private badOutput(): HttpException {
    return new HttpException(
      { code: 'ASSISTANT_BAD_OUTPUT', message: '这句我没看懂，手动记一下' },
      HttpStatus.BAD_GATEWAY,
    )
  }
}
