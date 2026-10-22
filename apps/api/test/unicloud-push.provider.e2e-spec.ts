import { Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../src/prisma/prisma.service'
import { UnicloudPushProvider } from '../src/push/unicloud-push.provider'

const CID_ONE = 'CID_OWNER_AAAA'
const CID_TWO = 'CID_OWNER_BBBB'
const URL = 'https://env-00jy6ygn8pw0.dev-hz.cloudbase.xyz/push/send'
const TOKEN = 'long-random-shared-secret'

interface RecordedCall {
  url: string
  headers: Record<string, string>
  body?: Record<string, unknown>
}

/** 假 fetch：把每次调用的 url/头/体记下来，返回值按传入序列走。 */
function fakeFetch(
  responses: Array<{ ok: boolean; status: number; json: unknown }> = [
    { ok: true, status: 200, json: { code: 0, msg: 'ok' } },
  ],
) {
  const calls: RecordedCall[] = []
  let index = 0
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    const res = responses[Math.min(index++, responses.length - 1)]
    return { ok: res.ok, status: res.status, json: async () => res.json }
  })
  return { fn, calls }
}

function makeProvider(options: {
  fetch: typeof fetch
  devices?: Array<{ clientId: string }>
  env?: Record<string, string | undefined>
  timeoutMs?: number
}) {
  const findMany = jest.fn(async () => options.devices ?? [])
  const prisma = { device: { findMany } } as unknown as PrismaService
  const env: Record<string, string | undefined> = {
    UNICLOUD_PUSH_URL: URL,
    UNICLOUD_PUSH_TOKEN: TOKEN,
    ...options.env,
  }
  const config = { get: (key: string) => env[key] } as unknown as ConfigService
  const provider = new UnicloudPushProvider(
    prisma,
    config,
    options.fetch,
    options.timeoutMs ?? 5_000,
  )
  return { provider, findMany }
}

