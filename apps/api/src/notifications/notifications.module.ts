import { Module } from '@nestjs/common'
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  // Task 11 的调度器要用 createForOccurrence 生成通知。
  exports: [NotificationsService],
})
export class NotificationsModule {}
