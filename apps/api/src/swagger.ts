import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

/**
 * Swagger UI 挂在 `/api/docs`。
 *
 * 路径写成 `api/docs` 而不是 `docs`：`SwaggerModule.setup` 挂的是
 * 独立中间件，**不经过** `setGlobalPrefix('api')`，所以这里必须把前缀
 * 自己带上；写成 `docs` 会得到一个 404 的 `/docs`，而 README 里承诺的是
 * `/api/docs`。
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('moonBud API')
    .setDescription(
      '多个家庭成员共同照护同一个孩子的记录与提醒 API。' +
        '家庭上下文一律走 URL 路径 `/api/families/:familyId/...`，' +
        '不放在 token 里——一个用户可同时属于多个家庭，' +
        '把"当前家庭"写进 token 会导致切家庭要重新签发 token。',
    )
    .setVersion('1.0')
    // 只声明认证方式；具体哪些路由需要 token 由全局 JwtAuthGuard 决定，
    // 少数显式 @Public() 的路由（注册/登录/健康检查）无需 Bearer。
    .addBearerAuth()
    .build()

  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('api/docs', app, document)
}
