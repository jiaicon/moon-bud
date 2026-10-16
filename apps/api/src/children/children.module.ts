import { Module } from '@nestjs/common'
import { FamiliesModule } from '../families/families.module'
import { ChildrenController } from './children.controller'
import { ChildrenService } from './children.service'

@Module({
  imports: [FamiliesModule],
  controllers: [ChildrenController],
  providers: [ChildrenService],
  // EventsService 要用 children 表确认 childId 归属，但那是它自己的查询；
  // 这里导出 ChildrenService 只是给将来的模块复用，不强加依赖。
  exports: [ChildrenService],
})
export class ChildrenModule {}
