import { Logger } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { PrismaModule } from '../src/prisma/prisma.module'
import { NoopPushProvider } from '../src/push/noop-push.provider'
import { PUSH_PROVIDER } from '../src/push/push-provider.interface'
import { PushModule } from '../src/push/push.module'

const PUSH_KEYS = [
  'GETUI_APPID',
  'GETUI_APPKEY',
  'GETUI_MASTER_SECRET',
  'XIAOMI_PUSH_CATEGORY',
  'PUSH_REMINDER_DUE',
]

const FULL_ENV = {
  GETUI_APPID: 'AppIDXYZ',
  GETUI_APPKEY: 'appkey',
  GETUI_MASTER_SECRET: 'mastersecret',
}

async function resolveProvider(env: Record<string, string>): Promise<string> {
  // 写 process.env 而不是 ConfigModule 的 load：ConfigService.get() 先查
  // process.env 再查 load 的结果，而 test/setup-env.ts 已经把根 .env 灌进了
  // process.env——用 load 的话测试测的是"变量被 .env 压住"这条不存在的路径。
  for (const key of PUSH_KEYS) delete process.env[key]
  Object.assign(process.env, env)

  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrismaModule, PushModule],
  }).compile()
  const provider = moduleRef.get<Record<string, never>>(PUSH_PROVIDER)
  await moduleRef.close()
  return provider.constructor.name
}

describe('推送通道绑定', () => {
  let log: jest.SpyInstance
  const saved: Record<string, string | undefined> = {}

  beforeAll(() => {
    for (const key of PUSH_KEYS) saved[key] = process.env[key]
  })

  afterAll(() => {
    for (const key of PUSH_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('三件套齐全就用个推', async () => {
    await expect(resolveProvider({ ...FULL_ENV })).resolves.toBe('GetuiPushProvider')
    expect(log.mock.calls.flat().join('\n')).toMatch(/推送通道：个推/)
  })

  it('少一个凭证就退回只写日志，而不是起一半', async () => {
    await expect(
      resolveProvider({ ...FULL_ENV, GETUI_MASTER_SECRET: '' }),
    ).resolves.toBe('NoopPushProvider')
  })

  it('一个都没配也退回只写日志，并把原因写在启动日志里', async () => {
    await expect(
      resolveProvider({
        GETUI_APPID: '',
        GETUI_APPKEY: '',
        GETUI_MASTER_SECRET: '',
      }),
    ).resolves.toBe('NoopPushProvider')
    expect(log.mock.calls.flat().join('\n')).toMatch(/推送通道：未配置凭证.*收不到任何通知/s)
  })

  it('没接通通道时也一样：日志里只留长度，不留通知正文', async () => {
    // 凭证没填的现在就是生产在跑的那条路径。正文里写着"张三提交了找回密码请求（家庭：奶奶家）"，
    // 原样进 docker logs 等于把家长的名字和住址性质信息永久留在日志里。
    const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
    const title = '有人需要重置密码'
    const body = '张三提交了找回密码请求（家庭：奶奶家）'

    await new NoopPushProvider().send('u1', title, body, { kind: 'password_reset' })

    const text = debug.mock.calls.flat().map(String).join('\n')
    expect(text).not.toContain(title)
    expect(text).not.toContain(body)
    expect(text).toContain(`titleLen=${title.length}`)
    expect(text).toContain(`bodyLen=${body.length}`)
  })
})
