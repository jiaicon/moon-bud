import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { ASSISTANT_TEXT_MAX_LENGTH } from '@moonbud/shared'
import { AppModule } from '../src/app.module'
import { AssistantTimeoutError } from '../src/assistant/assistant-errors'
import {
  ASSISTANT_PROVIDER,
  type AssistantProvider,
  type AssistantRequest,
} from '../src/assistant/assistant-provider.interface'
import { NoopAssistantProvider } from '../src/assistant/noop-assistant.provider'
import { configureApp } from '../src/configure-app'
import { resetDatabase } from './utils/db'

// 必须赶在应用装配之前：节流上限是服务构造时从配置里读的，起来以后再改就晚了。
// 这一套里每个用例都用新注册的用户，所以只有"同一人连打三次"那条会撞到额度。
process.env.ASSISTANT_RATE_LIMIT = '2'

const parse = jest.fn(async (_req: AssistantRequest): Promise<unknown> => null)

const EVENT_DRAFT = {
  intent: 'event',
  event: {
    type: 'feeding',
    occurredAtWallClock: '2026-10-26T09:30',
    payload: { method: 'bottle', amountMl: 120 },
  },
}

describe('助手：POST /assistant/parse', () => {
  let app: INestApplication

  const register = async (username: string, timezone = 'Asia/Shanghai') => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username, password: 'pass12345', nickname: username, timezone })
      .expect(201)
    return { token: res.body.accessToken as string, id: res.body.user.id as string }
  }

  const post = (token: string, text: unknown) =>
    request(app.getHttpServer())
      .post('/api/assistant/parse')
      .set('Authorization', `Bearer ${token}`)
      .send({ text })

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ASSISTANT_PROVIDER)
      .useValue({ parse })
      .compile()
    app = moduleRef.createNestApplication()
    configureApp(app)
    await app.init()
  })

  beforeEach(() => {
    parse.mockReset()
  })

  afterAll(async () => {
    await resetDatabase()
    await app.close()
  })

  it('登录后一句话换成草稿', async () => {
    const me = await register('assistant_ok')
    parse.mockResolvedValue(EVENT_DRAFT)
    const res = await post(me.token, '刚才喂了 120 毫升').expect(200)
    expect(res.body.intent).toBe('event')
    expect(res.body.event.type).toBe('feeding')
    expect(res.body.dropped).toEqual([])
  })

  it('没带 token 是 401，不是 400', async () => {
    await request(app.getHttpServer()).post('/api/assistant/parse').send({ text: '喂奶 120' }).expect(401)
    expect(parse).not.toHaveBeenCalled()
  })

  it('空串、纯空白、超过 200 字都 400，中文文案', async () => {
    const me = await register('assistant_400')
    parse.mockResolvedValue(EVENT_DRAFT)
    for (const text of ['', '   ', '啊'.repeat(ASSISTANT_TEXT_MAX_LENGTH + 1)]) {
      const res = await post(me.token, text).expect(400)
      const joined = String(res.body.message)
      expect(joined).toMatch(/[\u4e00-\u9fa5]/)
      // 英文的 "text should not be empty" 会原样出现在锁屏通知里，那是这个产品明确不收的。
      expect(joined).not.toMatch(/[a-z]/i)
    }
    expect(parse).not.toHaveBeenCalled()
  })

  it('模型给的记录类型不认识 → 502 + ASSISTANT_BAD_OUTPUT', async () => {
    const me = await register('assistant_bad')
    parse.mockResolvedValue({
      intent: 'event',
      event: { type: 'vaccine', occurredAtWallClock: null, payload: {} },
    })
    const res = await post(me.token, '带娃打了疫苗').expect(502)
    expect(res.body.code).toBe('ASSISTANT_BAD_OUTPUT')
  })

  it('payload 不合格不挡路：200 回来，负载清空并标明 dropped', async () => {
    const me = await register('assistant_partial')
    parse.mockResolvedValue({
      intent: 'event',
      event: { type: 'medicine', occurredAtWallClock: null, payload: { name: '维D' } },
    })
    const res = await post(me.token, '喂了维D').expect(200)
    expect(res.body.event.payload).toEqual({})
    expect(res.body.dropped).toContain('event.payload')
  })

  it('模型回空对象（只认出类型）也照样是草稿，不判坏', async () => {
    const me = await register('assistant_thin')
    parse.mockResolvedValue({
      intent: 'event',
      event: { type: 'sleep', occurredAtWallClock: null, payload: {} },
    })
    const res = await post(me.token, '娃睡了').expect(200)
    expect(res.body.event.type).toBe('sleep')
    expect(res.body.event.payload).toEqual({})
  })

  it('通道没配（Noop）→ 503 + ASSISTANT_UNAVAILABLE', async () => {
    const me = await register('assistant_noop')
    // 走真 Noop 的实现（按接口类型拿它的 parse），而不是自己造一个同名的错误。
    const noop: AssistantProvider = new NoopAssistantProvider()
    parse.mockImplementation((req: AssistantRequest) => noop.parse(req))
    const res = await post(me.token, '喂奶 120').expect(503)
    expect(res.body.code).toBe('ASSISTANT_UNAVAILABLE')
  })

  it('上游超时 → 502 + ASSISTANT_TIMEOUT，不是 500 的裸错误', async () => {
    const me = await register('assistant_timeout')
    parse.mockRejectedValue(new AssistantTimeoutError())
    const res = await post(me.token, '喂奶 120').expect(502)
    expect(res.body.code).toBe('ASSISTANT_TIMEOUT')
  })

  it('额度用尽那次 429 并带上 code；换一个人不受影响', async () => {
    const me = await register('assistant_limit')
    parse.mockResolvedValue(EVENT_DRAFT)
    await post(me.token, '第一句').expect(200)
    await post(me.token, '第二句').expect(200)
    const res = await post(me.token, '第三句').expect(429)
    expect(res.body.code).toBe('ASSISTANT_RATE_LIMITED')
    expect(parse).toHaveBeenCalledTimes(2)

    const other = await register('assistant_other')
    await post(other.token, '我才说一句').expect(200)
  })

  it('时区是从账号读出来的，不是设备猜的', async () => {
    const me = await register('assistant_tz', 'America/New_York')
    parse.mockResolvedValue({ intent: 'unknown' })
    await post(me.token, '今天精神不错').expect(200)
    const req = parse.mock.calls[0]![0]
    expect(req.timezone).toBe('America/New_York')
    expect(req.userId).toBe(me.id)
    expect(req.now).toBeInstanceOf(Date)
    expect(req.text).toBe('今天精神不错')
  })
})
