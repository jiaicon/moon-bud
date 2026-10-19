import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'
import { PrismaService } from '../src/prisma/prisma.service'

describe('提醒', () => {
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
      .post(`/api/families/${familyId}/reminders`)
      .set('Authorization', `Bearer ${me.token}`)
      .send(body)

  const occurrences = (reminderId: string) =>
    request(app.getHttpServer())
      .get(`/api/families/${familyId}/reminders/${reminderId}/occurrences`)
      .set('Authorization', `Bearer ${me.token}`)

  const complete = (reminderId: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(`/api/families/${familyId}/reminders/${reminderId}/complete`)
      .set('Authorization', `Bearer ${me.token}`)
      .send(body)

  const list = (query = '') =>
    request(app.getHttpServer())
      .get(`/api/families/${familyId}/reminders${query}`)
      .set('Authorization', `Bearer ${me.token}`)

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
  })
  beforeEach(async () => {
    await resetDatabase()
    me = await register('rm_me1')
    other = await register('rm_other1')
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

  it('创建一次性提醒默认 ACTIVE 且记录时区', async () => {
    const res = await post({
      childId,
      title: '打疫苗',
      type: 'ONE_TIME',
      dueAt: '2026-12-01T01:00:00.000Z',
      timezone: 'Asia/Shanghai',
    }).expect(201)
    expect(res.body.status).toBe('ACTIVE')
    expect(res.body.timezone).toBe('Asia/Shanghai')
    expect(res.body.createdBy).toBe(me.id)
  })

  it('RECURRING 需要 rrule，ONE_TIME 需要 dueAt', async () => {
    await post({ childId, title: 'X', type: 'RECURRING', timezone: 'Asia/Shanghai' }).expect(400)
    await post({ childId, title: 'X', type: 'ONE_TIME', timezone: 'Asia/Shanghai' }).expect(400)
  })

  it('拒绝非法时区', async () => {
    await post({
      childId,
      title: 'X',
      type: 'ONE_TIME',
      dueAt: '2026-12-01T00:00:00.000Z',
      timezone: 'Not/AZone',
    }).expect(400)
  })

  /**
   * UpdateReminderDto 的 dueAt 是 `@IsOptional() @IsISO8601()`，而 @IsOptional 对 null
   * 是"跳过校验"：null 会一路走到 `new Date(null)`，得到 1970-01-01。提醒不报错，
   * 只是再也不会响——所以这里必须当场拒绝，而不是存下一个没人看得见的时刻。
   */
  it('PATCH 传 dueAt: null 会被拒绝，原来的时间还留着', async () => {
    const created = await post({
      childId,
      title: '打疫苗',
      type: 'ONE_TIME',
      dueAt: '2026-12-01T00:00:00.000Z',
    }).expect(201)

    await request(app.getHttpServer())
      .patch(`/api/families/${familyId}/reminders/${created.body.id}`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ dueAt: null })
      .expect(400)

    const after = await request(app.getHttpServer())
      .get(`/api/families/${familyId}/reminders/${created.body.id}`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200)
    expect(after.body.dueAt).toBe('2026-12-01T00:00:00.000Z')
  })

  it('省略 timezone 时取用户自己的时区', async () => {
    const res = await post({
      childId,
      title: 'X',
      type: 'ONE_TIME',
      dueAt: '2026-12-01T00:00:00.000Z',
    }).expect(201)
    expect(res.body.timezone).toBe('Asia/Shanghai')
  })

  it('完成一次性提醒后状态为 DONE，实例也标记完成', async () => {
    const r = await post({
      childId,
      title: '打疫苗',
      type: 'ONE_TIME',
      dueAt: '2026-12-01T00:00:00.000Z',
      timezone: 'Asia/Shanghai',
    }).expect(201)

    const done = await complete(r.body.id).expect(200)
    expect(done.body.status).toBe('DONE')

    const occ = await occurrences(r.body.id).expect(200)
    expect(occ.body).toHaveLength(1)
    expect(occ.body[0].status).toBe('DONE')
    expect(occ.body[0].completedBy).toBe(me.id)
    expect(occ.body[0].completedAt).toBeTruthy()
  })

  it('完成重复提醒只关本次实例，系列保持 ACTIVE', async () => {
    const r = await post({
      childId,
      title: '每天吃维D',
      type: 'RECURRING',
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
      timezone: 'Asia/Shanghai',
    }).expect(201)

    const occ = await occurrences(r.body.id).expect(200)
    expect(occ.body.length).toBeGreaterThan(0)

    const done = await complete(r.body.id, { occurrenceId: occ.body[0].id }).expect(200)
    expect(done.body.status).toBe('ACTIVE')

    const after = await occurrences(r.body.id).expect(200)
    const completed = after.body.find((o: { id: string }) => o.id === occ.body[0].id)
    expect(completed.status).toBe('DONE')
    expect(completed.completedBy).toBe(me.id)
  })

  it('不传 occurrenceId 时完成最早的一条待办实例', async () => {
    const r = await post({
      childId,
      title: '每天吃维D',
      type: 'RECURRING',
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
      timezone: 'Asia/Shanghai',
    }).expect(201)
    const before = await occurrences(r.body.id).expect(200)
    const earliest = before.body.filter((o: { status: string }) => o.status === 'PENDING')[0]

    await complete(r.body.id).expect(200)

    const after = await occurrences(r.body.id).expect(200)
    expect(after.body.find((o: { id: string }) => o.id === earliest.id).status).toBe('DONE')
  })

  it('改计划只清理未来未完成的实例，保留已完成历史', async () => {
    const r = await post({
      childId,
      title: '每天吃维D',
      type: 'RECURRING',
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
      timezone: 'Asia/Shanghai',
    }).expect(201)

    const occ = await occurrences(r.body.id).expect(200)
    const firstDue = occ.body[0].id
    await complete(r.body.id, { occurrenceId: firstDue }).expect(200)

    await request(app.getHttpServer())
      .patch(`/api/families/${familyId}/reminders/${r.body.id}`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' })
      .expect(200)

    const after = await occurrences(r.body.id).expect(200)
    expect(after.body.some((o: { id: string; status: string }) => o.id === firstDue && o.status === 'DONE')).toBe(true)
    expect(after.body.some((o: { status: string }) => o.status === 'PENDING')).toBe(false)
  })

  it('取消提醒后未触发的实例变为 SKIPPED，已完成保留', async () => {
    const r = await post({
      childId,
      title: 'X',
      type: 'RECURRING',
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
      timezone: 'Asia/Shanghai',
    }).expect(201)

    // 先让实例真实存在：取消的语义是对**已生成的实例**生效。
    const occ = await occurrences(r.body.id).expect(200)
    expect(occ.body.length).toBeGreaterThan(0)
    const doneId = occ.body[0].id
    await complete(r.body.id, { occurrenceId: doneId }).expect(200)

    await request(app.getHttpServer())
      .delete(`/api/families/${familyId}/reminders/${r.body.id}`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(204)

    const after = await occurrences(r.body.id).expect(200)
    expect(after.body.find((o: { id: string }) => o.id === doneId).status).toBe('DONE')
    expect(after.body.filter((o: { status: string }) => o.status === 'PENDING')).toEqual([])

    const listRes = await list('?status=CANCELLED').expect(200)
    expect(listRes.body.items.map((x: { id: string }) => x.id)).toContain(r.body.id)
  })

  it('status 过滤：OVERDUE 只捞到「有到期未完成实例」的活跃提醒', async () => {
    // 每天的提醒：刚创建时最近的实例已经过去 → 属于已过期。
    const overdue = await post({
      childId,
      title: '该吃的',
      type: 'RECURRING',
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
      timezone: 'Asia/Shanghai',
    }).expect(201)
    // 将来的一次性提醒：既没有实例，也没到期 → 不属于已过期。
    const future = await post({
      childId,
      title: '还没到',
      type: 'ONE_TIME',
      dueAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
      timezone: 'Asia/Shanghai',
    }).expect(201)
    // 触发生成实例
    await occurrences(overdue.body.id).expect(200)

    const res = await list('?status=OVERDUE').expect(200)
    const ids = res.body.items.map((x: { id: string }) => x.id)
    expect(ids).toContain(overdue.body.id)
    expect(ids).not.toContain(future.body.id)
  })

  it('assigneeId 必须是本家庭成员，childId 必须属于本家庭', async () => {
    await post({
      childId,
      title: 'X',
      type: 'ONE_TIME',
      dueAt: '2026-12-01T00:00:00.000Z',
      assigneeId: other.id,
    }).expect(400)

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

    await post({
      childId: c2.body.id,
      title: 'X',
      type: 'ONE_TIME',
      dueAt: '2026-12-01T00:00:00.000Z',
    }).expect(400)
  })

  it('不存在的实例与别家的提醒都返回 404', async () => {
    const r = await post({
      childId,
      title: 'X',
      type: 'RECURRING',
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
      timezone: 'Asia/Shanghai',
    }).expect(201)
    await occurrences(r.body.id).expect(200)

    await complete(r.body.id, {
      occurrenceId: '00000000-0000-0000-0000-000000000000',
    }).expect(404)

    const foreign = await request(app.getHttpServer())
      .post('/api/families')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ name: '别家' })
      .expect(201)
    const foreignReminder = await request(app.getHttpServer())
      .post(`/api/families/${foreign.body.id}/reminders`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({
        title: '别人的',
        type: 'ONE_TIME',
        dueAt: '2026-12-01T00:00:00.000Z',
        timezone: 'Asia/Shanghai',
      })
      .expect(201)

    await request(app.getHttpServer())
      .get(`/api/families/${familyId}/reminders/${foreignReminder.body.id}/occurrences`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(404)
  })

  it('非成员的每一个提醒端点都返回 403', async () => {
    const r = await post({
      childId,
      title: 'X',
      type: 'ONE_TIME',
      dueAt: '2026-12-01T00:00:00.000Z',
      timezone: 'Asia/Shanghai',
    }).expect(201)

    const endpoints: Array<[string, string]> = [
      ['get', `/api/families/${familyId}/reminders`],
      ['post', `/api/families/${familyId}/reminders`],
      ['get', `/api/families/${familyId}/reminders/${r.body.id}`],
      ['patch', `/api/families/${familyId}/reminders/${r.body.id}`],
      ['delete', `/api/families/${familyId}/reminders/${r.body.id}`],
      ['post', `/api/families/${familyId}/reminders/${r.body.id}/complete`],
      ['get', `/api/families/${familyId}/reminders/${r.body.id}/occurrences`],
    ]
    for (const [method, path] of endpoints) {
      await (request(app.getHttpServer()) as never as Record<string, (p: string) => request.Test>)
        [method](path)
        .set('Authorization', `Bearer ${other.token}`)
        .send({ title: 'x', type: 'ONE_TIME', dueAt: '2026-12-01T00:00:00.000Z' })
        .expect(403)
    }
  })

  it('重复触发实例生成是幂等的：两次读到的实例集合完全一致', async () => {
    const r = await post({
      childId,
      title: '每天吃维D',
      type: 'RECURRING',
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
      timezone: 'Asia/Shanghai',
    }).expect(201)

    const first = await occurrences(r.body.id).expect(200)
    const second = await occurrences(r.body.id).expect(200)
    expect(second.body.map((o: { id: string }) => o.id)).toEqual(
      first.body.map((o: { id: string }) => o.id),
    )
    expect(await prisma.reminderOccurrence.count({ where: { reminderId: r.body.id } })).toBe(
      first.body.length,
    )
  })
})