describe('UnicloudPushProvider', () => {
  let debug: jest.SpyInstance
  let warn: jest.SpyInstance

  beforeEach(() => {
    debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const logged = () => [...debug.mock.calls, ...warn.mock.calls].map((c) => String(c[0]))
  const RESET_DATA = { kind: 'password_reset' }

  it('到点提醒默认不走服务端推送：一个请求都不发', async () => {
    const push = fakeFetch()
    const { provider, findMany } = makeProvider({ fetch: push.fn as never })

    await expect(
      provider.send('u1', '该喂奶了', '奶 120ml', { occurrenceId: 'occ-1' }),
    ).resolves.toBeUndefined()

    expect(push.fn).not.toHaveBeenCalled()
    expect(findMany).not.toHaveBeenCalled()
    expect(logged().join('\n')).toMatch(/本地定时/)
  })

  it('显式打开 PUSH_REMINDER_DUE 后，到点提醒才发', async () => {
    const push = fakeFetch()
    const { provider } = makeProvider({
      fetch: push.fn as never,
      devices: [{ clientId: CID_ONE }],
      env: { PUSH_REMINDER_DUE: 'true' },
    })

    await provider.send('u1', '该喂奶了', '奶 120ml', { occurrenceId: 'occ-1' })

    expect(push.fn).toHaveBeenCalledTimes(1)
  })

  it('用户没有登记过设备就不请求云函数，也不算错误', async () => {
    const push = fakeFetch()
    const { provider } = makeProvider({ fetch: push.fn as never, devices: [] })

    await expect(
      provider.send('u1', '有人需要重置密码', 'x 提交了请求', RESET_DATA),
    ).resolves.toBeUndefined()

    expect(push.fn).not.toHaveBeenCalled()
    expect(logged().join('\n')).toMatch(/没有登记设备/)
  })

  it('一个人的所有设备合成一次请求，头上带共享密钥', async () => {
    const push = fakeFetch()
    const { provider } = makeProvider({
      fetch: push.fn as never,
      devices: [{ clientId: CID_ONE }, { clientId: CID_TWO }],
    })

    await provider.send('u1', '有人需要重置密码', '张三提交了请求', {
      familyId: 'f1',
      kind: 'password_reset',
    })

    expect(push.calls).toHaveLength(1)
    const call = push.calls[0]
    expect(call.url).toBe(URL)
    expect(call.headers['x-push-token']).toBe(TOKEN)
    expect(call.body).toMatchObject({
      cids: [CID_ONE, CID_TWO],
      title: '有人需要重置密码',
      content: '张三提交了请求',
      payload: { familyId: 'f1', kind: 'password_reset' },
      ttl: 3_600_000,
    })
  })

  it('标题截到 20 字、正文截到 50 字：超限是 uniCloud 的硬限额，整条会被拒', async () => {
    const push = fakeFetch()
    const { provider } = makeProvider({
      fetch: push.fn as never,
      devices: [{ clientId: CID_ONE }],
    })
    const title = '标'.repeat(25)
    const content = '文'.repeat(60)

    await provider.send('u1', title, content, { kind: 'password_reset' })

    expect(push.calls[0].body).toMatchObject({
      title: '标'.repeat(20),
      content: '文'.repeat(50),
    })
  })

  it('payload 超过 800 字符时发空 payload 并 warn，消息本身照发', async () => {
    // 限额超了个推会整条拒收，而"收不到"比"点进去落回首页"糟得多。
    const push = fakeFetch()
    const { provider } = makeProvider({
      fetch: push.fn as never,
      devices: [{ clientId: CID_ONE }],
    })

    await provider.send('u1', 't', 'b', { blob: 'x'.repeat(900) })

    expect(push.calls[0].body).toMatchObject({ payload: {} })
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/payload 超长/))
  })

  it('云函数回非 0 码时只 warn，绝不上抛', async () => {
    const push = fakeFetch([
      { ok: true, status: 200, json: { code: 30002, msg: '不存在的 cid' } },
    ])
    const { provider } = makeProvider({
      fetch: push.fn as never,
      devices: [{ clientId: CID_ONE }],
    })

    await expect(
      provider.send('u1', 't', 'b', RESET_DATA),
    ).resolves.toBeUndefined()

    const text = logged().join('\n')
    expect(text).toContain('code=30002')
    expect(text).toContain(CID_ONE.slice(-6))
  })

  it('共享密钥不匹配（401）也说清是配置问题，不是个推的问题', async () => {
    const push = fakeFetch([{ ok: false, status: 401, json: { code: 401 } }])
    const { provider } = makeProvider({
      fetch: push.fn as never,
      devices: [{ clientId: CID_ONE }],
    })

    await expect(
      provider.send('u1', 't', 'b', RESET_DATA),
    ).resolves.toBeUndefined()

    expect(logged().join('\n')).toMatch(/PUSH_TOKEN.*不匹配/)
  })

  it('网络异常也吞掉，日志里留下 cid 与错误名', async () => {
    const boom = jest.fn(async () => {
      throw Object.assign(new Error('socket hang up'), { name: 'FetchError' })
    })
    const { provider } = makeProvider({
      fetch: boom as never,
      devices: [{ clientId: CID_ONE }, { clientId: CID_TWO }],
    })

    await expect(
      provider.send('u1', 't', 'b', RESET_DATA),
    ).resolves.toBeUndefined()

    const text = logged().join('\n')
    expect(text).toContain(CID_ONE.slice(-6))
    expect(text).toContain(CID_TWO.slice(-6))
    expect(text).toMatch(/code=FetchError/)
  })

  it('云函数挂住不回时按时放弃，绝不吊住找回密码那条请求', async () => {
    const hanging = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const { provider } = makeProvider({
      fetch: hanging as never,
      devices: [{ clientId: CID_ONE }],
      timeoutMs: 10,
    })

    await expect(
      provider.send('u1', 't', 'b', RESET_DATA),
    ).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalled()
  })

  it('日志只记正文长度，不记正文', async () => {
    const push = fakeFetch([{ ok: true, status: 200, json: { code: 40008, msg: 'fail' } }])
    const { provider } = makeProvider({
      fetch: push.fn as never,
      devices: [{ clientId: CID_ONE }],
    })
    const title = '有人需要重置密码'
    const body = '张三提交了找回密码请求'

    await provider.send('u1', title, body, { kind: 'password_reset' })

    const text = logged().join('\n')
    expect(text).not.toContain(title)
    expect(text).not.toContain(body)
    expect(text).toContain(`titleLen=${title.length}`)
    expect(text).toContain(`bodyLen=${body.length}`)
  })
})
