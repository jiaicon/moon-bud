import type { INestApplication } from '@nestjs/common'
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
})
