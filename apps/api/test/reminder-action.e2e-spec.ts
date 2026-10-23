import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'

/**
 * 提醒的"到点顺手记"动作在写入时的四条规则：
 * 有类型必须有孩子；预填非空必须过该类型的完整校验；没有类型就没有预填；
 * 改类型等于换了一件事，旧预填不能跟着走。
 */
describe('提醒的固定动作', () => {
  let app: INestApplication
  let me: { token: string; id: string }
  let familyId: string
  let childId: string

  const register = async (username: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username, password: 'pass12345', nickname: username, timezone: 'Asia/Shanghai' })
      .expect(201)
    return { token: res.body.accessToken as string, id: res.body.user.id as string }
  }

  const isoPlusMinute = () => new Date(Date.now() + 60_000).toISOString()

  /** 默认挂孩子：只有"带动作必须有孩子"那一条会把它显式改成 null。 */
  const postReminder = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/families/${familyId}/reminders`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ title: '吃维D', type: 'ONE_TIME', dueAt: isoPlusMinute(), childId, ...body })

  const patchReminder = (id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/api/families/${familyId}/reminders/${id}`)
      .set('Authorization', `Bearer ${me.token}`)
      .send(body)

  beforeAll(async () => {
    app = await createTestApp()
  })
  beforeEach(async () => {
    await resetDatabase()
    me = await register('act_me1')
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

  it('合法的 actionPayload 原样回读', async () => {
    const res = await postReminder({
      eventType: 'medicine',
      actionPayload: { name: '维D', dose: '400IU' },
    }).expect(201)
    expect(res.body.eventType).toBe('medicine')
    expect(res.body.actionPayload).toEqual({ name: '维D', dose: '400IU' })
  })

  it('只带类型、不带 payload：动作存在，预填为空', async () => {
    const res = await postReminder({ eventType: 'medicine' }).expect(201)
    expect(res.body.eventType).toBe('medicine')
    expect(res.body.actionPayload).toBeNull()
  })

  it('payload 过不了该类型的完整校验就 400，且说清缺什么', async () => {
    const res = await postReminder({ eventType: 'medicine', actionPayload: { name: '维D' } }).expect(400)
    expect(JSON.stringify(res.body.message)).toContain('dose')
  })

  it('生长发育的空 payload 判成不合法（必填项为空不等于"能直接记"）', async () => {
    await postReminder({ eventType: 'growth', actionPayload: {} }).expect(400)
  })

  it('带动作的提醒必须挂在某个孩子上', async () => {
    await postReminder({ childId: null, eventType: 'medicine' }).expect(400)
  })

  it('未知的记录类型 400', async () => {
    await postReminder({ eventType: 'nap' }).expect(400)
  })

  it('只带预填、不带类型 400（不静默丢掉用户填过的东西）', async () => {
    await postReminder({ actionPayload: { name: '维D', dose: '400IU' } }).expect(400)
  })

  it('PATCH 改 eventType 会清掉旧 actionPayload，同一请求带上新 payload 则保留', async () => {
    const created = await postReminder({
      eventType: 'medicine',
      actionPayload: { name: '维D', dose: '400IU' },
    }).expect(201)

    const cleared = await patchReminder(created.body.id as string, { eventType: 'temperature' }).expect(200)
    expect(cleared.body.actionPayload).toBeNull()

    const kept = await patchReminder(created.body.id as string, {
      eventType: 'medicine',
      actionPayload: { name: '维D', dose: '400IU' },
    }).expect(200)
    expect(kept.body.actionPayload).toEqual({ name: '维D', dose: '400IU' })
  })

  it('PATCH 把 eventType 置 null 会连 payload 一起清掉', async () => {
    const created = await postReminder({
      eventType: 'medicine',
      actionPayload: { name: '维D', dose: '400IU' },
    }).expect(201)

    const res = await patchReminder(created.body.id as string, { eventType: null }).expect(200)
    expect(res.body.eventType).toBeNull()
    expect(res.body.actionPayload).toBeNull()
  })

  it('PATCH 只改标题不动 eventType 时，动作原样留着', async () => {
    const created = await postReminder({
      eventType: 'medicine',
      actionPayload: { name: '维D', dose: '400IU' },
    }).expect(201)

    const res = await patchReminder(created.body.id as string, { title: '改个名' }).expect(200)
    expect(res.body.eventType).toBe('medicine')
    expect(res.body.actionPayload).toEqual({ name: '维D', dose: '400IU' })
  })
})
