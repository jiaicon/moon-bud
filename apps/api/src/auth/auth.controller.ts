import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { AuthService } from './auth.service'
import { CurrentUser, type AuthUser } from './current-user.decorator'
import { ChangePasswordDto } from './dto/change-password.dto'
import { LoginDto } from './dto/login.dto'
import { RefreshDto } from './dto/refresh.dto'
import { RegisterDto } from './dto/register.dto'
import { ResetRequestDto } from './dto/reset-request.dto'
import { Public } from './public.decorator'
import { ResetRequestService } from './reset-request.service'
import { TokenService } from './token.service'

@ApiTags('鉴权')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly resetRequests: ResetRequestService,
  ) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.auth.register(dto)
  }

  // 登录用 200 而不是 201：没有创建任何资源。
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto) {
    return this.auth.login(dto)
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto) {
    return this.tokens.rotate(dto.refreshToken)
  }

  // 需要登录：改自己的密码必须先证明自己知道旧密码。
  @Post('change-password')
  @HttpCode(200)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto)
  }

  /**
   * 忘记密码的自助登记。@Public 是必须的——忘了密码的人自然也没有 token。
   * 202 而不是 200：请求被受理，但 v1 不做任何自动处理。
   */
  @Public()
  @Post('reset-request')
  @HttpCode(202)
  async resetRequest(@Body() dto: ResetRequestDto) {
    return this.resetRequests.request(dto.username)
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser): Promise<void> {
    await this.tokens.revokeAllForUser(user.id)
  }
}
