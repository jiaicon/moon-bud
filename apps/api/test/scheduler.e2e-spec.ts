import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'
import { ReminderSchedulerService } from '../src/reminders/reminder-scheduler.service'
import { PrismaService } from '../src/prisma/prisma.service'

describe('提醒调度', () => {
  let app: INestApplication
  let scheduler: ReminderSchedulerService
  let prisma: PrismaService
  let me: { token: string; id: string }
  let familyId: string

  const register = async (username: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username, password: 'pass12345', nickname: username, timezone: 'Asia/Shanghai' })
      .expect(201)
    return { token: res.body.accessToken as string, id: res.body.user.id as string }
  }

  const createReminder = (body: Record<string, unknown>, token = me.token) =>
    request(app.getHttpServer())
      .post(`/api/families/${familyId}/reminders`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)

  const join = async (user: { token: string }) => {
    const inv = await request(app.getHttpServer())
      .post(`/api/families/${familyId}/invites`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ role: 'MEMBER' })
      .expect(201)
    await request(app.getHttpServer())
      .post(`/api/invites/${inv.body.code}/accept`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(201)
  }

  beforeAll(async () => {
    app = await createTestApp()
    scheduler = app.get(ReminderSchedulerService)
    prisma = app.get(PrismaService)
  })
  beforeEach(async () => {
    await resetDatabase()
    me = await register('sc_me1')
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

  it('到期的 ONE_TIME 提醒生成实例与通知', async () => {
    await createReminder({
      title: '打疫苗',
      type: 'ONE_TIME',
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      timezone: 'Asia/Shanghai',
    }).expect(201)

    const r = await scheduler.tick()
    expect(r.created).toBe(1)
    expect(r.notified).toBe(1)
    expect(await prisma.notification.count()).toBe(1)
  })

  it('重复 tick 不产生重复通知（幂等）', async () => {
    await createReminder({
      title: '打疫苗',
      type: 'ONE_TIME',
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      timezone: 'Asia/Shanghai',
    }).expect(201)

    await scheduler.tick()
    const second = await scheduler.tick()
    expect(second.created).toBe(0)
    expect(second.notified).toBe(0)
    expect(await prisma.notification.count()).toBe(1)
  })

  it('未到期的提醒不生成任何东西', async () => {
    await createReminder({
      title: '未来',
      type: 'ONE_TIME',
      dueAt: new Date(Date.now() + 3600_000).toISOString(),
      timezone: 'Asia/Shanghai',
    }).expect(201)

    expect(await scheduler.tick()).toEqual({ created: 0, notified: 0 })
  })

  it('非法 rrule 的提醒不影响其它提醒的处理，也不让 tick 抛错', async () => {
    await createReminder({
      title: '坏的',
      type: 'RECURRING',
      rrule: 'NOT A RRULE',
      timezone: 'Asia/Shanghai',
    }).expect(201)
    await createReminder({
      title: '好的',
      type: 'ONE_TIME',
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      timezone: 'Asia/Shanghai',
    }).expect(201)

    const r = await scheduler.tick()
    expect(r.created).toBe(1)
  })

  it('很久未跑的重复提醒不会一次展开成千上万条', async () => {
    await createReminder({
      title: '每分钟',
      type: 'RECURRING',
      rrule: 'FREQ=MINUTELY',
      timezone: 'Asia/Shanghai',
    }).expect(201)

    const r = await scheduler.tick()
    expect(r.created).toBeLessThanOrEqual(500)
  })

  it('提醒的执行人不为空时只通知该成员', async () => {
    const other = await register('sc_other1')
    await join(other)

    await createReminder({
      title: '只给他',
      type: 'ONE_TIME',
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      timezone: 'Asia/Shanghai',
      assigneeId: other.id,
    }).expect(201)

    await scheduler.tick()
    const n = await prisma.notification.findMany()
    expect(n).toHaveLength(1)
    expect(n[0].userId).toBe(other.id)
  })

  it('执行人退出家庭后，通知回到剩下的成员手里，不会消失也不会发给外人', async () => {
    const other = await register('sc_other2')
    await join(other)
    await createReminder({
      title: '交疫苗本',
      type: 'ONE_TIME',
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      timezone: 'Asia/Shanghai',
      assigneeId: other.id,
    }).expect(201)

    await request(app.getHttpServer())
      .post(`/api/families/${familyId}/leave`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(204)

    await scheduler.tick()
    const n = await prisma.notification.findMany()
    expect(n).toHaveLength(1)
    expect(n[0].userId).toBe(me.id)
  })

  it('归档家庭是硬边界：不再生成实例，也不再发通知', async () => {
    await createReminder({
      title: '归档后不该响',
      type: 'ONE_TIME',
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      timezone: 'Asia/Shanghai',
    }).expect(201)
    await request(app.getHttpServer())
      .post(`/api/families/${familyId}/archive`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200)

    const r = await scheduler.tick()
    expect(r).toEqual({ created: 0, notified: 0 })
    expect(await prisma.notification.count()).toBe(0)
    expect(await prisma.reminderOccurrence.count()).toBe(0)
  })
})
