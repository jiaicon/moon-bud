import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from './auth/auth.module'
import { HealthModule } from './health/health.module'
import { PrismaModule } from './prisma/prisma.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // 从仓库根读同一份 .env，容器内由 compose 的 environment 覆盖。
      envFilePath: ['../../.env', '.env'],
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
  ],
})
export class AppModule {}
