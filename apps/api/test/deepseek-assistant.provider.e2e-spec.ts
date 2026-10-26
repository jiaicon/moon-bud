import { Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import {
  AssistantBadOutputError,
  AssistantTimeoutError,
  AssistantUnavailableError,
} from '../src/assistant/assistant-errors'
import type { AssistantProvider, AssistantRequest } from '../src/assistant/assistant-provider.interface'
import { DeepseekAssistantProvider } from '../src/assistant/deepseek-assistant.provider'
import { NoopAssistantProvider } from '../src/assistant/noop-assistant.provider'

const CFG = {
  get: (key: string) =>
    ({
      DEEPSEEK_API_KEY: 'k',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
      DEEPSEEK_MODEL: 'deepseek-flash',
    })[key],
} as unknown as ConfigService

const REQ: AssistantRequest = {
  userId: 'u1',
  text: '刚才喂了 120 毫升',
  timezone: 'Asia/Shanghai',
  now: new Date('2026-10-26T01:30:00.000Z'),
}

/** 只记调用、不联网：这一套跑在 CI 里，而真实上游要花钱、会限流、会变。 */
function fakeFetch(content: string) {
  return jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  })) as unknown as typeof fetch
}

function firstCall(fn: typeof fetch): { url: string; init: RequestInit } {
  const call = (fn as jest.Mock).mock.calls[0]
  return { url: String(call[0]), init: call[1] as RequestInit }
}

describe('DeepseekAssistantProvider', () => {
  let logs: string[]
  let spy: jest.SpyInstance

  beforeEach(() => {
    logs = []
    spy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '))
      })
    jest.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
  })

  afterEach(() => {
    spy.mockRestore()
    jest.restoreAllMocks()
  })

  it('请求体带上密钥、JSON 模式、temperature 0，并把模型回的字符串解析成对象', async () => {
    const draft = { intent: 'event', event: { type: 'feeding', occurredAtWallClock: null, payload: {} } }
    const fn = fakeFetch(JSON.stringify(draft))
    const provider = new DeepseekAssistantProvider(CFG, fn)

    await expect(provider.parse(REQ)).resolves.toEqual(draft)

    const { url, init } = firstCall(fn)
    expect(url).toContain('/chat/completions')
    const headers = Object.fromEntries(
      Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    )
    expect(headers.authorization).toBe('Bearer k')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('deepseek-flash')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.temperature).toBe(0)
  })

  it('模型回的不是 JSON → AssistantBadOutputError，且日志里没有用户原话', async () => {
    const provider = new DeepseekAssistantProvider(CFG, fakeFetch('抱歉我做不到'))
    await expect(provider.parse(REQ)).rejects.toBeInstanceOf(AssistantBadOutputError)
    expect(logs.join('\n')).not.toContain(REQ.text)
  })

  it('非 2xx → AssistantBadOutputError（上游 401/429/5xx 都归这里）', async () => {
    const fn = jest.fn(async () => new Response('{"error":1}', { status: 401 })) as unknown as typeof fetch
    await expect(new DeepseekAssistantProvider(CFG, fn).parse(REQ)).rejects.toBeInstanceOf(
      AssistantBadOutputError,
    )
  })

  it('超时 → AssistantTimeoutError', async () => {
    // 真实的 fetch 由 signal 把请求掐掉并以 name==='TimeoutError' 拒绝；假 fetch 必须
    // 照做，否则它永远"成功返回"，被测的这条路径根本走不到。
    const slow = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve(new Response('{}')), 50)
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new DOMException('timeout', 'TimeoutError'))
          })
        }),
    ) as unknown as typeof fetch
    await expect(new DeepseekAssistantProvider(CFG, slow, 10).parse(REQ)).rejects.toBeInstanceOf(
      AssistantTimeoutError,
    )
  })

  it('没配密钥时 Noop 抛 AssistantUnavailableError', async () => {
    const provider: AssistantProvider = new NoopAssistantProvider()
    await expect(provider.parse(REQ)).rejects.toBeInstanceOf(AssistantUnavailableError)
  })
})
