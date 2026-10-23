import type { INestApplication } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'
import { PrismaService } from '../src/prisma/prisma.service'
import { NotificationsService } from '../src/notifications/notifications.service'

describe('通知', () => {
  let app: INestApplication
  let prisma: PrismaService
  let notifications: NotificationsService
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

  /** 造一条已经到期的提醒实例，供 createForOccurrence 使用。 */
  const seedOccurrence = async (assigneeId: string | null = null) => {
    const dueAt = new Date(Date.now() - 60_000)
    const reminder = await prisma.reminder.create({
      data: {
        familyId,
        title: '吃维D',
        note: '饭后吃',
        type: 'ONE_TIME',
        dueAt,
        timezone: 'Asia/Shanghai',
        assigneeId,
        createdBy: me.id,
      },
    })
    return prisma.reminderOccurrence.create({ data: { reminderId: reminder.id, dueAt } })
  }

  const list = (token: string, query = '') =>
    request(app.getHttpServer())
      .get(`/api/notifications${query}`)
      .set('Authorization', `Bearer ${token}`)

  /**
   * 带动作的到点实例。刻意用 prisma 直造而不走 HTTP：这一组要用到 T2 规则**禁止**的
   * 组合（有类型没孩子），读接口照样得把它说成"没动作"。
   */
  const seedActionOccurrence = async (
    opts: {
      childId?: string | null
      eventType?: string | null
      actionPayload?: Prisma.InputJsonValue
    } = {},
  ) => {
    const dueAt = new Date(Date.now() - 60_000)
    const reminder = await prisma.reminder.create({
      data: {
        familyId,
        childId: opts.childId ?? null,
        title: '吃维D',
        type: 'ONE_TIME',
        dueAt,
        timezone: 'Asia/Shanghai',
        createdBy: me.id,
        eventType: opts.eventType ?? null,
        actionPayload: opts.actionPayload ?? Prisma.DbNull,
      },
    })
    const occurrence = await prisma.reminderOccurrence.create({ data: { reminderId: reminder.id, dueAt } })
    return { reminderId: reminder.id, childId: reminder.childId, occurrenceId: occurrence.id }
  }

  const seedChild = async () =>
    prisma.child.create({
      data: { familyId, name: '宝宝', gender: 'UNKNOWN', birthday: new Date('2026-01-01') },
    })

  const read = (token: string, id: string) =>
    request(app.getHttpServer())
      .post(`/api/notifications/${id}/read`)
      .set('Authorization', `Bearer ${token}`)

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
    notifications = app.get(NotificationsService)
  })
  beforeEach(async () => {
    await resetDatabase()
    me = await register('nt_me1')
    other = await register('nt_other1')
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

  it('初始没有未读通知', async () => {
    const res = await list(me.token).expect(200)
    expect(res.body.total).toBe(0)
    expect(res.body.items).toEqual([])
  })

  it('只能看到发给自己的通知', async () => {
    await join(other)
    const occ = await seedOccurrence()
    expect(await notifications.createForOccurrence(occ.id)).toBe(2)

    const mine = await list(me.token).expect(200)
    const theirs = await list(other.token).expect(200)
    expect(mine.body.total).toBe(1)
    expect(theirs.body.total).toBe(1)
    expect(mine.body.items[0].userId).toBe(me.id)
    expect(theirs.body.items[0].userId).toBe(other.id)
    // 同一条实例的通知内容一致，但各自只有一条。
    expect(mine.body.items[0].occurrenceId).toBe(occ.id)
    expect(mine.body.items[0].title).toBe('吃维D')
  })

  it('read-all 对空列表返回 updated: 0', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200)
    expect(res.body).toEqual({ updated: 0 })
  })

  it('assigneeId 非空时只通知该成员，不打扰全家', async () => {
    await join(other)
    const occ = await seedOccurrence(other.id)
    expect(await notifications.createForOccurrence(occ.id)).toBe(1)

    expect((await list(me.token).expect(200)).body.total).toBe(0)
    expect((await list(other.token).expect(200)).body.total).toBe(1)
  })

  it('unreadOnly 只返回未读，读完就不在里面了', async () => {
    const occ = await seedOccurrence()
    await notifications.createForOccurrence(occ.id)

    const before = await list(me.token, '?unreadOnly=true').expect(200)
    expect(before.body.total).toBe(1)
    const id = before.body.items[0].id as string

    const read = await request(app.getHttpServer())
      .post(`/api/notifications/${id}/read`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200)
    expect(read.body.readAt).not.toBeNull()

    expect((await list(me.token, '?unreadOnly=true').expect(200)).body.total).toBe(0)
    expect((await list(me.token, '?unreadOnly=false').expect(200)).body.total).toBe(1)
  })

  it('不能把别人的通知标记为已读，也不能借着 read-all 影响别人', async () => {
    await join(other)
    const occ = await seedOccurrence()
    await notifications.createForOccurrence(occ.id)

    const theirs = (await list(other.token).expect(200)).body.items[0]
    await request(app.getHttpServer())
      .post(`/api/notifications/${theirs.id}/read`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(404)

    const stillUnread = await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })
    expect(stillUnread.readAt).toBeNull()

    const all = await request(app.getHttpServer())
      .post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200)
    expect(all.body.updated).toBe(1)
    const untouched = await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })
    expect(untouched.readAt).toBeNull()
  })

  it('通知按时间倒序分页', async () => {
    const occ = await seedOccurrence()
    await notifications.createForOccurrence(occ.id)
    const occ2 = await seedOccurrence()
    await notifications.createForOccurrence(occ2.id)

    const page = await list(me.token, '?page=1&pageSize=1').expect(200)
    expect(page.body.total).toBe(2)
    expect(page.body.items).toHaveLength(1)
    expect(page.body.pageSize).toBe(1)
    expect(page.body.items[0].occurrenceId).toBe(occ2.id)
  })

  it('未登录读不到任何通知', async () => {
    await request(app.getHttpServer()).get('/api/notifications').expect(401)
    await request(app.getHttpServer()).post('/api/notifications/read-all').expect(401)
  })

  it('到点通知带出这条提醒的动作', async () => {
    const child = await seedChild()
    const seeded = await seedActionOccurrence({
      childId: child.id,
      eventType: 'medicine',
      actionPayload: { name: '维D', dose: '400IU' },
    })
    await notifications.createForOccurrence(seeded.occurrenceId)

    const res = await list(me.token, '?unreadOnly=true').expect(200)
    expect(res.body.items[0].action).toEqual({
      reminderId: seeded.reminderId,
      childId: child.id,
      eventType: 'medicine',
      payload: { name: '维D', dose: '400IU' },
    })
  })

  it('孩子已归档时 action.payload 置空：到点只许给「去记一笔」', async () => {
    // 这一刀只能由服务端来切：客户端的孩子列表接口本来就不返回归档孩子
    // （children.service 过滤 archivedAt: null），所以它永远"看不见"归档这回事，
    // 而 events.service 对归档孩子是 400 —— 给了「记一笔」就是许一个必然落空的愿。
    const child = await seedChild()
    const seeded = await seedActionOccurrence({
      childId: child.id,
      eventType: 'medicine',
      actionPayload: { name: '维D', dose: '400IU' },
    })
    await notifications.createForOccurrence(seeded.occurrenceId)
    await prisma.child.update({ where: { id: child.id }, data: { archivedAt: new Date() } })

    const res = await list(me.token, '?unreadOnly=true').expect(200)
    expect(res.body.items[0].action).toEqual({
      reminderId: seeded.reminderId,
      childId: child.id,
      eventType: 'medicine',
      payload: null,
    })
  })

  it('没有动作的到点通知 action 为 null', async () => {
    const occ = await seedOccurrence()
    await notifications.createForOccurrence(occ.id)

    const res = await list(me.token, '?unreadOnly=true').expect(200)
    expect(res.body.items[0].action).toBeNull()
  })

  it('payload 为空的带动作提醒，action.payload 是 null（到点要跳表单）', async () => {
    const child = await seedChild()
    const seeded = await seedActionOccurrence({ childId: child.id, eventType: 'medicine' })
    await notifications.createForOccurrence(seeded.occurrenceId)

    const res = await list(me.token, '?unreadOnly=true').expect(200)
    expect(res.body.items[0].action).toEqual({
      reminderId: seeded.reminderId,
      childId: child.id,
      eventType: 'medicine',
      payload: null,
    })
  })

  it('家庭级提醒（childId 为 null 的老数据）不产生 action', async () => {
    // 库里可能存在这种历史脏行：回一个 childId 为 null 的 action，客户端只会写库失败。
    const seeded = await seedActionOccurrence({ eventType: 'medicine' })
    await notifications.createForOccurrence(seeded.occurrenceId)

    const res = await list(me.token, '?unreadOnly=true').expect(200)
    expect(res.body.items[0].action).toBeNull()
  })

  it('找回密码那类通知（不挂在任何实例上）action 为 null', async () => {
    await prisma.notification.create({
      data: { userId: me.id, familyId, occurrenceId: null, title: '有人申请找回密码', body: 'B' },
    })

    const res = await list(me.token).expect(200)
    expect(res.body.items[0].action).toBeNull()
  })

  it('markRead 的返回同样带 action', async () => {
    const child = await seedChild()
    const seeded = await seedActionOccurrence({
      childId: child.id,
      eventType: 'medicine',
      actionPayload: { name: '维D', dose: '400IU' },
    })
    await notifications.createForOccurrence(seeded.occurrenceId)
    const id = (await list(me.token).expect(200)).body.items[0].id as string

    const res = await read(me.token, id).expect(200)
    expect(res.body.action).toEqual({
      reminderId: seeded.reminderId,
      childId: child.id,
      eventType: 'medicine',
      payload: { name: '维D', dose: '400IU' },
    })
  })
})
