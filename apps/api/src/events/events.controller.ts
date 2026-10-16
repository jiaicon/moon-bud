import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { FamilyMember } from '@prisma/client'
import type { EventDto, Paginated } from '@moonbud/shared'
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator'
import { CurrentMember } from '../families/current-member.decorator'
import { FamilyMemberGuard } from '../families/family-member.guard'
import { EventsService } from './events.service'
import { CreateEventDto } from './dto/create-event.dto'
import { QueryEventsDto } from './dto/query-events.dto'
import { UpdateEventDto } from './dto/update-event.dto'

/**
 * 记录（喂养/睡眠/…）。读与写都只要求"是成员"；改与删还有一层
 * "仅创建者本人或 ADMIN/OWNER"，那一条**不能在守卫里表达**（它同时依赖
 * 角色和记录归属），所以由 service 判断，角色从请求上取，不重查一次库。
 */
@ApiTags('记录')
@Controller('families/:familyId/events')
@UseGuards(FamilyMemberGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  async list(
    @Param('familyId') familyId: string,
    @Query() query: QueryEventsDto,
  ): Promise<Paginated<EventDto>> {
    return this.events.findAll(familyId, query)
  }

  @Post()
  async create(
    @Param('familyId') familyId: string,
    @Body() dto: CreateEventDto,
    @CurrentUser() user: AuthUser,
  ): Promise<EventDto> {
    return this.events.create(familyId, user.id, dto)
  }

  @Patch(':eventId')
  async update(
    @Param('familyId') familyId: string,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser() user: AuthUser,
    @CurrentMember() member: FamilyMember,
  ): Promise<EventDto> {
    return this.events.update(familyId, eventId, user.id, member.role, dto)
  }

  @Delete(':eventId')
  @HttpCode(204)
  async remove(
    @Param('familyId') familyId: string,
    @Param('eventId') eventId: string,
    @CurrentUser() user: AuthUser,
    @CurrentMember() member: FamilyMember,
  ): Promise<void> {
    await this.events.softDelete(familyId, eventId, user.id, member.role)
  }
}
