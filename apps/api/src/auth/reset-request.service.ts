import { Inject, Injectable } from '@nestjs/common'
import { normalizeUsername } from '@moonbud/shared'
import { PrismaService } from '../prisma/prisma.service'
import { PUSH_PROVIDER, type PushProvider } from '../push/push-provider.interface'
import { hashPassword } from './password.util'

/** 恒定文案：它必须同时适用于"账号存在"与"账号不存在"。 */
export const RESET_REQUEST_MESSAGE = '如果该账号存在，我们已记录你的请求，请联系家庭管理员重置密码'

/** 同一个账号在这么短的时间内重复提交，不再重复惊动管理员。 */
const NOTIFY_COOLDOWN_MS = 10 * 60 * 1000

/**
 * 忘记密码的自助入口。v1 **不自动处理**：没有邮箱短信就没有凭据外的身份证明，
 * 唯一通路是同家庭的 ADMIN/OWNER 当面发一次性临时密码（spec 第 5 节）。
 *
 * 这里唯一要防的是"账号枚举"：不同账号必须得到完全一样的响应，
 * 连响应时间也不能有差别——所以账号不存在时也照样跑一次哈希。
 */
@Injectable()
export class ResetRequestService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  async request(rawUsername: string): Promise<{ message: string }> {
    const username = normalizeUsername(rawUsername)
    const user = await this.prisma.user.findUnique({ where: { username } })

    // 等价工作量的占位哈希：无论账号是否存在都付同样的 CPU 时间。
    const tokenHash = await hashPassword(`reset-request:${username}`)

    if (user) {
      const pending = await this.prisma.passwordResetToken.findFirst({
        where: {
          userId: user.id,
          // 自助登记的请求把自己记成签发者，管理员的重置不会误命中这个条件。
          issuedBy: user.id,
          usedAt: null,
          createdAt: { gt: new Date(Date.now() - NOTIFY_COOLDOWN_MS) },
        },
        select: { id: true },
      })
      if (!pending) {
        await this.prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash,
            // 请求由用户自己发起，没有操作者；指向本人表示"自助登记"。
            issuedBy: user.id,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        })
        await this.notifyManagers(user.id, username)
      }
    }

    return { message: RESET_REQUEST_MESSAGE }
  }

  /**
   * 把请求送到能真正解决它的人面前：请求者所在家庭里其他 OWNER/ADMIN。
   *
   * 不含请求者本人——他正登不进去，通知他也自助不了；家庭全空（人都归档了）
   * 或只剩他一个管理员时就是零通知，此时唯一出路仍是当面找人。
   */
  private async notifyManagers(userId: string, username: string): Promise<void> {
    const memberships = await this.prisma.familyMember.findMany({
      where: { userId },
      select: { familyId: true, family: { select: { id: true, name: true, archivedAt: true } } },
    })
    const families = memberships.map((m) => m.family).filter((f) => f.archivedAt === null)
    if (families.length === 0) return

    const managers = await this.prisma.familyMember.findMany({
      where: {
        familyId: { in: families.map((f) => f.id) },
        role: { in: ['OWNER', 'ADMIN'] },
        userId: { not: userId },
      },
      select: { userId: true, familyId: true },
    })

    // 一个人可能同时管着请求者的好几个家庭：合并成一条，别刷屏。
    // 名字是用来念的，id 是用来落的——两个家庭同名时只能信 id。
    const seen = new Map<string, { familyIds: string[]; names: Set<string> }>()
    for (const manager of managers) {
      const family = families.find((f) => f.id === manager.familyId)
      if (!family) continue
      const entry = seen.get(manager.userId) ?? { familyIds: [], names: new Set<string>() }
      if (!entry.familyIds.includes(family.id)) entry.familyIds.push(family.id)
      entry.names.add(family.name)
      seen.set(manager.userId, entry)
    }

    for (const [managerId, entry] of seen) {
      // 取这位管理员确实管理着的那一家：客户端点开通知会据此切到对应的
      // 成员列表，指到一间他不在里面的家庭等于把人带进 403。
      const familyId = entry.familyIds[0]
      const title = '有人需要重置密码'
      const body =
        `${username} 提交了找回密码请求（家庭：${[...entry.names].join('、')}）。` +
        '请在成员列表里为该账号设置临时密码。'

      await this.prisma.notification.create({
        data: { userId: managerId, familyId, title, body },
      })

      // 站内通知只有打开 App 才看得见，而"忘了密码来找你"偏偏发生在没人开着 App 的时候。
      // push.send 内部不会抛（实现方契约），所以这里不必为它写 try。
      await this.push.send(managerId, title, body, { familyId, kind: 'password_reset' })
    }
  }
}
