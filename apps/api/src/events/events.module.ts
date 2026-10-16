import { Module } from '@nestjs/common'
import { FamiliesModule } from '../families/families.module'
import { EventsController } from './events.controller'
import { EventsService } from './events.service'

@Module({
  imports: [FamiliesModule],
  controllers: [EventsController],
  providers: [EventsService],
  // Task 12 的"最近一条"接口与 Task 11 的调度都要复用这里的查询。
  exports: [EventsService],
})
export class EventsModule {}
