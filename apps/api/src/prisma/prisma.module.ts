import { Global, Module } from '@nestjs/common'
import { PrismaService } from './prisma.service'

/**
 * 全局模块：每个业务模块都要用数据库，逐个 import 只会制造噪声
 * 和"忘记 import 导致注入失败"的机会。
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
