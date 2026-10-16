import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import type { FamilyDto, InviteDto } from '@moonbud/shared'
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator'
import { FamilyMemberGuard } from '../families/family-member.guard'
import { RequireFamilyRole } from '../families/roles.decorator'
import { InvitesService } from './invites.service'
import { CreateInviteDto } from './dto/create-invite.dto'

/** 家庭内的邀请管理：发码、看码、撤销码。靠 FamilyMemberGuard 定权限。 */
@Controller('families/:familyId/invites')
@UseGuards(FamilyMemberGuard)
export class FamilyInvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Get()
  async list(@Param('familyId') familyId: string): Promise<InviteDto[]> {
    return this.invites.list(familyId)
  }

  @Post()
  @RequireFamilyRole('OWNER', 'ADMIN')
  async create(
    @Param('familyId') familyId: string,
    @Body() dto: CreateInviteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<InviteDto> {
    return this.invites.create(familyId, dto, user.id)
  }

  @Delete(':inviteId')
  @RequireFamilyRole('OWNER', 'ADMIN')
  @HttpCode(204)
  async revoke(
    @Param('familyId') familyId: string,
    @Param('inviteId') inviteId: string,
  ): Promise<void> {
    await this.invites.revoke(familyId, inviteId)
  }
}

/**
 * 用邀请码加入家庭。**不在 /families/:familyId 下面**，因为使用者此刻
 * 还不知道自己会被加进哪个家庭——code 本身就是凭据。
 * 仍然需要登录：家庭需要一个确定的用户身份。
 */
@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post(':code/accept')
  async accept(@Param('code') code: string, @CurrentUser() user: AuthUser): Promise<FamilyDto> {
    return this.invites.accept(code, user.id)
  }
}
