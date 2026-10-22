import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'
import { PrismaService } from '../src/prisma/prisma.service'

const OWNER = {
  username: 'device_owner',
  nickname: '机主',
  timezone: 'Asia/Shanghai',
  passwordHash: 'not-a-real-hash',
}

describe('devices 表', () => {
  let app: INestApplication
  let prisma: PrismaService

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => resetDatabase())

  it('一台设备按 cid 记一行，并记得它属于谁', async () => {
    const user = await prisma.user.create({ data: OWNER })

    const device = await prisma.device.create({
      data: { userId: user.id, clientId: 'CID_DEVICE_ONE_01', platform: 'android' },
    })

    expect(device.clientId).toBe('CID_DEVICE_ONE_01')
    expect(device.userId).toBe(user.id)
  })

  it('cid 全库唯一：重装前同一台设备不会被记成两台', async () => {
    const user = await prisma.user.create({ data: OWNER })
    const data = { userId: user.id, clientId: 'CID_DEVICE_ONE_01', platform: 'android' }
    await prisma.device.create({ data })

    // 唯一冲突必须是 P2002，而不是"随便抛了个什么错"。
    await expect(prisma.device.create({ data })).rejects.toMatchObject({ code: 'P2002' })
  })
})

const CID = 'CID_OWNER_A1'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('设备注册接口', () => {
  let app: INestApplication
  let owner: { token: string }
  let other: { token: string }

  const register = async (username: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username, password: 'pass12345', nickname: username, timezone: 'Asia/Shanghai' })
      .expect(201)
    return { token: res.body.accessToken as string }
  }

  const report = (token: string, clientId = CID, platform = 'android') =>
    request(app.getHttpServer())
      .post('/api/devices/push-client')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientId, platform })

  const drop = (token: string, clientId = CID) =>
    request(app.getHttpServer())
      .delete('/api/devices/push-client')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientId })

  const list = (token: string) =>
    request(app.getHttpServer())
      .get('/api/devices/push-clients')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  // 每个用例都要重新建账号：beforeEach 清库会把 beforeAll 建的那两个用户一起清掉，
  // 留下的 token 指向已不存在的用户，断言就变成在测外键行为。
  beforeEach(async () => {
    await resetDatabase()
    owner = await register('device_owner_a')
    other = await register('device_owner_b')
  })

  it('没登录不能登记设备', async () => {
    await request(app.getHttpServer())
      .post('/api/devices/push-client')
      .send({ clientId: CID, platform: 'android' })
      .expect(401)
  })

  it('登记后列表里只有打码的 cid', async () => {
    await report(owner.token).expect(204)

    const body = (await list(owner.token)).body
    expect(body).toHaveLength(1)
    expect(body[0].maskedClientId).toBe(`…${CID.slice(-6)}`)
    expect(body[0].platform).toBe('android')
    // 完整 cid 一旦能从列表里读出来，"打码"就只是装饰。
    expect(JSON.stringify(body)).not.toContain(CID)
  })

  it('同一台设备重复上报只留一行，但会刷新报到时间', async () => {
    await report(owner.token).expect(204)
    const first = (await list(owner.token)).body[0].lastSeenAt as string

    await sleep(5)
    await report(owner.token).expect(204)

    const body = await list(owner.token)
    expect(body.body).toHaveLength(1)
    expect(new Date(body.body[0].lastSeenAt).getTime()).toBeGreaterThan(new Date(first).getTime())
  })

  it('同一台手机换了登录的人，设备就归后来者', async () => {
    await report(owner.token).expect(204)
    await report(other.token).expect(204)

    expect((await list(owner.token)).body).toHaveLength(0)
    expect((await list(other.token)).body).toHaveLength(1)
  })

  it('先前登录的人退出，删不掉已被别人接管的设备', async () => {
    await report(owner.token).expect(204)
    await report(other.token).expect(204)

    await drop(owner.token).expect(204)

    expect((await list(other.token)).body).toHaveLength(1)
  })

  it('注销没登记过的 cid 不报错：退出登录不该被推送状态卡住', async () => {
    await drop(owner.token, 'CID_NEVER_REPORTED_1').expect(204)
    expect((await list(owner.token)).body).toHaveLength(0)
  })

  it('cid 太短是客户端坏了，不当作合法登记', async () => {
    const res = await report(owner.token, 'short').expect(400)
    expect(res.body.message).toEqual(expect.arrayContaining([expect.stringMatching(/[一-龥]/)]))
  })

  it('目前只认 android 设备', async () => {
    await report(owner.token, CID, 'ios').expect(400)
  })
})
