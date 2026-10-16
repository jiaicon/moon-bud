import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from './health/health.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // 从仓库根读同一份 .env，容器内由 compose 的 environment 覆盖。
      envFilePath: ['../../.env', '.env'],
    }),
    HealthModule,
  ],
})
export class AppModule {}
