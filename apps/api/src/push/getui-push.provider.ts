import { Injectable, Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import type { PrismaService } from '../prisma/prisma.service'
import { GETUI_BASE, buildAuthBody, buildPushBody } from './getui/getui-request'
import type { PushProvider } from './push-provider.interface'

/** 设备离线时消息在个推服务器上的存活时间：1 小时（spec 5.3）。 */
const TTL_MS = 3_600_000

/**
 * 一次个推往返的预算。`send()` 是被找回密码的 HTTP handler 直接 await 的，
 * 也是调度器 tick 里 fan-out 的一环：个推连上不回又不设超时，等于让一个
 * 第三方接口挂住整条请求和后面所有人的提醒。
 */
const REQUEST_TIMEOUT_MS = 5_000

interface GetuiJson {
  code?: number | string
  result?: string | boolean
  msg?: string
  data?: { token?: string }
}

/**
 * 个推 REST API v2（uni-push 2.0 的服务端）。
 *
 * 失败一律吞掉：通知是 fan-out 出来的，一个人的设备状态不该中断其他人，
 * 而且调度器的 `finally` 无条件置 `firedAt`，抛上去也换不来重试。
 */
@Injectable()
export class GetuiPushProvider implements PushProvider {
  private readonly logger = new Logger(GetuiPushProvider.name)
  private readonly appId: string
  private readonly appKey: string
  private readonly masterSecret: string
  private readonly pushCategory?: string
  private readonly pushReminderDue: boolean
  private token?: string

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly timeoutMs: number = REQUEST_TIMEOUT_MS,
  ) {
    this.appId = config.get<string>('GETUI_APPID') ?? ''
    this.appKey = config.get<string>('GETUI_APPKEY') ?? ''
    this.masterSecret = config.get<string>('GETUI_MASTER_SECRET') ?? ''
    this.pushCategory = config.get<string>('XIAOMI_PUSH_CATEGORY') || undefined
    this.pushReminderDue = config.get<string>('PUSH_REMINDER_DUE') === 'true'
  }

  async send(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    if (data?.occurrenceId && !this.pushReminderDue) {
      this.logger.debug(
        `[getui] 到点提醒由设备本地定时负责，服务端不发送（PUSH_REMINDER_DUE 未开）user=${userId}`,
      )
      return
    }

    const devices = await this.prisma.device.findMany({
      where: { userId },
      select: { clientId: true },
    })
    const cids = devices.map((device) => device.clientId)
    if (cids.length === 0) {
      this.logger.debug(`[getui] user=${userId} 没有登记设备，跳过推送`)
      return
    }

    try {
      await this.dispatch(cids, title, body, data ?? {})
    } catch (err) {
      this.warnFailure(cids, title, body, err instanceof Error ? err.name : String(err))
    }
  }

  private async dispatch(
    cids: string[],
    title: string,
    body: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    let response = await this.postPush(cids, title, body, data)
    let json = await readJson(response)

    if (!isOk(response, json)) {
      // 任何失败都先怀疑那张缓存的凭证：token 被个推提前作废时，响应可能是
      // HTTP 200 配一个数字码（也可能 401 配 FAILED_AUTHENTICATION），按码值去认
      // 等于赌文档没写错的错误族——赌输的代价是进程不重启就永远停发。
      // 换成"丢token→重取→再发一次"，最坏只多一个往返。
      // 具体鉴权错误码族仍待 spike 在真机上确认（见 HANDOFF）。
      this.token = undefined
      response = await this.postPush(cids, title, body, data)
      json = await readJson(response)
    }

    if (!isOk(response, json)) {
      this.warnFailure(cids, title, body, String(json?.code ?? response.status))
      return
    }
    this.logger.debug(
      `[getui] 已投递 devices=${cids.length} titleLen=${title.length} bodyLen=${body.length}`,
    )
  }

  /** 每次个推往返都带上超时：调用方在等，而个推挂住时不会自己醒。 */
  private withTimeout(init: RequestInit): RequestInit {
    return { ...init, signal: AbortSignal.timeout(this.timeoutMs) }
  }

  private async postPush(
    cids: string[],
    title: string,
    body: string,
    data: Record<string, unknown>,
  ): Promise<Response> {
    const token = await this.ensureToken()
    return this.fetchFn(
      `${GETUI_BASE(this.appId)}/push/single/cid`,
      this.withTimeout({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authentication: token },
        body: JSON.stringify(
          buildPushBody({
            cids,
            title,
            body,
            ttlMs: TTL_MS,
            requestId: randomUUID(),
            data,
            pushCategory: this.pushCategory,
          }),
        ),
      }),
    )
  }

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token
    const timestamp = String(Date.now())
    const res = await this.fetchFn(
      `${GETUI_BASE(this.appId)}/auth`,
      this.withTimeout({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildAuthBody(this.appKey, this.masterSecret, timestamp)),
      }),
    )
    const json = await readJson(res)
    const token = json?.data?.token
    if (!isOk(res, json) || !token) {
      throw new Error(`getui auth failed: ${String(json?.code ?? res.status)}`)
    }
    this.token = token
    return token
  }

  /** 日志里只留 cid 后 6 位和正文长度：通知正文写着娃吃了多少奶、谁在找回密码。 */
  private warnFailure(
    cids: string[],
    title: string,
    body: string,
    code: string,
  ): void {
    this.logger.warn(
      `[getui] 推送失败 code=${code} cid=[${cids
        .map((cid) => `…${cid.slice(-6)}`)
        .join(',')}] titleLen=${title.length} bodyLen=${body.length}`,
    )
  }
}

async function readJson(res: Response): Promise<GetuiJson | undefined> {
  try {
    return (await res.json()) as GetuiJson
  } catch {
    return undefined
  }
}

function isOk(res: Response, json?: GetuiJson): boolean {
  return res.ok && json?.code === 0
}
