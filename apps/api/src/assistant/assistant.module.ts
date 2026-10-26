import { Logger, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AssistantController } from './assistant.controller'
import { ASSISTANT_PROVIDER, type AssistantProvider } from './assistant-provider.interface'
import { AssistantService } from './assistant.service'
import { DeepseekAssistantProvider } from './deepseek-assistant.provider'
import { NoopAssistantProvider } from './noop-assistant.provider'

const logger = new Logger('AssistantModule')

/**
 * 只有一个密钥是真的能用的时候才接 DeepSeek：留空即整条通道关闭，
 * 路由照常存在，调用得到 503——比起来一个每次调用都 502 的服务好解释得多。
 *
 * 选中的通道写进启动日志，理由和推送一样："为什么助手不好使"的第一怀疑对象
 * 是配置没填，要让人第一眼就能确认或排除它。
 */
function buildProvider(config: ConfigService): AssistantProvider {
  const key = (config.get<string>('DEEPSEEK_API_KEY') ?? '').trim()
  if (key === '') {
    logger.log('助手通道：未配置 DEEPSEEK_API_KEY，一句话记录不可用')
    return new NoopAssistantProvider()
  }
  logger.log('助手通道：DeepSeek（已配置）')
  // 手动 new：后两个构造参数是测试用的 fetch/超时接缝，Nest 反射不了它们的类型。
  return new DeepseekAssistantProvider(config)
}

@Module({
  controllers: [AssistantController],
  providers: [
    AssistantService,
    { provide: ASSISTANT_PROVIDER, inject: [ConfigService], useFactory: buildProvider },
  ],
})
export class AssistantModule {}
