import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { AuthModule } from './auth/auth.module'
import { JwtAuthGuard } from './auth/jwt-auth.guard'
import { ChildrenModule } from './children/children.module'
import { EventsModule } from './events/events.module'
import { FamiliesModule } from './families/families.module'
import { HealthModule } from './health/health.module'
import { InvitesModule } from './invites/invites.module'
import { PrismaModule } from './prisma/prisma.module'
import { RemindersModule } from './reminders/reminders.module'

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
    FamiliesModule,
    InvitesModule,
    ChildrenModule,
    EventsModule,
    RemindersModule,
  ],
  providers: [
    // 全局注册：新增路由默认受保护，忘记加守卫不会变成漏洞。
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
