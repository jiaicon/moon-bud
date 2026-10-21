import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import type { AuthUser } from './current-user.decorator'

export interface JwtPayload {
  sub: string
  username: string
  /** 签发当时的 passwordChangedAt（毫秒）。迁移前签发的老 token 没有这个字段。 */
  pwdAt?: number
  /** jsonwebtoken 自动带上：签发时刻，秒精度。 */
  iat?: number
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') ?? 'dev_access_secret_change_me',
    })
  }

  /**
   * access token 撤不掉，只能看它是不是"上次改密之前"签的。
   * 没有这一步，改了密码（或家人替你重置了密码）之后，旧设备上那份 token
   * 还能继续写数据直到 TTL 走完——而撤销 refresh 只拦得住下一次续期。
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const changedAt = await this.passwordChangedAt(payload.sub)
    // null 意味着无从判断（迁移之前的存量行），只能放行。
    if (changedAt) {
      const issuedAt = watermarkOf(payload)
      if (issuedAt !== null && issuedAt < changedAt.getTime()) {
        throw new UnauthorizedException('密码已变更，请重新登录')
      }
    }
    return { id: payload.sub, username: payload.username }
  }

  /** 查不到用户（被清理）时不作判断，交给下游的按用户查询报错。 */
  private async passwordChangedAt(userId: string): Promise<Date | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordChangedAt: true },
    })
    return row?.passwordChangedAt ?? null
  }
}

/**
 * 老 token（部署前签发、没有 pwdAt）退回按 iat 判断。iat 只有秒精度且向下取整，
 * 于是那一秒内刚改完密又刚登录的人会被误判成旧的——多一次重新登录，
 * 而且只在这批 token 自然过期（≤ TTL）之前可能发生。
 */
function watermarkOf(payload: JwtPayload): number | null {
  if (typeof payload.pwdAt === 'number') return payload.pwdAt
  if (typeof payload.iat === 'number') return payload.iat * 1000
  return null
}
