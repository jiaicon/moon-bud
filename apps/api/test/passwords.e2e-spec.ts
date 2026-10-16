import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'
import { PrismaService } from '../src/prisma/prisma.service'

describe('密码', () => {
  let app: INestApplication
  let prisma: PrismaService

  const register = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/auth/register').send({
      password: 'pass12345',
      nickname: 'A',
      timezone: 'Asia/Shanghai',
      ...body,
    })

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
  })
  beforeEach(async () => {
    await resetDatabase()
  })
  afterAll(async () => {
    await resetDatabase()
    await app.close()
  })

  it('修改密码成功后旧 refresh token 失效，新 token 可用', async () => {
    const reg = await register({ username: 'pw_u1' }).expect(201)
    const changed = await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ oldPassword: 'pass12345', newPassword: 'newpass12345' })
      .expect(200)
    expect(changed.body.accessToken).toBeTruthy()
    expect(changed.body.refreshToken).toBeTruthy()

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: reg.body.refreshToken })
      .expect(401)

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'pw_u1', password: 'newpass12345' })
      .expect(200)

    // 新签发的 refresh token 必须能用：撤销旧会话不能连新会话一起撤销。
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: changed.body.refreshToken })
      .expect(200)
  })

  it('旧密码错误时拒绝修改，且原密码仍然有效', async () => {
    const reg = await register({ username: 'pw_u2' }).expect(201)
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ oldPassword: 'wrongpass1', newPassword: 'newpass12345' })
      .expect(401)
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'pw_u2', password: 'pass12345' })
      .expect(200)
  })

  it('新密码过短被拒绝，且密码没有被改动', async () => {
    const reg = await register({ username: 'pw_u3' }).expect(201)
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ oldPassword: 'pass12345', newPassword: 'short' })
      .expect(400)
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'pw_u3', password: 'pass12345' })
      .expect(200)
  })

  it('未登录不能修改密码', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .send({ oldPassword: 'pass12345', newPassword: 'newpass12345' })
      .expect(401)
  })

  it('reset-request 对存在与不存在的账号返回相同状态码与相同响应体', async () => {
    await register({ username: 'pw_u4' }).expect(201)
    const known = await request(app.getHttpServer())
      .post('/api/auth/reset-request')
      .send({ username: 'pw_u4' })
      .expect(202)
    const unknown = await request(app.getHttpServer())
      .post('/api/auth/reset-request')
      .send({ username: 'ghost999' })
      .expect(202)
    expect(known.body).toEqual(unknown.body)
  })

  it('reset-request 只登记请求，不自行重置任何人的密码', async () => {
    const reg = await register({ username: 'pw_u5' }).expect(201)
    await request(app.getHttpServer())
      .post('/api/auth/reset-request')
      .send({ username: 'pw_u5' })
      .expect(202)
    // 原密码必须照旧可用：没有家庭成员的当面确认，v1 不提供自助重置。
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'pw_u5', password: 'pass12345' })
      .expect(200)
    expect(reg.body.user.username).toBe('pw_u5')
  })

  it('临时密码首登被要求改密，改完后 mustChangePassword 复位——完整闭环', async () => {
    // 家人 A 建家庭，家人 B 加入；B 忘记密码，由 A 在成员页重置。
    const a = await register({ username: 'pw_owner' }).expect(201)
    const b = await register({ username: 'pw_member' }).expect(201)
    const family = await request(app.getHttpServer())
      .post('/api/families')
      .set('Authorization', `Bearer ${a.body.accessToken}`)
      .send({ name: 'F' })
      .expect(201)
    const bRow = await prisma.familyMember.create({
      data: { familyId: family.body.id, userId: b.body.user.id, role: 'MEMBER' },
    })

    const reset = await request(app.getHttpServer())
      .post(`/api/families/${family.body.id}/members/${bRow.id}/reset-password`)
      .set('Authorization', `Bearer ${a.body.accessToken}`)
      .expect(200)
    const temp = reset.body.temporaryPassword as string

    const firstLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'pw_member', password: temp })
      .expect(200)
    expect(firstLogin.body.mustChangePassword).toBe(true)

    // 临时密码凭据是一次性的：登录成功那一刻就作废（spec 第 5 节）。
    const pending = await prisma.passwordResetToken.findMany({
      where: { userId: b.body.user.id, usedAt: null },
    })
    expect(pending).toHaveLength(0)

    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${firstLogin.body.accessToken}`)
      .send({ oldPassword: temp, newPassword: 'brandnew12345' })
      .expect(200)

    // 临时密码作废，新密码生效，且不再要求改密。
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'pw_member', password: temp })
      .expect(401)
    const after = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'pw_member', password: 'brandnew12345' })
      .expect(200)
    expect(after.body.mustChangePassword).toBe(false)
  })
})
