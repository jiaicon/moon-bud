import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'

describe('会话', () => {
  let app: INestApplication
  let tokens: { accessToken: string; refreshToken: string }

  beforeAll(async () => {
    app = await createTestApp()
  })

  beforeEach(async () => {
    await resetDatabase()
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        username: 'papa2024',
        password: 'pass12345',
        nickname: '爸爸',
        timezone: 'Asia/Shanghai',
      })
      .expect(201)
    tokens = { accessToken: res.body.accessToken, refreshToken: res.body.refreshToken }
  })

  afterAll(async () => {
    await resetDatabase()
    await app.close()
  })

  it('无 token 访问 /api/me 返回 401', async () => {
    await request(app.getHttpServer()).get('/api/me').expect(401)
  })

  it('带 access token 可访问 /api/me 并返回家庭列表', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200)
    expect(res.body.user.username).toBe('papa2024')
    expect(res.body.families).toEqual([])
  })

  it('篡改的 token 返回 401', async () => {
    await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${tokens.accessToken}tampered`)
      .expect(401)
  })

  it('refresh 换新 token，且旧 refresh 立即失效（旋转）', async () => {
    const r1 = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(200)
    expect(r1.body.accessToken).toBeTruthy()

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401)
  })

  it('登出后 refresh 失效', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(204)

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401)
  })

  it('公开路由无需 token', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200)
  })
})
