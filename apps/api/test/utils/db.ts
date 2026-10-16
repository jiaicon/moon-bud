import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { AppModule } from '../../src/app.module'
import { configureApp } from '../../src/configure-app'

/** 每个 e2e 文件各自起一个应用实例，走真实的 HTTP 管道与真实数据库。 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  const app = moduleRef.createNestApplication()
  // 复用 main.ts 的装配，保证测试里的校验/前缀与线上完全一致。
  configureApp(app)
  await app.init()
  return app
}

/**
 * 清空全部业务表。表名清单在 Task 2 建立迁移后即为完整集合。
 *
 * Prisma 客户端是**惰性**获取的：在 model 定义出来之前 `@prisma/client`
 * 只是空壳，模块顶层 import 不会失败，但一旦真去构造就会报未初始化。
 * 因此这里把构造推迟到第一次真正调用 resetDatabase 的时候——只有已经
 * 建好表的测试才会走到这一步。
 */
let prismaClient: { $executeRawUnsafe: (sql: string) => Promise<number> } | null = null

async function getPrisma(): Promise<{ $executeRawUnsafe: (sql: string) => Promise<number> }> {
  if (!prismaClient) {
    const mod = await import('@prisma/client')
    const PrismaClientCtor = (mod as unknown as {
      PrismaClient: new () => { $executeRawUnsafe: (sql: string) => Promise<number> }
    }).PrismaClient
    prismaClient = new PrismaClientCtor()
  }
  return prismaClient
}

export async function resetDatabase(): Promise<void> {
  const prisma = await getPrisma()
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE
       notifications,
       reminder_occurrences,
       reminders,
       family_invites,
       events,
       children,
       password_reset_tokens,
       refresh_tokens,
       family_members,
       families,
       users
     RESTART IDENTITY CASCADE`,
  )
}
