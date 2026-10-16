import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { EventType, LatestEventResponse } from '@moonbud/shared'
import { FamilyMemberGuard } from '../families/family-member.guard'
import { EventsService } from './events.service'
import { LatestEventQueryDto } from './dto/latest-event-query.dto'

/**
 * 「这个孩子这类记录最近一次是什么时候」——防重复照护提示的取数口
 * （spec 第 9 节：提示不能消耗用户额外步骤）。
 *
 * 单独一个端点而不是复用列表接口：列表要传分页、解析 `{items,total}`，
 * 还要客户端自己保证排序正确；这里把"最近一条"的语义钉在后端，
 * 客户端只判空。路由是 `children/:childId/events/latest`，与
 * `events/:eventId` 段数不同，不存在谁吞掉谁的问题。
 */
@ApiTags('记录')
@Controller('families/:familyId/children/:childId/events')
@UseGuards(FamilyMemberGuard)
export class LatestEventController {
  constructor(private readonly events: EventsService) {}

  @Get('latest')
  async latest(
    @Param('familyId', ParseUUIDPipe) familyId: string,
    @Param('childId', ParseUUIDPipe) childId: string,
    @Query() query: LatestEventQueryDto,
  ): Promise<LatestEventResponse> {
    const event = await this.events.findLatestInFamily(
      familyId,
      childId,
      query.type as EventType,
      new Date(),
    )
    // 没有记录是正常状态，用 { event: null } 表达，不是 404。
    return { event }
  }
}
