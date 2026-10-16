import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.auth.register(dto)
  }

  // 登录用 200 而不是 201：没有创建任何资源。
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto) {
    return this.auth.login(dto)
  }
}
