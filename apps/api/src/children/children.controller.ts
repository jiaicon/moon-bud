import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import type { ChildDto } from '@moonbud/shared'
import { FamilyMemberGuard } from '../families/family-member.guard'
import { ChildrenService } from './children.service'
import { CreateChildDto } from './dto/create-child.dto'
import { UpdateChildDto } from './dto/update-child.dto'

/**
 * 孩子的增删改查。整个家庭共享同一批孩子，所以只要求"是成员"——
 * 把孩子限制给某个人管，与"照护是全家的事"这个前提冲突。
 */
@Controller('families/:familyId/children')
@UseGuards(FamilyMemberGuard)
export class ChildrenController {
  constructor(private readonly children: ChildrenService) {}

  @Get()
  async list(@Param('familyId') familyId: string): Promise<ChildDto[]> {
    return this.children.list(familyId)
  }

  @Post()
  async create(@Param('familyId') familyId: string, @Body() dto: CreateChildDto): Promise<ChildDto> {
    return this.children.create(familyId, dto)
  }

  @Patch(':childId')
  async update(
    @Param('familyId') familyId: string,
    @Param('childId') childId: string,
    @Body() dto: UpdateChildDto,
  ): Promise<ChildDto> {
    return this.children.update(familyId, childId, dto)
  }

  @Delete(':childId')
  @HttpCode(204)
  async archive(
    @Param('familyId') familyId: string,
    @Param('childId') childId: string,
  ): Promise<void> {
    await this.children.archive(familyId, childId)
  }
}
