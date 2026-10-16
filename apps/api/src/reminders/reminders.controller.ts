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
import { IsOptional, IsUUID } from 'class-validator'
import type { Paginated, ReminderDto, ReminderOccurrenceDto } from '@moonbud/shared'
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator'
import { FamilyMemberGuard } from '../families/family-member.guard'
import { RemindersService } from './reminders.service'
import { CreateReminderDto } from './dto/create-reminder.dto'
import { QueryRemindersDto } from './dto/query-reminders.dto'
import { UpdateReminderDto } from './dto/update-reminder.dto'

class CompleteReminderDto {
  /** 不传就是"完成最早的那条待办实例"。 */
  @IsOptional()
  @IsUUID()
  occurrenceId?: string
}

@ApiTags('提醒')
@Controller('families/:familyId/reminders')
@UseGuards(FamilyMemberGuard)
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get()
  async list(
    @Param('familyId') familyId: string,
    @Query() query: QueryRemindersDto,
  ): Promise<Paginated<ReminderDto>> {
    return this.reminders.list(familyId, query)
  }

  @Post()
  async create(
    @Param('familyId') familyId: string,
    @Body() dto: CreateReminderDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReminderDto> {
    return this.reminders.create(familyId, user.id, dto)
  }

  @Get(':reminderId')
  async detail(
    @Param('familyId') familyId: string,
    @Param('reminderId') reminderId: string,
  ): Promise<ReminderDto> {
    return this.reminders.detail(familyId, reminderId)
  }

  @Patch(':reminderId')
  async update(
    @Param('familyId') familyId: string,
    @Param('reminderId') reminderId: string,
    @Body() dto: UpdateReminderDto,
  ): Promise<ReminderDto> {
    return this.reminders.update(familyId, reminderId, dto)
  }

  @Delete(':reminderId')
  @HttpCode(204)
  async cancel(
    @Param('familyId') familyId: string,
    @Param('reminderId') reminderId: string,
  ): Promise<void> {
    await this.reminders.cancel(familyId, reminderId)
  }

  @Post(':reminderId/complete')
  @HttpCode(200)
  async complete(
    @Param('familyId') familyId: string,
    @Param('reminderId') reminderId: string,
    @Body() dto: CompleteReminderDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReminderDto> {
    return this.reminders.complete(familyId, reminderId, dto.occurrenceId, user.id)
  }

  @Get(':reminderId/occurrences')
  async occurrences(
    @Param('familyId') familyId: string,
    @Param('reminderId') reminderId: string,
  ): Promise<ReminderOccurrenceDto[]> {
    return this.reminders.listOccurrences(familyId, reminderId)
  }
}
