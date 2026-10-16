import { ValidationPipe, type INestApplication } from '@nestjs/common'

/**
 * 应用级装配的唯一实现处，由 main.ts 与 e2e 测试共同调用。
 *
 * 为什么要抽出来：测试若自己拼一遍装配，就会和线上产生静默偏差。
 * 这里曾经出过一次真实事故——测试只复制了 setGlobalPrefix 而漏掉
 * ValidationPipe，结果是**校验完全没生效**，非法账号与非法时区都被
 * 当成 201 创建成功，而测试还以为自己在验证校验逻辑。
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api')

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )
}
