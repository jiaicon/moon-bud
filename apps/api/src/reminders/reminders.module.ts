import { Module } from '@nestjs/common'
import { FamiliesModule } from '../families/families.module'
import { OccurrencesService } from './occurrences.service'
import { RemindersController } from './reminders.controller'
import { RemindersService } from './reminders.service'

@Module({
  imports: [FamiliesModule],
  controllers: [RemindersController],
  providers: [RemindersService, OccurrencesService],
  // Task 11 的每分钟调度要调 OccurrencesService.materializeDue。
  exports: [RemindersService, OccurrencesService],
})
export class RemindersModule {}
