import { Module } from '@nestjs/common'
import { FamiliesController } from './families.controller'
import { FamiliesService } from './families.service'
import { FamilyMemberGuard } from './family-member.guard'

@Module({
  controllers: [FamiliesController],
  providers: [FamiliesService, FamilyMemberGuard],
  exports: [FamilyMemberGuard, FamiliesService],
})
export class FamiliesModule {}
