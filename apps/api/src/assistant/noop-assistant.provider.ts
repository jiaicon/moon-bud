import { Injectable } from '@nestjs/common'
import { AssistantUnavailableError } from './assistant-errors'
import type { AssistantProvider } from './assistant-provider.interface'

/**
 * 没配 `DEEPSEEK_API_KEY` 时挂上来的实现：抛"通道未配置"而不是静默回一个猜测。
 * 宁可让客户端显示"这句我没看懂"，也不能让一个假草稿填进表单——那些数字是给娃用的。
 */
@Injectable()
export class NoopAssistantProvider implements AssistantProvider {
  async parse(): Promise<never> {
    throw new AssistantUnavailableError()
  }
}
