import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import { Prisma, type User } from '@prisma/client'
import type { AuthResponse, UserDto } from '@moonbud/shared'
import { normalizeUsername } from '@moonbud/shared'
import { PrismaService } from '../prisma/prisma.service'
import { hashPassword, verifyPassword } from './password.util'
import { TokenService } from './token.service'
import type { LoginDto } from './dto/login.dto'
import type { RegisterDto } from './dto/register.dto'
import type { ChangePasswordDto } from './dto/change-password.dto'

/**
 * 账号不存在时也要跑一次比对，避免用响应时间区分"账号不存在"与"密码错误"。
 * 这是固定的假哈希，不匹配任何真实密码。
 */
const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8M6YQ0h1G7V5n4Zx9Kp2Lm3No4Pq5S'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    // 账号一律小写存储：大小写不敏感因此是天然行为，不需要额外的比较逻辑。
    const username = normalizeUsername(dto.username)

    const existing = await this.prisma.user.findUnique({ where: { username } })
    if (existing) {
      throw new ConflictException('该账号已被使用')
    }

    try {
      const user = await this.prisma.user.create({
        data: {
          username,
          passwordHash: await hashPassword(dto.password),
          nickname: dto.nickname,
          timezone: dto.timezone,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
        },
      })
      return this.buildAuthResponse(user)
    } catch (error) {
      // 并发注册同一账号时，先到者成功、后者撞唯一约束，仍要给出 409 而不是 500。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('该账号已被使用')
      }
      throw error
    }
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const username = normalizeUsername(dto.username)
    const user = await this.prisma.user.findUnique({ where: { username } })

    const ok = await verifyPassword(dto.password, user?.passwordHash ?? DUMMY_HASH)
    if (!user || !ok) {
      // 两种失败用同一条文案：否则攻击者可以据此枚举出哪些账号存在。
      throw new UnauthorizedException('账号或密码不正确')
    }

    // 临时密码凭据是一次性的：登录成功那一刻就标记为已用（spec 第 5 节）。
    // 注意被作废的是**重置凭据的记录**，不是密码本身——密码要等用户完成
    // 强制改密才换掉，否则他会在改密前就被锁在门外。
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    })

    return this.buildAuthResponse(user)
  }

  /**
   * 修改密码。记得旧密码的人走的正常通路；忘记密码只能由家庭成员发临时密码。
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      // token 有效但用户已不存在（例如被管理员清理）：按未认证处理。
      throw new UnauthorizedException('登录状态已失效，请重新登录')
    }

    if (!(await verifyPassword(dto.oldPassword, user.passwordHash))) {
      throw new UnauthorizedException('当前密码不正确')
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(dto.newPassword),
        // 改完密码就不再处于"被重置"状态，客户端可以离开强制改密页。
        mustChangePassword: false,
        // 和上面同一行写入：这一时刻之前签发的 access token 全部作废。
        // 不填的话，拿到旧 token 的人在你改完密码后还能继续用满 2 小时。
        passwordChangedAt: new Date(),
      },
    })

    // 顺序是关键：先撤销全部旧会话，再签发当前设备的新会话。
    // 反过来的话，新 token 会被这次撤销一起干掉，用户立刻掉线。
    await this.tokens.revokeAllForUser(userId)
    return this.buildAuthResponse(updated)
  }

  private async buildAuthResponse(user: User): Promise<AuthResponse> {
    const { accessToken, refreshToken } = await this.tokens.issue(user.id, user.username)
    return {
      accessToken,
      refreshToken,
      user: toUserDto(user),
      mustChangePassword: user.mustChangePassword,
    }
  }
}

/** 白名单映射。绝不展开整个 user 对象——那会把 passwordHash 带出去。 */
export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    timezone: user.timezone,
    avatarUrl: user.avatarUrl,
  }
}
