import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { TokenService } from './token.service'

@Module({
  // 不在这里固定密钥：签发时按用途传入（access 用 access secret），
  // 避免同一个密钥被两种 token 共用。
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokenService],
  exports: [TokenService],
})
export class AuthModule {}
