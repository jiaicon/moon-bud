import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator'
import type { FamilyMember } from '@prisma/client'
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator'
import { CurrentMember } from './current-member.decorator'
import { FamiliesService } from './families.service'
import { FamilyMemberGuard } from './family-member.guard'
import { RequireFamilyRole } from './roles.decorator'

class CreateFamilyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  name!: string
}

class RenameFamilyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  name!: string
}

class TransferDto {
  @IsUUID()
  toUserId!: string
}

@ApiTags('家庭')
@Controller('families')
export class FamiliesController {
  constructor(private readonly families: FamiliesService) {}

  @Post()
  async create(@Body() dto: CreateFamilyDto, @CurrentUser() user: AuthUser) {
    return this.families.create(dto.name, user.id)
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.families.listForUser(user.id)
  }

  @Get(':familyId')
  @UseGuards(FamilyMemberGuard)
  async detail(@Param('familyId') familyId: string, @CurrentMember() member: FamilyMember) {
    return this.families.detail(familyId, member.role)
  }

  @Patch(':familyId')
  @UseGuards(FamilyMemberGuard)
  @RequireFamilyRole('OWNER', 'ADMIN')
  async rename(
    @Param('familyId') familyId: string,
    @Body() dto: RenameFamilyDto,
    @CurrentMember() member: FamilyMember,
  ) {
    return this.families.rename(familyId, dto.name, member.role)
  }

  @Post(':familyId/archive')
  @UseGuards(FamilyMemberGuard)
  @RequireFamilyRole('OWNER')
  @HttpCode(200)
  async archive(@Param('familyId') familyId: string, @CurrentMember() member: FamilyMember) {
    return this.families.archive(familyId, member.role)
  }

  @Post(':familyId/transfer')
  @UseGuards(FamilyMemberGuard)
  @RequireFamilyRole('OWNER')
  @HttpCode(200)
  async transfer(
    @Param('familyId') familyId: string,
    @Body() dto: TransferDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.families.transfer(familyId, user.id, dto.toUserId)
  }

  @Post(':familyId/leave')
  @UseGuards(FamilyMemberGuard)
  @HttpCode(204)
  async leave(@Param('familyId') familyId: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.families.leave(familyId, user.id)
  }
}
