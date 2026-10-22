import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { DeviceDto } from '@moonbud/shared'
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator'
import { DevicesService } from './devices.service'
import { RegisterDeviceDto, RemoveDeviceDto } from './dto/register-device.dto'

/**
 * 推送设备登记。cid 是"这台设备能被谁收到"的地址，不是秘密，但它加上服务器里的
 * 个推凭证就足以冒充设备，所以列表只回传后 6 位（见 DevicesService.toDeviceDto）。
 */
@ApiTags('设备')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post('push-client')
  @HttpCode(204)
  async register(
    @CurrentUser() user: AuthUser,
    @Body() dto: RegisterDeviceDto,
  ): Promise<void> {
    await this.devices.register(user.id, dto)
  }

  @Delete('push-client')
  @HttpCode(204)
  async unregister(
    @CurrentUser() user: AuthUser,
    @Body() dto: RemoveDeviceDto,
  ): Promise<void> {
    await this.devices.unregister(user.id, dto.clientId)
  }

  @Get('push-clients')
  list(@CurrentUser() user: AuthUser): Promise<DeviceDto[]> {
    return this.devices.list(user.id)
  }
}
