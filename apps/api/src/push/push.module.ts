import { Global, Logger, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { NoopPushProvider } from './noop-push.provider'
import { PUSH_PROVIDER } from './push-provider.interface'
import { UnicloudPushProvider } from './unicloud-push.provider'

const logger = new Logger('PushModule')

/** 地址和共享密钥缺任一件都发不出去，与其起一个必然失败的客户端，不如退回只写日志。 */
function hasUnicloudConfig(config: ConfigService): boolean {
  return ['UNICLOUD_PUSH_URL', 'UNICLOUD_PUSH_TOKEN'].every(
    (key) => !!config.get<string>(key)?.trim(),
  )
}

/**
 * 全局模块：通知、提醒等模块都需要推送通道，用一个令牌绑定当前实现。
 *
 * 绑定在启动日志里明说选了哪一条：接通推送之后，"为什么手机上没收到"
 * 的第一个怀疑对象就是配置没填，让人第一眼就能排除它。
 */
@Global()
@Module({
  providers: [
    {
      provide: PUSH_PROVIDER,
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService, prisma: PrismaService) => {
        if (!hasUnicloudConfig(config)) {
          logger.log(
            '推送通道：未配置云函数地址与共享密钥，只写日志（App 关闭时收不到任何通知）',
          )
          return new NoopPushProvider()
        }
        logger.log('推送通道：uniCloud 云函数（已配置）')
        // 手动 new：第三个构造参数是测试用的 fetch 接缝，Nest 反射不了它的类型。
        return new UnicloudPushProvider(prisma, config)
      },
    },
  ],
  exports: [PUSH_PROVIDER],
})
export class PushModule {}
