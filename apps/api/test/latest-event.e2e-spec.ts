import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'

describe('最近一条记录', () => {
  let app: INestApplication
  let me: { token: string; id: string }
  let familyId: string
  let childId: string

  const get = (type = 'feeding') =>
    request(app.getHttpServer())
      .get(`/api/families/${familyId}/children/${childId}/events/latest?type=${type}`)
      .set('Authorization', `Bearer ${me.token}`)

  const postEvent = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/families/${familyId}/events`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ childId, ...body })

  beforeAll(async () => {
    app = await createTestApp()
  })
  beforeEach(async () => {
    await resetDatabase()
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'lt_me1', password: 'pass12345', nickname: '爸爸', timezone: 'Asia/Shanghai' })
      .expect(201)
    me = { token: res.body.accessToken as string, id: res.body.user.id as string }
    const f = await request(app.getHttpServer())
      .post('/api/families')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ name: 'F' })
      .expect(201)
    familyId = f.body.id as string
    const c = await request(app.getHttpServer())
      .post(`/api/families/${familyId}/children`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ name: '宝宝', gender: 'UNKNOWN', birthday: '2026-01-01' })
      .expect(201)
    childId = c.body.id as string
  })
  afterAll(async () => {
    await resetDatabase()
    await app.close()
  })

  it('没有任何记录时返回 null 而不是 404', async () => {
    const res = await get().expect(200)
    expect(res.body).toEqual({ event: null })
  })

  it('返回该类型最近的一条，并带上记录人昵称', async () => {
    await postEvent({
      type: 'feeding',
      occurredAt: new Date(Date.now() - 7200_000).toISOString(),
      payload: { method: 'breast' },
    }).expect(201)
    await postEvent({
      type: 'feeding',
      occurredAt: new Date(Date.now() - 1200_000).toISOString(),
      payload: { method: 'bottle', amountMl: 100 },
    }).expect(201)

    const res = await get().expect(200)
    expect(res.body.event.payload.method).toBe('bottle')
    expect(res.body.event.createdByNickname).toBe('爸爸')
  })

  it('忽略未来时间的记录（用户补录过去时间时的关键行为）', async () => {
    await postEvent({
      type: 'feeding',
      occurredAt: new Date(Date.now() + 3600_000).toISOString(),
      payload: { method: 'breast' },
    }).expect(201)

    const res = await get().expect(200)
    expect(res.body.event).toBeNull()
  })

  it('忽略已软删除的记录', async () => {
    const created = await postEvent({
      type: 'feeding',
      occurredAt: new Date(Date.now() - 600_000).toISOString(),
      payload: { method: 'breast' },
    }).expect(201)
    await request(app.getHttpServer())
      .delete(`/api/families/${familyId}/events/${created.body.id}`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(204)

    const res = await get().expect(200)
    expect(res.body.event).toBeNull()
  })

  it('只看指定类型，不串到别的类型', async () => {
    await postEvent({
      type: 'diaper',
      occurredAt: new Date(Date.now() - 300_000).toISOString(),
      payload: { kind: 'pee' },
    }).expect(201)

    const res = await get('feeding').expect(200)
    expect(res.body.event).toBeNull()
  })

  it('非法 type 返回 400', async () => {
    await get('nonsense').expect(400)
  })

  it('非成员访问返回 403', async () => {
    const other = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'lt_other1', password: 'pass12345', nickname: 'X', timezone: 'Asia/Shanghai' })
      .expect(201)
    await request(app.getHttpServer())
      .get(`/api/families/${familyId}/children/${childId}/events/latest?type=feeding`)
      .set('Authorization', `Bearer ${other.body.accessToken}`)
      .expect(403)
  })

  it('别的家庭的孩子：本家庭读不到它的最近记录', async () => {
    const other = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'lt_other2', password: 'pass12345', nickname: 'X', timezone: 'Asia/Shanghai' })
      .expect(201)
    const f2 = await request(app.getHttpServer())
      .post('/api/families')
      .set('Authorization', `Bearer ${other.body.accessToken}`)
      .send({ name: 'F2' })
      .expect(201)
    const c2 = await request(app.getHttpServer())
      .post(`/api/families/${f2.body.id}/children`)
      .set('Authorization', `Bearer ${other.body.accessToken}`)
      .send({ name: '别家孩子', birthday: '2026-01-01' })
      .expect(201)

    await request(app.getHttpServer())
      .get(`/api/families/${familyId}/children/${c2.body.id}/events/latest?type=feeding`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(400)
  })
})
