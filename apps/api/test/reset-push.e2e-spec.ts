import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/configure-app'
import { PUSH_PROVIDER } from '../src/push/push-provider.interface'
import { resetDatabase } from './utils/db'

// 形参写全，mock.calls 才是四元组而不是空元组（断言里要按位取参数）。
const send = jest.fn(
  async (
    _userId: string,
    _title: string,
    _body: string,
    _data?: Record<string, unknown>,
  ) => undefined,
)

/**
 * 这里要的是"找回密码的请求确实送到了手机上"，所以把推送通道换成 spy。
 * `createTestApp()` 不给覆写口，本套件自己装配一次（其余路径与线上一致）。
 */
describe('找回密码请求的推送', () => {
  let app: INestApplication
  let manager: { token: string; id: string }
  let familyId: string

  const register = async (username: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username, password: 'pass12345', nickname: username, timezone: 'Asia/Shanghai' })
      .expect(201)
    return { token: res.body.accessToken as string, id: res.body.user.id as string }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PUSH_PROVIDER)
      .useValue({ send })
      .compile()
    app = moduleRef.createNestApplication()
    configureApp(app)
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await resetDatabase()
    send.mockReset()
    send.mockImplementation(async () => undefined)

    manager = await register('reset_push_manager')
    const seeker = await register('reset_push_seeker')
    const family = await request(app.getHttpServer())
      .post('/api/families')
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ name: '奶奶家' })
      .expect(201)
    familyId = family.body.id as string

    const inv = await request(app.getHttpServer())
      .post(`/api/families/${familyId}/invites`)
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ role: 'MEMBER' })
      .expect(201)
    await request(app.getHttpServer())
      .post(`/api/invites/${inv.body.code}/accept`)
      .set('Authorization', `Bearer ${seeker.token}`)
      .expect(201)
  })

  it('站内通知写成的同时，也给这位管理员的设备发一次推送', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/reset-request')
      .send({ username: 'reset_push_seeker' })
      .expect(202)

    expect(send).toHaveBeenCalledTimes(1)
    const [userId, title, body, data] = send.mock.calls[0]
    expect(userId).toBe(manager.id)
    expect(title).toBe('有人需要重置密码')
    expect(body).toContain('reset_push_seeker')
    // 没有 occurrenceId：Task 4 的"到点提醒不双发"门控不该把这一类也挡掉。
    // familyId 是客户端点通知后切家庭的依据，指错家庭等于把人带进 403。
    expect(data).toEqual({ familyId, kind: 'password_reset' })
  })
})
