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
    // 只记长度：正文写着谁在找回密码、哪一家人。凭证没填的现在就是生产在跑的这一条，
    // 原样打出去等于把家长的名字永久留在容器日志里。
    this.logger.debug(
      `[noop-push] 未发送（推送通道未配置）user=${userId} titleLen=${title.length}` +
        ` bodyLen=${body.length} dataKeys=[${Object.keys(data ?? {}).join(',')}]`,
    )
  }
}
