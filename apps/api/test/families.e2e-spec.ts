import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'

describe('家庭与权限', () => {
  let app: INestApplication
  let a: { token: string; id: string; familyId: string }
  let b: { token: string; id: string }

  const register = async (username: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username, password: 'pass12345', nickname: username, timezone: 'Asia/Shanghai' })
      .expect(201)
    return { token: res.body.accessToken as string, id: res.body.user.id as string }
  }

  beforeAll(async () => {
    app = await createTestApp()
  })

  beforeEach(async () => {
    await resetDatabase()
    const ua = await register('user_a1')
    const ub = await register('user_b1')
    const f = await request(app.getHttpServer())
      .post('/api/families')
      .set('Authorization', `Bearer ${ua.token}`)
      .send({ name: '我们家' })
      .expect(201)
    a = { ...ua, familyId: f.body.id }
    b = ub
  })

  afterAll(async () => {
    await resetDatabase()
    await app.close()
  })

  it('创建家庭时创建者自动成为 OWNER', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/families/${a.familyId}`)
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200)
    expect(res.body.role).toBe('OWNER')
    expect(res.body.members).toHaveLength(1)
    expect(res.body.members[0].role).toBe('OWNER')
  })

  it('非成员读取别家数据返回 403，且响应体不含家庭名', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/families/${a.familyId}`)
      .set('Authorization', `Bearer ${b.token}`)
      .expect(403)
    expect(JSON.stringify(res.body)).not.toContain('我们家')
  })

  it('非成员改别家数据返回 403', async () => {
    await request(app.getHttpServer())
      .patch(`/api/families/${a.familyId}`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ name: '被改了' })
      .expect(403)
  })

  it('不存在的 familyId 返回 403 而非 404，避免探测家庭是否存在', async () => {
    await request(app.getHttpServer())
      .get('/api/families/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${b.token}`)
      .expect(403)
  })

  it('GET /api/families 只返回自己所属的家庭', async () => {
    const mine = await request(app.getHttpServer())
      .get('/api/families')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200)
    expect(mine.body.map((f: { id: string }) => f.id)).toEqual([a.familyId])

    const others = await request(app.getHttpServer())
      .get('/api/families')
      .set('Authorization', `Bearer ${b.token}`)
      .expect(200)
    expect(others.body).toEqual([])
  })

  it('归档家庭后成员读写均被拒绝，且不再出现在家庭列表', async () => {
    await request(app.getHttpServer())
      .post(`/api/families/${a.familyId}/archive`)
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200)

    await request(app.getHttpServer())
      .get(`/api/families/${a.familyId}`)
      .set('Authorization', `Bearer ${a.token}`)
      .expect(403)

    const list = await request(app.getHttpServer())
      .get('/api/families')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200)
    expect(list.body).toEqual([])
  })

  it('转让给非成员返回 400（不允许把所有权交给外人）', async () => {
    await request(app.getHttpServer())
      .post(`/api/families/${a.familyId}/transfer`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ toUserId: b.id })
      .expect(400)
  })

  it('MEMBER 不能改名（需要 ADMIN 及以上），未加入者的所有家庭作用域端点都 403', async () => {
    const endpoints: Array<[string, string]> = [
      ['get', `/api/families/${a.familyId}`],
      ['patch', `/api/families/${a.familyId}`],
      ['post', `/api/families/${a.familyId}/archive`],
      ['post', `/api/families/${a.familyId}/transfer`],
      ['post', `/api/families/${a.familyId}/leave`],
    ]
    for (const [method, path] of endpoints) {
      await (request(app.getHttpServer()) as never as Record<string, (p: string) => request.Test>)
        [method](path)
        .set('Authorization', `Bearer ${b.token}`)
        .send({ toUserId: a.id, name: 'x' })
        .expect(403)
    }
  })
})
