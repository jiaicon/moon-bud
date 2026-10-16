import { Module } from '@nestjs/common'
import { FamiliesModule } from '../families/families.module'
import { FamilyInvitesController, InvitesController } from './invites.controller'
import { InvitesService } from './invites.service'

@Module({
  // FamilyMemberGuard 是家庭作用域权限的唯一实现处，这里复用它而不是另写一份。
  imports: [FamiliesModule],
  controllers: [FamilyInvitesController, InvitesController],
  providers: [InvitesService],
})
export class InvitesModule {}
