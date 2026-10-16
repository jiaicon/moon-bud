import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { JwtStrategy } from './jwt.strategy'
import { MeController } from './me.controller'
import { TokenService } from './token.service'

@Module({
  // 不在这里固定密钥：签发时按用途传入（access 用 access secret），
  // 避免同一个密钥被两种 token 共用。
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController, MeController],
  providers: [AuthService, TokenService, JwtStrategy],
  exports: [TokenService],
})
export class AuthModule {}
