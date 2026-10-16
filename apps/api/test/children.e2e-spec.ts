import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'
import { PrismaService } from '../src/prisma/prisma.service'

describe('孩子', () => {
  let app: INestApplication
  let prisma: PrismaService
  let me: { token: string; id: string }
  let other: { token: string; id: string }
  let familyId: string

  const register = async (username: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username, password: 'pass12345', nickname: username, timezone: 'Asia/Shanghai' })
      .expect(201)
    return { token: res.body.accessToken as string, id: res.body.user.id as string }
  }

  const create = (body: Record<string, unknown>, token = me.token) =>
    request(app.getHttpServer())
      .post(`/api/families/${familyId}/children`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)

  const list = (token = me.token) =>
    request(app.getHttpServer())
      .get(`/api/families/${familyId}/children`)
      .set('Authorization', `Bearer ${token}`)

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
  })
  beforeEach(async () => {
    await resetDatabase()
    me = await register('ch_me1')
    other = await register('ch_other1')
    const f = await request(app.getHttpServer())
      .post('/api/families')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ name: 'F' })
      .expect(201)
    familyId = f.body.id as string
  })
  afterAll(async () => {
    await resetDatabase()
    await app.close()
  })

  it('创建孩子并读回，birthday 是纯日期', async () => {
    const res = await create({
      name: '宝宝',
      gender: 'FEMALE',
      birthday: '2026-01-01',
      avatarUrl: null,
    }).expect(201)

    expect(res.body.familyId).toBe(familyId)
    expect(res.body.name).toBe('宝宝')
    expect(res.body.gender).toBe('FEMALE')
    expect(res.body.birthday).toBe('2026-01-01')
    expect(res.body.archivedAt).toBeNull()
  })

  it('gender 省略时默认 UNKNOWN', async () => {
    const res = await create({ name: '二宝', birthday: '2026-02-02' }).expect(201)
    expect(res.body.gender).toBe('UNKNOWN')
  })

  it('拒绝未来的出生日期', async () => {
    // 用 +2 天而不是 +1 天：校验器允许"最多到明天（UTC）"，用来吸收客户端
    // 时区比 UTC 早一天的情况（UTC+8 的下午，当地已经是第二天）。
    const tooLate = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    await create({ name: '还没出生', birthday: tooLate }).expect(400)
    await create({ name: '今天出生', birthday: new Date().toISOString().slice(0, 10) }).expect(201)
  })

  it('拒绝非法的日期格式与非法的 gender', async () => {
    await create({ name: '宝宝', birthday: '2026/01/01' }).expect(400)
    await create({ name: '宝宝', birthday: '2026-01-01', gender: 'ROBOT' }).expect(400)
  })

  it('可以改名与改生日', async () => {
    const created = await create({ name: '宝宝', birthday: '2026-01-01' }).expect(201)
    const updated = await request(app.getHttpServer())
      .patch(`/api/families/${familyId}/children/${created.body.id}`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ name: '小名', birthday: '2025-12-31' })
      .expect(200)
    expect(updated.body.name).toBe('小名')
    expect(updated.body.birthday).toBe('2025-12-31')
  })

  it('删除是软删除：不再出现在列表里，但行还在，历史记录也还在', async () => {
    const created = await create({ name: '宝宝', birthday: '2026-01-01' }).expect(201)
    const feeding = await request(app.getHttpServer())
      .post(`/api/families/${familyId}/events`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({
        childId: created.body.id,
        type: 'feeding',
        occurredAt: '2026-10-16T02:00:00.000Z',
        payload: { method: 'breast' },
      })
      .expect(201)

    await request(app.getHttpServer())
      .delete(`/api/families/${familyId}/children/${created.body.id}`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(204)

    expect((await list().expect(200)).body).toEqual([])

    const row = await prisma.child.findUniqueOrThrow({ where: { id: created.body.id } })
    expect(row.archivedAt).not.toBeNull()
    // 归档孩子不能连记录一起消失：那等于数据丢失。
    const event = await prisma.event.findUniqueOrThrow({ where: { id: feeding.body.id } })
    expect(event.deletedAt).toBeNull()
  })

  it('孩子的 id 只在所属家庭里有效：本家庭查不到别家的孩子，也改不动', async () => {
    const f2 = await request(app.getHttpServer())
      .post('/api/families')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ name: 'F2' })
      .expect(201)
    const c2 = await request(app.getHttpServer())
      .post(`/api/families/${f2.body.id}/children`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ name: '别家孩子', birthday: '2026-01-01' })
      .expect(201)

    await request(app.getHttpServer())
      .patch(`/api/families/${familyId}/children/${c2.body.id}`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ name: '被改了' })
      .expect(404)

    await request(app.getHttpServer())
      .delete(`/api/families/${familyId}/children/${c2.body.id}`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(404)
  })

  it('非成员不能读、写、改、删孩子，且响应不含孩子名字', async () => {
    const created = await create({ name: '别偷看', birthday: '2026-01-01' }).expect(201)
    const endpoints: Array<[string, string]> = [
      ['get', `/api/families/${familyId}/children`],
      ['post', `/api/families/${familyId}/children`],
      ['patch', `/api/families/${familyId}/children/${created.body.id}`],
      ['delete', `/api/families/${familyId}/children/${created.body.id}`],
    ]
    for (const [method, path] of endpoints) {
      const res = await (request(app.getHttpServer()) as never as Record<
        string,
        (p: string) => request.Test
      >)
        [method](path)
        .set('Authorization', `Bearer ${other.token}`)
        .send({ name: 'x', birthday: '2026-01-01' })
        .expect(403)
      expect(JSON.stringify(res.body)).not.toContain('别偷看')
    }
  })
})
