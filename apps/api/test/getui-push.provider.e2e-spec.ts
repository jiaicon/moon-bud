import { Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../src/prisma/prisma.service'
import { GetuiPushProvider } from '../src/push/getui-push.provider'

const CID_ONE = 'CID_OWNER_AAAA'
const CID_TWO = 'CID_OWNER_BBBB'

interface RecordedCall {
  url: string
  body?: Record<string, unknown>
}

/**
 * 假 fetch：按 URL 尾巴决定回什么，并把每次调用记下来。
 * 断言只看 URL 序列与请求体，不去猜个推的内部行为。
 */
function fakeFetch(
  pushes: Array<{ ok: boolean; status: number; json: unknown }> = [
    { ok: true, status: 200, json: { code: 0, result: 'ok', taskid: 't' } },
  ],
) {
  const calls: RecordedCall[] = []
  let pushIndex = 0
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('/v2/AppIDXYZ')[1]
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url: path, body })
    if (path.endsWith('/auth')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, data: { token: 'TOKEN_1' } }),
      }
    }
    const res = pushes[Math.min(pushIndex++, pushes.length - 1)]
    return {
      ok: res.ok,
      status: res.status,
      json: async () => res.json,
    }
  })
  return { fn, calls, paths: () => calls.map((c) => c.url) }
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
    GETUI_APPID: 'AppIDXYZ',
    GETUI_APPKEY: 'appkey',
    GETUI_MASTER_SECRET: 'mastersecret',
    ...options.env,
  }
  const config = { get: (key: string) => env[key] } as unknown as ConfigService
  const provider = new GetuiPushProvider(
    prisma,
    config,
    options.fetch,
    options.timeoutMs ?? 5_000,
  )
  return { provider, findMany }
}

const AUTH = '/auth'
const PUSH = '/push/single/cid'

