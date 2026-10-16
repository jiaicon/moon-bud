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

  // 回显任意来源是安全的，因为凭据一律关闭：鉴权只走 Authorization 头，
  // 浏览器不会自动带上任何东西（没有 cookie），跨源站点因此拿不到已登录会话。
  // 关掉 CORS 的表现是前端只报"请求失败"、后端日志空白，所以必须有 e2e 钉住。
  app.enableCors({ origin: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'], credentials: false })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      // 刻意**不开** enableImplicitConversion：它按 TS 反射类型转换，
      // 于是查询串里的 `?flag=false` 会走 Boolean('false') === true，
      // 把"关"变成"开"，而且会盖掉 DTO 上显式的 @Transform。
      // 数字/布尔一律用 @Type/@Transform 显式声明。
      transformOptions: { enableImplicitConversion: false },
    }),
  )
}
