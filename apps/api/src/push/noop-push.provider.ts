import { Injectable, Logger } from '@nestjs/common'
import type { PushProvider } from './push-provider.interface'

/**
 * v1 的推送实现：**什么都不发**，只留一条 debug 日志。
 *
 * 这一点必须对使用者说清楚：APP 完全关闭时收不到推送，直到开通
 * uni-push 并填入凭证（spec 第 6 节阶段二）。这里不做一个"看起来成功"
 * 的假实现，因为那会让"为什么手机上没收到"变成一个查不出原因的问题。
 */
@Injectable()
export class NoopPushProvider implements PushProvider {
  private readonly logger = new Logger(NoopPushProvider.name)

  async send(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    this.logger.debug(
      `[noop-push] 未发送（v1 未接通推送通道）user=${userId} title=${title} body=${body} data=${JSON.stringify(data ?? {})}`,
    )
  }
}
