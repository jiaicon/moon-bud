import { BadRequestException, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { hashPassword } from './password.util'

export interface IssuedTokens {
  accessToken: string
  refreshToken: string
}

/**
 * refresh token 只把哈希存库：库被读走也拿不到可直接使用的凭据。
 * 轮换（rotate）而不是续期，使被窃取的旧 token 在下次使用后立即失效。
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private get accessSecret(): string {
    return this.config.get<string>('JWT_ACCESS_SECRET') ?? 'dev_access_secret_change_me'
  }

  private get accessTtl(): string {
    return this.config.get<string>('JWT_ACCESS_TTL') ?? '2h'
  }

  private get refreshTtlMs(): number {
    const raw = this.config.get<string>('JWT_REFRESH_TTL') ?? '30d'
    const match = /^(\d+)([smhd])$/.exec(raw.trim())
    if (!match) return 30 * 24 * 60 * 60 * 1000
    const value = Number(match[1])
    const unit = match[2]
    const factor = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000
    return value * factor
  }

  async issue(userId: string, username: string): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, username },
      { secret: this.accessSecret, expiresIn: this.accessTtl },
    )

    const rawRefresh = randomUUID()
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: await hashPassword(rawRefresh),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
      },
    })

    return { accessToken, refreshToken: rawRefresh }
  }

  /** 轮换：旧的立刻作废，换一对新的。 */
  async rotate(rawRefreshToken: string): Promise<IssuedTokens> {
    const candidates = await this.prisma.refreshToken.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { select: { id: true, username: true } } },
    })

    // refresh token 是随机 UUID，不是可解析的 JWT，所以只能逐个比对哈希。
    for (const candidate of candidates) {
      if (await verifyAgainst(rawRefreshToken, candidate.tokenHash)) {
        await this.prisma.refreshToken.update({
          where: { id: candidate.id },
          data: { revokedAt: new Date() },
        })
        return this.issue(candidate.user.id, candidate.user.username)
      }
    }
    throw new BadRequestException('登录状态已失效，请重新登录')
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }
}

async function verifyAgainst(raw: string, hash: string): Promise<boolean> {
  const bcrypt = await import('bcryptjs')
  return bcrypt.compare(raw, hash)
}
