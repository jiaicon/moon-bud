import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { NotificationDto, Paginated } from '@moonbud/shared'
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator'
import { NotificationsService } from './notifications.service'
import { QueryNotificationsDto } from './dto/query-notifications.dto'

/**
 * 站内提醒中心。这里的每条数据都只属于当前用户，**没有家庭作用域**：
 * 通知是"发给我的"，不是"发给我们家的"，所以不需要 FamilyMemberGuard，
 * 权限完全由 userId 决定。
 */
@ApiTags('通知')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryNotificationsDto,
  ): Promise<Paginated<NotificationDto>> {
    return this.notifications.list(user.id, query)
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: AuthUser): Promise<{ updated: number }> {
    return this.notifications.readAll(user.id)
  }

  @Post(':id/read')
  @HttpCode(200)
  async markRead(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<NotificationDto> {
    return this.notifications.markRead(id, user.id)
  }
}
