import { Injectable, Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { AssistantBadOutputError, AssistantTimeoutError, AssistantUnavailableError } from './assistant-errors'
import type { AssistantProvider, AssistantRequest } from './assistant-provider.interface'
import { buildAssistantMessages } from './prompt'

const DEFAULT_BASE_URL = 'https://api.deepseek.com'

/** spec"成本与配额"点名的那一档；换成别的型号只动 `.env`，不动代码。 */
const DEFAULT_MODEL = 'deepseek-flash'

/** 一次解析的预算。助手是"当面问一句"的交互，等 30 秒不如早点说没看懂。 */
const REQUEST_TIMEOUT_MS = 8_000

/** 草稿撑死几百 token；不给上限的话一次跑飞就是真金白银。 */
const MAX_OUTPUT_TOKENS = 512

interface ChatCompletion {
  choices?: Array<{ message?: { content?: unknown } }>
}

/**
 * 按 `name` 而不按 `instanceof` 认错误：fetch 的超时是 DOMException，
 * 而它在某些运行时（vm/realm 边界内外）不是 `Error` 的实例——只认 instanceof
 * 会把一次正常超时归到"上游不可达"，于是日志和状态码都指向错的那一头。
 */
function errorName(err: unknown): string {
  const named = err as { name?: unknown } | null
  if (typeof named?.name === 'string') return named.name
  return String(err)
}

/**
 * DeepSeek 的 OpenAI 兼容口。密钥只在服务器 `.env` 里，日志里只写长度不写内容：
 * 那句话写着娃几点吃的奶、吃的什么药，它属于某一个家庭，不属于日志文件。
 */
@Injectable()
export class DeepseekAssistantProvider implements AssistantProvider {
  private readonly logger = new Logger(DeepseekAssistantProvider.name)
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly model: string

  constructor(
    config: ConfigService,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly timeoutMs: number = REQUEST_TIMEOUT_MS,
  ) {
    this.apiKey = (config.get<string>('DEEPSEEK_API_KEY') ?? '').trim()
    this.baseUrl = (config.get<string>('DEEPSEEK_BASE_URL') ?? DEFAULT_BASE_URL).trim().replace(/\/$/, '')
    this.model = (config.get<string>('DEEPSEEK_MODEL') ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL
  }

  async parse(req: AssistantRequest): Promise<unknown> {
    if (this.apiKey === '') throw new AssistantUnavailableError()

    const messages = buildAssistantMessages({
      text: req.text,
      timezone: req.timezone,
      now: req.now,
      intentHint: req.intentHint,
    })

    let res: Response
    try {
      res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          // 0：同一个说法每次都解析成同一份草稿。创意在填表这件事上没有价值。
          temperature: 0,
          response_format: { type: 'json_object' },
          max_tokens: MAX_OUTPUT_TOKENS,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      const name = errorName(err)
      if (name === 'AbortError' || name === 'TimeoutError') {
        this.logger.warn(`[assistant] 上游超时 textLen=${req.text.length} timeoutMs=${this.timeoutMs}`)
        throw new AssistantTimeoutError()
      }
      // 连不上、DNS 失败、证书问题：这是通道不可用，不是"没看懂"，说清楚才有人去查配置。
      this.logger.warn(`[assistant] 上游不可达 name=${name} textLen=${req.text.length}`)
      throw new AssistantUnavailableError('助手上游不可达')
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      this.logger.warn(`[assistant] 上游 ${res.status} bodyLen=${body.length} textLen=${req.text.length}`)
      throw new AssistantBadOutputError(`助手上游返回 ${res.status}`)
    }

    let completion: ChatCompletion
    try {
      completion = (await res.json()) as ChatCompletion
    } catch {
      this.logger.warn(`[assistant] 上游响应不是 JSON textLen=${req.text.length}`)
      throw new AssistantBadOutputError('助手上游响应不是 JSON')
    }

    const content = completion.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      this.logger.warn(`[assistant] 响应里没有文本内容 choices=${completion.choices?.length ?? 0}`)
      throw new AssistantBadOutputError('助手没有回内容')
    }

    try {
      // 只回长度：这段内容很可能原样复述了用户那句话。
      return JSON.parse(content) as unknown
    } catch {
      this.logger.warn(`[assistant] 模型回的不是 JSON contentLen=${content.length}`)
      throw new AssistantBadOutputError('助手返回的内容不是 JSON')
    }
  }
}
