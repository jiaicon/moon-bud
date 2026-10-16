import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import type { FamilyMember } from '@prisma/client'
import type { MemberDto } from '@moonbud/shared'
import { CurrentMember } from './current-member.decorator'
import { FamilyMemberGuard } from './family-member.guard'
import { MembersService } from './members.service'
import { RequireFamilyRole } from './roles.decorator'
import { UpdateMemberDto } from './dto/update-member.dto'

/**
 * 成员管理。整条路由都在家庭作用域内，所以守卫挂在控制器上：
 * 每个方法都要求 (familyId, 当前用户) 是一条真实的成员关系，
 * 读写权限再按 @RequireFamilyRole 细分。
 */
@Controller('families/:familyId/members')
@UseGuards(FamilyMemberGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  async list(@Param('familyId', ParseUUIDPipe) familyId: string): Promise<MemberDto[]> {
    return this.members.list(familyId)
  }

  @Patch(':memberId')
  @RequireFamilyRole('OWNER', 'ADMIN')
  async update(
    @Param('familyId', ParseUUIDPipe) familyId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateMemberDto,
    @CurrentMember() actor: FamilyMember,
  ): Promise<MemberDto> {
    return this.members.update(familyId, memberId, dto, actor)
  }

  @Delete(':memberId')
  @RequireFamilyRole('OWNER', 'ADMIN')
  @HttpCode(204)
  async remove(
    @Param('familyId', ParseUUIDPipe) familyId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentMember() actor: FamilyMember,
  ): Promise<void> {
    await this.members.remove(familyId, memberId, actor)
  }

  @Post(':memberId/reset-password')
  @RequireFamilyRole('OWNER', 'ADMIN')
  @HttpCode(200)
  async resetPassword(
    @Param('familyId', ParseUUIDPipe) familyId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentMember() actor: FamilyMember,
  ): Promise<{ temporaryPassword: string }> {
    return this.members.resetPassword(familyId, memberId, actor)
  }
}
