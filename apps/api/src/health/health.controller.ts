import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common'
import { Client } from 'pg'

@Controller('health')
export class HealthController {
  /**
   * 刻意不用 Prisma：Prisma 在 schema 里没有任何 model 时拒绝生成客户端，
   * 而模型属于 Task 2。健康检查要的是"数据库连得上"，用 pg 直连即可，
   * 这样本任务能独立通过，不依赖后续任务。
   */
  @Get()
  async check(): Promise<{ status: string; db: string }> {
    const client = new Client({ connectionString: process.env.DATABASE_URL })
    try {
      await client.connect()
      await client.query('SELECT 1')
      return { status: 'ok', db: 'up' }
    } catch {
      throw new HttpException({ status: 'error', db: 'down' }, HttpStatus.SERVICE_UNAVAILABLE)
    } finally {
      await client.end().catch(() => undefined)
    }
  }
}
