import { Injectable } from '@nestjs/common'
import { normalizeUsername } from '@moonbud/shared'
import { PrismaService } from '../prisma/prisma.service'
import { hashPassword } from './password.util'

/** 恒定文案：它必须同时适用于"账号存在"与"账号不存在"。 */
export const RESET_REQUEST_MESSAGE = '如果该账号存在，我们已记录你的请求，请联系家庭管理员重置密码'

/**
 * 忘记密码的自助入口。v1 **不自动处理**：没有邮箱短信就没有凭据外的身份证明，
 * 唯一通路是同家庭的 ADMIN/OWNER 当面发一次性临时密码（spec 第 5 节）。
 *
 * 这里唯一要防的是"账号枚举"：不同账号必须得到完全一样的响应，
 * 连响应时间也不能有差别——所以账号不存在时也照样跑一次哈希。
 */
@Injectable()
export class ResetRequestService {
  constructor(private readonly prisma: PrismaService) {}

  async request(rawUsername: string): Promise<{ message: string }> {
    const username = normalizeUsername(rawUsername)
    const user = await this.prisma.user.findUnique({ where: { username } })

    // 等价工作量的占位哈希：无论账号是否存在都付同样的 CPU 时间。
    const tokenHash = await hashPassword(`reset-request:${username}`)

    if (user) {
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          // 请求由用户自己发起，没有操作者；指向本人表示"自助登记"。
          issuedBy: user.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      })
    }

    return { message: RESET_REQUEST_MESSAGE }
  }
}
