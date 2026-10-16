import { Global, Module } from '@nestjs/common'
import { NoopPushProvider } from './noop-push.provider'
import { PUSH_PROVIDER } from './push-provider.interface'

/**
 * 全局模块：通知、提醒等模块都需要推送通道，用一个令牌绑定当前实现。
 * 替换真实推送时只改这里的 useClass。
 */
@Global()
@Module({
  providers: [{ provide: PUSH_PROVIDER, useClass: NoopPushProvider }],
  exports: [PUSH_PROVIDER],
})
export class PushModule {}