describe('GetuiPushProvider', () => {
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

    expect(push.paths()).toEqual([AUTH, PUSH])
  })

  it('用户没有登记过设备就不请求个推，也不算错误', async () => {
    const push = fakeFetch()
    const { provider } = makeProvider({ fetch: push.fn as never, devices: [] })

    await expect(
      provider.send('u1', '有人需要重置密码', 'x 提交了请求', { kind: 'password_reset' }),
    ).resolves.toBeUndefined()

    expect(push.fn).not.toHaveBeenCalled()
    expect(logged().join('\n')).toMatch(/没有登记设备/)
  })

  it('token 只取一次，第二次发送不再鉴权', async () => {
    const push = fakeFetch()
    const { provider } = makeProvider({
      fetch: push.fn as never,
      devices: [{ clientId: CID_ONE }],
    })

    await provider.send('u1', 't1', 'b1', { kind: 'password_reset' })
    await provider.send('u1', 't2', 'b2', { kind: 'password_reset' })

    expect(push.paths()).toEqual([AUTH, PUSH, PUSH])
  })

  it('鉴权失败时重取一次 token 并重发', async () => {
    const push = fakeFetch([
      { ok: false, status: 401, json: { code: 'FAILED_AUTHENTICATION', result: 'fail' } },
      { ok: true, status: 200, json: { code: 0, result: 'ok' } },
    ])
    const { provider } = makeProvider({
      fetch: push.fn as never,
      devices: [{ clientId: CID_ONE }],
    })

    await provider.send('u1', 't', 'b', { kind: 'password_reset' })

    expect(push.paths()).toEqual([AUTH, PUSH, AUTH, PUSH])
    expect(warn).not.toHaveBeenCalled()
  })

  it('token 过期只回一个数字码时也要重取凭证，不能从此永远停发', async () => {
    // 个推把"token 失效"当成一次普通失败：HTTP 200 + 数字 code，响应里没有任何 AUTH 字样。
    // 只在 401/AUTH 时重取的话，缓存里那张过期 token 会一直被用下去——容器不重启就永远发不出去，
    // 而日志只说"推送失败"，没人指得根因。
    const push = fakeFetch([
      { ok: true, status: 200, json: { code: 10001, result: 'error', msg: 'token 已失效' } },
      { ok: true, status: 200, json: { code: 0, result: 'ok' } },
    ])
    const { provider } = makeProvider({
      fetch: push.fn as never,
      devices: [{ clientId: CID_ONE }],
    })

    await provider.send('u1', 't', 'b', { kind: 'password_reset' })

    expect(push.paths()).toEqual([AUTH, PUSH, AUTH, PUSH])
    expect(warn).not.toHaveBeenCalled()
  })

  it('重取 token 仍失败只 warn，绝不上抛', async () => {
    const push = fakeFetch([
      { ok: false, status: 401, json: { code: 'FAILED_AUTHENTICATION', result: 'fail' } },
    ])
    const { provider } = makeProvider({
      fetch: push.fn as never,
      devices: [{ clientId: CID_ONE }],
    })

    await expect(
      provider.send('u1', 't', 'b', { kind: 'password_reset' }),
    ).resolves.toBeUndefined()

    expect(push.paths()).toEqual([AUTH, PUSH, AUTH, PUSH])
    const text = logged().join('\n')
    expect(text).toContain(CID_ONE.slice(-6))
    expect(text).toContain('FAILED_AUTHENTICATION')
  })

  it('个推侧网络异常也吞掉，日志里留下 cid 与错误码', async () => {
    const boom = jest.fn(async () => {
      throw Object.assign(new Error('socket hang up'), { name: 'FetchError' })
    })
    const { provider } = makeProvider({
      fetch: boom as never,
      devices: [{ clientId: CID_ONE }, { clientId: CID_TWO }],
    })

    await expect(
      provider.send('u1', 't', 'b', { kind: 'password_reset' }),
    ).resolves.toBeUndefined()

    const text = logged().join('\n')
    expect(text).toContain(CID_ONE.slice(-6))
    expect(text).toContain(CID_TWO.slice(-6))
    expect(text).toMatch(/code=FetchError/)
  })

  it('个推挂住不回时按时放弃，绝不吊住找回密码那条请求', async () => {
    // 这个 await 在 HTTP handler 里：个推连上不回又不设超时，找回密码的请求就一直挂着，
    // 调度器的 tick() 也跟着停。假 fetch 只在 signal 触发 abort 时才 reject——没带超时就永远挂住。
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
      provider.send('u1', 't', 'b', { kind: 'password_reset' }),
    ).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalled()
  })

  it('日志只记正文长度，不记正文', async () => {
    const push = fakeFetch([
      { ok: true, status: 200, json: { code: 10001, result: 'error', msg: '不存在的 cid' } },
    ])
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

  it('一个人的所有设备合在同一个请求里，且每次 request_id 唯一', async () => {
    const push = fakeFetch()
    const { provider } = makeProvider({
      fetch: push.fn as never,
      devices: [{ clientId: CID_ONE }, { clientId: CID_TWO }],
    })

    await provider.send('u1', 't', 'b', { kind: 'password_reset' })
    await provider.send('u1', 't', 'b', { kind: 'password_reset' })

    const pushBodies = push.calls
      .filter((c) => c.url.endsWith(PUSH))
      .map((c) => c.body as Record<string, any>)
    expect(pushBodies).toHaveLength(2)
    expect(pushBodies[0].audience).toEqual({ cid: [CID_ONE, CID_TWO] })
    expect(pushBodies[0].request_id).not.toBe(pushBodies[1].request_id)
    expect(pushBodies[1].request_id).not.toBe('')
  })

  it('payload 原样进 transmission，客户端靠它分流', async () => {
    const push = fakeFetch()
    const { provider } = makeProvider({
      fetch: push.fn as never,
      devices: [{ clientId: CID_ONE }],
    })
    const data = { familyId: randomUUID(), kind: 'password_reset' }

    await provider.send('u1', 't', 'b', data)

    const pushBody = push.calls.find((c) => c.url.endsWith(PUSH))?.body as Record<string, any>
    expect(JSON.parse(pushBody.push_message.android.transmission)).toEqual(data)
  })
})
