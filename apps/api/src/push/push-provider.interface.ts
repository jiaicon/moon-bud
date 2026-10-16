/**
 * 推送通道的抽象（spec 第 6 节"阶段二"）。
 *
 * v1 **不接通任何真实推送**：`NoopPushProvider` 只写日志。接 uni-push 或
 * 微信订阅消息时，新增一个实现类并替换 `push.module.ts` 里的 provider 绑定
 * 即可，业务代码（NotificationsService）一行都不用改。
 */
export interface PushProvider {
  send(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<void>
}

/** 注入令牌。用字符串而不是类，方便将来整体替换实现。 */
export const PUSH_PROVIDER = 'PUSH_PROVIDER'
