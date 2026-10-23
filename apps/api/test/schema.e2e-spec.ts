import { PrismaClient } from '@prisma/client'
import { resetDatabase } from './utils/db'

const prisma = new PrismaClient()

// 每个用例前清库：否则第二次运行会因为上一轮残留的 username 撞唯一约束而失败，
// 也就是"测试只有在全新数据库上才通过"——那不是可重复的验证。
beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await resetDatabase()
  await prisma.$disconnect()
})

describe('数据库 schema', () => {
  it('users.username 唯一', async () => {
    await prisma.user.create({
      data: { username: 'schema_u1', passwordHash: 'x', nickname: 'A', timezone: 'Asia/Shanghai' },
    })
    await expect(
      prisma.user.create({
        data: { username: 'schema_u1', passwordHash: 'y', nickname: 'B', timezone: 'Asia/Shanghai' },
      }),
    ).rejects.toThrow()
  })

  it('同一家庭不能重复加入同一用户', async () => {
    const u = await prisma.user.create({
      data: { username: 'schema_u2', passwordHash: 'x', nickname: 'A', timezone: 'Asia/Shanghai' },
    })
    const f = await prisma.family.create({ data: { name: 'F', ownerId: u.id } })
    const data = { familyId: f.id, userId: u.id, role: 'OWNER' as const }
    await prisma.familyMember.create({ data })
    await expect(prisma.familyMember.create({ data })).rejects.toThrow()
  })

  it('occurrence 的 (reminder_id, due_at) 唯一 —— 幂等的基础', async () => {
    const u = await prisma.user.create({
      data: { username: 'schema_u3', passwordHash: 'x', nickname: 'A', timezone: 'Asia/Shanghai' },
    })
    const f = await prisma.family.create({ data: { name: 'F', ownerId: u.id } })
    const r = await prisma.reminder.create({
      data: {
        familyId: f.id,
        title: 'T',
        type: 'ONE_TIME',
        dueAt: new Date('2026-11-01T00:00:00Z'),
        timezone: 'Asia/Shanghai',
        createdBy: u.id,
      },
    })
    const dueAt = new Date('2026-11-01T00:00:00Z')
    await prisma.reminderOccurrence.create({ data: { reminderId: r.id, dueAt } })
    await expect(
      prisma.reminderOccurrence.create({ data: { reminderId: r.id, dueAt } }),
    ).rejects.toThrow()
  })

  it('events.payload 为 jsonb 且支持嵌套查询', async () => {
    const u = await prisma.user.create({
      data: { username: 'schema_u4', passwordHash: 'x', nickname: 'A', timezone: 'Asia/Shanghai' },
    })
    const f = await prisma.family.create({ data: { name: 'F', ownerId: u.id } })
    const c = await prisma.child.create({
      data: { familyId: f.id, name: '宝宝', birthday: new Date('2026-01-01') },
    })
    await prisma.event.create({
      data: {
        childId: c.id,
        familyId: f.id,
        type: 'feeding',
        occurredAt: new Date('2026-10-16T02:00:00Z'),
        payload: { method: 'bottle', amountMl: 120 },
        createdBy: u.id,
      },
    })
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM events WHERE payload->>'amountMl' = '120'
    `
    expect(Number(rows[0].n)).toBe(1)
  })

  it('提醒可以存一个动作，记录可以记住它是从哪条提醒来的', async () => {
    const u = await prisma.user.create({
      data: { username: 'schema_act1', passwordHash: 'x', nickname: 'A', timezone: 'Asia/Shanghai' },
    })
    const f = await prisma.family.create({ data: { name: 'F', ownerId: u.id } })
    const c = await prisma.child.create({
      data: { familyId: f.id, name: '大宝', gender: 'UNKNOWN', birthday: new Date('2025-01-01') },
    })
    const r = await prisma.reminder.create({
      data: {
        familyId: f.id,
        childId: c.id,
        title: '吃维D',
        type: 'ONE_TIME',
        dueAt: new Date(),
        timezone: 'Asia/Shanghai',
        createdBy: u.id,
        eventType: 'medicine',
        actionPayload: { name: '维D', dose: '400IU' },
      },
    })
    expect(r.eventType).toBe('medicine')
    expect(r.actionPayload).toEqual({ name: '维D', dose: '400IU' })

    const e = await prisma.event.create({
      data: {
        childId: c.id,
        familyId: f.id,
        type: 'medicine',
        occurredAt: new Date(),
        payload: { name: '维D', dose: '400IU' },
        createdBy: u.id,
        fromReminderId: r.id,
      },
    })
    expect(e.fromReminderId).toBe(r.id)
  })

  it('没有动作的提醒（老数据）读回来两者都是 null', async () => {
    const u = await prisma.user.create({
      data: { username: 'schema_act2', passwordHash: 'x', nickname: 'B', timezone: 'Asia/Shanghai' },
    })
    const f = await prisma.family.create({ data: { name: 'G', ownerId: u.id } })
    const r = await prisma.reminder.create({
      data: {
        familyId: f.id,
        title: '交疫苗本',
        type: 'ONE_TIME',
        dueAt: new Date(),
        timezone: 'Asia/Shanghai',
        createdBy: u.id,
      },
    })
    expect(r.eventType).toBeNull()
    expect(r.actionPayload).toBeNull()
  })
})
