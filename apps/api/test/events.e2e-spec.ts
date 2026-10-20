import type { INestApplication } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'
import { PrismaService } from '../src/prisma/prisma.service'

describe('记录', () => {
  let app: INestApplication
  let prisma: PrismaService
  let me: { token: string; id: string }
  let other: { token: string; id: string }
  let familyId: string
  let childId: string

  const register = async (username: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username, password: 'pass12345', nickname: username, timezone: 'Asia/Shanghai' })
      .expect(201)
    return { token: res.body.accessToken as string, id: res.body.user.id as string }
  }

  const post = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/families/${familyId}/events`)
      .set('Authorization', `Bearer ${me.token}`)
      .send(body)

  const list = (query: string) =>
    request(app.getHttpServer())
      .get(`/api/families/${familyId}/events?${query}`)
      .set('Authorization', `Bearer ${me.token}`)

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
  })
  beforeEach(async () => {
    await resetDatabase()
    me = await register('ev_me1')
    other = await register('ev_other1')
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

  it('创建喂奶记录并读回，payload 原样保存', async () => {
    const res = await post({
      childId,
      type: 'feeding',
      occurredAt: '2026-10-16T02:00:00.000Z',
      payload: { method: 'bottle', amountMl: 120 },
      note: '喝得很快',
    }).expect(201)

    expect(res.body.payload).toEqual({ method: 'bottle', amountMl: 120 })
    expect(res.body.createdBy).toBe(me.id)
    expect(res.body.createdByNickname).toBe('ev_me1')
    expect(res.body.note).toBe('喝得很快')
    expect(res.body.endedAt).toBeNull()
  })

  describe('幂等创建（离线重放不重复）', () => {
    it('带同一个客户端 id 重放两次，库里只有一条、两次返回同一条', async () => {
      const client = randomUUID()
      const body = {
        id: client,
        childId,
        type: 'feeding',
        occurredAt: '2026-10-16T02:00:00.000Z',
        payload: { method: 'bottle', amountMl: 120 },
      }
      const first = await post(body).expect(201)
      const second = await post(body).expect(201)
      expect(first.body.id).toBe(client)
      expect(second.body.id).toBe(client)
      expect(await prisma.event.count({ where: { id: client } })).toBe(1)
    })

    it('不带 id 的创建照旧各自生成新 id（回归）', async () => {
      const a = await post({ childId, type: 'sleep', occurredAt: '2026-10-16T02:00:00.000Z', payload: {} }).expect(201)
      const b = await post({ childId, type: 'sleep', occurredAt: '2026-10-16T02:00:00.000Z', payload: {} }).expect(201)
      expect(a.body.id).not.toBe(b.body.id)
      expect(await prisma.event.count({ where: { familyId } })).toBe(2)
    })

    it('拿别家已存在的记录 id 来创建：既不覆盖别家那条，也不把它读出来', async () => {
      // other 在自己的家庭里建一条，把它的 id 冒充进来。
      const of = await request(app.getHttpServer())
        .post('/api/families')
        .set('Authorization', `Bearer ${other.token}`)
        .send({ name: 'G' })
        .expect(201)
      const oc = await request(app.getHttpServer())
        .post(`/api/families/${of.body.id}/children`)
        .set('Authorization', `Bearer ${other.token}`)
        .send({ name: '别人家', gender: 'UNKNOWN', birthday: '2026-01-01' })
        .expect(201)
      const foreign = await request(app.getHttpServer())
        .post(`/api/families/${of.body.id}/events`)
        .set('Authorization', `Bearer ${other.token}`)
        .send({ childId: oc.body.id, type: 'feeding', occurredAt: '2026-10-16T02:00:00.000Z', payload: { method: 'bottle', amountMl: 1 } })
        .expect(201)

      // 用那个 id 往自己家里建：撞唯一约束 → 该拒绝，且别家那条原样不动、不被本家庭读出。
      await post({ id: foreign.body.id, childId, type: 'feeding', occurredAt: '2026-10-16T02:00:00.000Z', payload: { method: 'bottle', amountMl: 999 } })
        .expect(409)
      expect(await prisma.event.findUnique({ where: { id: foreign.body.id } })).toMatchObject({ familyId: of.body.id })
      expect(await prisma.event.count({ where: { familyId } })).toBe(0)
    })
  })

  it('拒绝 payload 多带未知字段', async () => {
    await post({
      childId,
      type: 'feeding',
      occurredAt: '2026-10-16T02:00:00.000Z',
      payload: { method: 'bottle', bogus: 1 },
    }).expect(400)
  })

  it('拒绝华氏度体温', async () => {
    await post({
      childId,
      type: 'temperature',
      occurredAt: '2026-10-16T02:00:00.000Z',
      payload: { celsius: 98.6 },
    }).expect(400)
    await post({
      childId,
      type: 'temperature',
      occurredAt: '2026-10-16T02:00:00.000Z',
      payload: { celsius: 37.2 },
    }).expect(201)
  })

  it('拒绝 endedAt 早于 occurredAt 的睡眠记录', async () => {
    const res = await post({
      childId,
      type: 'sleep',
      occurredAt: '2026-10-16T05:00:00.000Z',
      endedAt: '2026-10-16T04:00:00.000Z',
      payload: {},
    }).expect(400)
    expect(JSON.stringify(res.body)).toMatch(/endedAt|结束/)
  })

  it('接受 endedAt 晚于 occurredAt 的睡眠记录', async () => {
    await post({
      childId,
      type: 'sleep',
      occurredAt: '2026-10-16T04:00:00.000Z',
      endedAt: '2026-10-16T05:00:00.000Z',
      payload: { quality: 'good' },
    }).expect(201)
  })

  it('拒绝超过 500 字的备注', async () => {
    await post({
      childId,
      type: 'feeding',
      occurredAt: '2026-10-16T02:00:00.000Z',
      payload: { method: 'breast' },
      note: 'x'.repeat(501),
    }).expect(400)
  })

  it('拒绝未知记录类型', async () => {
    await post({
      childId,
      type: 'nonsense',
      occurredAt: '2026-10-16T02:00:00.000Z',
      payload: {},
    }).expect(400)
  })

  it('拒绝别的家庭的 childId', async () => {
    const f2 = await request(app.getHttpServer())
      .post('/api/families')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ name: 'F2' })
      .expect(201)
    const c2 = await request(app.getHttpServer())
      .post(`/api/families/${f2.body.id}/children`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ name: '别家孩子', gender: 'UNKNOWN', birthday: '2026-01-01' })
      .expect(201)

    await post({
      childId: c2.body.id,
      type: 'feeding',
      occurredAt: '2026-10-16T02:00:00.000Z',
      payload: { method: 'breast' },
    }).expect(400)
  })

  it('软删除后不出现在列表，但数据库里仍在', async () => {
    const created = await post({
      childId,
      type: 'feeding',
      occurredAt: '2026-10-16T02:00:00.000Z',
      payload: { method: 'breast' },
    }).expect(201)

    await request(app.getHttpServer())
      .delete(`/api/families/${familyId}/events/${created.body.id}`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(204)

    const res = await list(`childId=${childId}`).expect(200)
    expect(res.body.total).toBe(0)

    // "软"删除必须真的是软的：行还在，只是带上了 deletedAt。
    const row = await prisma.event.findUniqueOrThrow({ where: { id: created.body.id } })
    expect(row.deletedAt).not.toBeNull()
  })

  it('未参与家庭的人不能读取记录', async () => {
    await post({
      childId,
      type: 'feeding',
      occurredAt: '2026-10-16T02:00:00.000Z',
      payload: { method: 'breast' },
    }).expect(201)

    await request(app.getHttpServer())
      .get(`/api/families/${familyId}/events?childId=${childId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(403)
  })

  it('until 参数排除未来时间，findLatestByType 不会返回未来记录', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString()
    await post({ childId, type: 'feeding', occurredAt: future, payload: { method: 'breast' } }).expect(201)

    const res = await list(
      `childId=${childId}&type=feeding&until=${new Date().toISOString()}`,
    ).expect(200)
    expect(res.body.total).toBe(0)
  })

  it('按类型与时间排序返回（新的在前）', async () => {
    await post({
      childId,
      type: 'feeding',
      occurredAt: '2026-10-16T01:00:00.000Z',
      payload: { method: 'breast' },
    }).expect(201)
    await post({
      childId,
      type: 'feeding',
      occurredAt: '2026-10-16T03:00:00.000Z',
      payload: { method: 'bottle' },
    }).expect(201)

    const res = await list(`childId=${childId}&type=feeding`).expect(200)
    expect(res.body.items.map((e: { occurredAt: string }) => e.occurredAt)).toEqual([
      '2026-10-16T03:00:00.000Z',
      '2026-10-16T01:00:00.000Z',
    ])
  })

  it('可以只看某一个人记的（记录人筛选）', async () => {
    const member = await register('ev_writer2')
    await prisma.familyMember.create({ data: { familyId, userId: member.id, role: 'MEMBER' } })
    await post({
      childId,
      type: 'feeding',
      occurredAt: '2026-10-16T01:00:00.000Z',
      payload: { method: 'breast' },
    }).expect(201)
    await request(app.getHttpServer())
      .post(`/api/families/${familyId}/events`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ childId, type: 'feeding', occurredAt: '2026-10-16T02:00:00.000Z', payload: { method: 'bottle' } })
      .expect(201)

    const mine = await list(`createdBy=${me.id}&type=feeding`).expect(200)
    expect(mine.body.items.map((e: { createdBy: string }) => e.createdBy)).toEqual([me.id])

    // 不是这个家庭的成员、或根本不存在的人：筛出空列表，而不是报错——
    // 报错会把"这个 userId 存不存在"泄露给调用方。
    const stranger = await list(`createdBy=00000000-0000-4000-8000-000000000000`).expect(200)
    expect(stranger.body.items).toEqual([])
    expect(stranger.body.total).toBe(0)

    // 不是 UUID 的一律 400，不静默当成"没人记过"。
    await list('createdBy=not-a-uuid').expect(400)
  })

  it('编辑记录会重跑 payload 校验，并记下 updatedBy', async () => {
    const created = await post({
      childId,
      type: 'feeding',
      occurredAt: '2026-10-16T02:00:00.000Z',
      payload: { method: 'breast' },
    }).expect(201)

    await request(app.getHttpServer())
      .patch(`/api/families/${familyId}/events/${created.body.id}`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ payload: { method: 'bottle', bogus: 1 } })
      .expect(400)

    const ok = await request(app.getHttpServer())
      .patch(`/api/families/${familyId}/events/${created.body.id}`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ payload: { method: 'bottle', amountMl: 150 }, note: '改成瓶喂' })
      .expect(200)
    expect(ok.body.payload).toEqual({ method: 'bottle', amountMl: 150 })
    expect(ok.body.updatedBy).toBe(me.id)
  })

  it('MEMBER 不能改别人的记录，ADMIN 可以', async () => {
    const admin = await register('ev_admin1')
    const member = await register('ev_mem1')
    const created = await post({
      childId,
      type: 'feeding',
      occurredAt: '2026-10-16T02:00:00.000Z',
      payload: { method: 'breast' },
    }).expect(201)

    await prisma.familyMember.createMany({
      data: [
        { familyId, userId: admin.id, role: 'ADMIN' },
        { familyId, userId: member.id, role: 'MEMBER' },
      ],
    })

    await request(app.getHttpServer())
      .patch(`/api/families/${familyId}/events/${created.body.id}`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ note: '我要改' })
      .expect(403)

    await request(app.getHttpServer())
      .delete(`/api/families/${familyId}/events/${created.body.id}`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(403)

    await request(app.getHttpServer())
      .patch(`/api/families/${familyId}/events/${created.body.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ note: '管理员改的' })
      .expect(200)
  })

  it('分页参数生效，且 pageSize 有上限', async () => {
    for (const hour of ['01', '02', '03']) {
      await post({
        childId,
        type: 'feeding',
        occurredAt: `2026-10-16T${hour}:00:00.000Z`,
        payload: { method: 'breast' },
      }).expect(201)
    }
    const page1 = await list(`childId=${childId}&page=1&pageSize=2`).expect(200)
    expect(page1.body.total).toBe(3)
    expect(page1.body.items).toHaveLength(2)
    expect(page1.body.page).toBe(1)
    expect(page1.body.pageSize).toBe(2)

    await list(`childId=${childId}&pageSize=100000`).expect(400)
  })
})
