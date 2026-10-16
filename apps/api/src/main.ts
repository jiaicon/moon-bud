import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { configureApp } from './configure-app'
import { setupSwagger } from './swagger'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  configureApp(app)
  setupSwagger(app)

  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port)
}

void bootstrap()
