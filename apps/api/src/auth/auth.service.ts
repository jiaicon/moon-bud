import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import { Prisma, type User } from '@prisma/client'
import type { AuthResponse, UserDto } from '@moonbud/shared'
import { normalizeUsername } from '@moonbud/shared'
import { PrismaService } from '../prisma/prisma.service'
import { hashPassword, verifyPassword } from './password.util'
import { TokenService } from './token.service'
import type { LoginDto } from './dto/login.dto'
import type { RegisterDto } from './dto/register.dto'

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

    return this.buildAuthResponse(user)
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
