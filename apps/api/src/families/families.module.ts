import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { FamiliesController } from './families.controller'
import { FamiliesService } from './families.service'
import { FamilyMemberGuard } from './family-member.guard'
import { MembersController } from './members.controller'
import { MembersService } from './members.service'

@Module({
  // AuthModule 只为 TokenService：重置成员密码后必须撤销该成员现存的会话。
  imports: [AuthModule],
  controllers: [FamiliesController, MembersController],
  providers: [FamiliesService, MembersService, FamilyMemberGuard],
  exports: [FamilyMemberGuard, FamiliesService],
})
export class FamiliesModule {}
