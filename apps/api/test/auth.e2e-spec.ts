import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'

describe('鉴权', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createTestApp()
  })

  beforeEach(async () => {
    await resetDatabase()
  })

  afterAll(async () => {
    await resetDatabase()
    await app.close()
  })

  const reg = (b: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/auth/register').send(b)

  const valid = {
    username: 'mama2024',
    password: 'pass12345',
    nickname: '妈妈',
    timezone: 'Asia/Shanghai',
  }

  it('注册返回双 token 与用户信息，且不泄露密码哈希', async () => {
    const res = await reg(valid).expect(201)
    expect(res.body.accessToken).toBeTruthy()
    expect(res.body.refreshToken).toBeTruthy()
    expect(res.body.user.username).toBe('mama2024')
    expect(res.body.user).not.toHaveProperty('passwordHash')
    expect(JSON.stringify(res.body)).not.toContain('$2b$')
  })

  it('账号大小写不同视为同一个账号（查重不区分大小写）', async () => {
    await reg(valid).expect(201)
    await reg({ ...valid, username: 'MAMA2024' }).expect(409)
  })

  it('拒绝不合规账号与过短密码', async () => {
    await reg({ ...valid, username: 'ab' }).expect(400)
    await reg({ ...valid, username: '妈妈2024' }).expect(400)
    await reg({ ...valid, password: 'short' }).expect(400)
  })

  it('拒绝非法时区', async () => {
    await reg({ ...valid, timezone: 'Not/AZone' }).expect(400)
  })

  it('登录成功；密码错误返回 401 且不区分"账号不存在"与"密码错误"', async () => {
    await reg(valid).expect(201)
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'mama2024', password: 'pass12345' })
      .expect(200)

    const wrongPw = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'mama2024', password: 'nope12345' })
      .expect(401)
    const noUser = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'ghost2024', password: 'nope12345' })
      .expect(401)
    expect(wrongPw.body.message).toBe(noUser.body.message)
  })

  it('登录不区分账号大小写', async () => {
    await reg(valid).expect(201)
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'MaMa2024', password: 'pass12345' })
      .expect(200)
  })
})
