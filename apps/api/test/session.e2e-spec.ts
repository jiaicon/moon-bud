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
    expect(res.body.mustChangePassword).toBe(false)
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

  it('PATCH /api/me 改时区后返回新用户，/me 也回读到新值', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ timezone: 'Asia/Kolkata' })
      .expect(200)
    expect(res.body.timezone).toBe('Asia/Kolkata')

    const me = await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200)
    expect(me.body.user.timezone).toBe('Asia/Kolkata')
  })

  it('PATCH /api/me 认不出的时区名报中文，且原值保持不动', async () => {
    await request(app.getHttpServer())
      .patch('/api/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ timezone: 'Mars/Olympus' })
      .expect(400)

    const me = await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200)
    expect(me.body.user.timezone).toBe('Asia/Shanghai')
  })

  it('PATCH /api/me 没有 timezone 就是 400：这一层只改这一件事，空 body 不算成功', async () => {
    await request(app.getHttpServer())
      .patch('/api/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({})
      .expect(400)

    // whitelist 会静默丢掉不认识的字段，所以"只发一个没实现的字段"也落在这条 400 上，
    // 而不是回一个 200 假装改成了昵称。
    await request(app.getHttpServer())
      .patch('/api/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ nickname: '妈妈' })
      .expect(400)

    const me = await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200)
    expect(me.body.user.timezone).toBe('Asia/Shanghai')
    expect(me.body.user.nickname).toBe('爸爸')
  })

  it('无 token 不能 PATCH /api/me', async () => {
    await request(app.getHttpServer()).patch('/api/me').send({ timezone: 'Asia/Tokyo' }).expect(401)
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
