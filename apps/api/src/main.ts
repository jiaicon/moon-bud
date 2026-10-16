import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)

  // 所有路由统一挂在 /api 下，客户端只需配置一个 baseURL。
  app.setGlobalPrefix('api')

  // whitelist 会剥掉 DTO 未声明的字段，这是"payload 多带未知字段"的第一道防线
  // （第二道是 @moonbud/shared 的 zod .strict()）。
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )

  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port)
}

void bootstrap()
