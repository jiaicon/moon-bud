import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp } from './utils/db'

describe('GET /api/health', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('数据库可达时返回 ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200)
    expect(res.body).toEqual({ status: 'ok', db: 'up' })
  })
})
