import { Module } from '@nestjs/common'
import { FamiliesModule } from '../families/families.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { OccurrencesService } from './occurrences.service'
import { ReminderSchedulerService } from './reminder-scheduler.service'
import { RemindersController } from './reminders.controller'
import { RemindersService } from './reminders.service'

@Module({
  imports: [FamiliesModule, NotificationsModule],
  controllers: [RemindersController],
  providers: [RemindersService, OccurrencesService, ReminderSchedulerService],
  // Task 11 的每分钟调度要调 OccurrencesService.materializeDue。
  exports: [RemindersService, OccurrencesService, ReminderSchedulerService],
})
export class RemindersModule {}
