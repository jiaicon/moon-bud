import { Injectable } from '@nestjs/common'
import type { DeviceDto } from '@moonbud/shared'
import { PrismaService } from '../prisma/prisma.service'
import type { RegisterDeviceDto } from './dto/register-device.dto'

/**
 * 设备 cid 的登记处。
 *
 * 一台物理设备的 cid 全库唯一，**归属可以随登录转移**：家人共用过一部手机时，
 * 后登录的那个人拿走它——提醒发给"现在用这台手机的人"才是对的。
 */
@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async register(userId: string, dto: RegisterDeviceDto): Promise<void> {
    await this.prisma.device.upsert({
      where: { clientId: dto.clientId },
      create: { userId, clientId: dto.clientId, platform: dto.platform },
      update: { userId, lastSeenAt: new Date() },
    })
  }

  /**
   * `userId` 条件不可省：只按 cid 删的话，A 退出登录会把 B 已经接管的设备删掉，
   * 于是 B 从此收不到任何通知，而且查不出原因。
   */
  async unregister(userId: string, clientId: string): Promise<void> {
    await this.prisma.device.deleteMany({ where: { clientId, userId } })
  }

  async list(userId: string): Promise<DeviceDto[]> {
    const devices = await this.prisma.device.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
    })
    return devices.map(toDeviceDto)
  }
}

function toDeviceDto(device: {
  id: string
  clientId: string
  platform: string
  lastSeenAt: Date
}): DeviceDto {
  return {
    id: device.id,
    maskedClientId: `…${device.clientId.slice(-6)}`,
    platform: device.platform,
    lastSeenAt: device.lastSeenAt.toISOString(),
  }
}
