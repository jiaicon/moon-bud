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
 * 清空全部业务表。
 *
 * Prisma 客户端是**惰性**获取的：在 model 定义出来之前 `@prisma/client`
 * 只是空壳，模块顶层 import 不会失败，但一旦真去构造就会报未初始化。
 * 因此这里把构造推迟到函数内部——只有已经建好表的测试才会走到这一步。
 *
 * 每次调用都新起一个客户端并在用完立刻 `$disconnect`。曾经这里按"模块级
 * 单例"缓存客户端，看着省掉重复建连，但 jest 的文件沙箱让每个 spec 各拿一份，
 * `--runInBand` 串行跑完整套时要泄漏十几个连接池，全跑完才随进程一起回收；
 * 首套件冷启动时这份额外连接与 app 自己的 PrismaService 交叠，正是被记过
 * 一笔"首套件假红"的地方。清库只是一条 TRUNCATE，犯不上常驻一条连接。
 */
const TRUNCATE_ALL = `TRUNCATE TABLE
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
RESTART IDENTITY CASCADE`

export async function resetDatabase(): Promise<void> {
  const mod = await import('@prisma/client')
  const PrismaClientCtor = (mod as unknown as {
    PrismaClient: new () => {
      $executeRawUnsafe: (sql: string) => Promise<number>
      $disconnect: () => Promise<void>
    }
  }).PrismaClient
  const prisma = new PrismaClientCtor()
  try {
    await prisma.$executeRawUnsafe(TRUNCATE_ALL)
  } finally {
    await prisma.$disconnect()
  }
}
