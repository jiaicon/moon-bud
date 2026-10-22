import { Injectable, Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import type { PushProvider } from './push-provider.interface'

/** 设备离线时消息在推送服务上的存活时间：1 小时（spec 5.3）。 */
const TTL_MS = 3_600_000

/** 一次云函数往返的预算。 */
const REQUEST_TIMEOUT_MS = 5_000

/**
 * uniCloud sendMessage 的硬限额（官方 api 文档）：超出不是截断，是整条拒收。
 * 所以截断发生在发出去之前，而不是等云函数回一个错误码。
 */
const TITLE_MAX = 20
const CONTENT_MAX = 50
const PAYLOAD_MAX = 800

/** 按码点截断，避免把 emoji 的对子截成半个。 */
function clamp(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length <= max ? value : chars.slice(0, max).join('')
}

interface PushJson {
  code?: number | string
  msg?: string
}

/**
 * uni-push 2.0 的服务端通道：调我们自己 URL 化的 uniCloud 云函数。
 *
 * 为什么不是直连个推 REST：DCloud 官方明确"使用 uni-push 2.0，服务端不支持用个推
 * api 推送，只能用 dcloud 提供的服务端（云函数）推送"，2.0 的应用也根本没有
 * 个推 MasterSecret（实测停在 `sign is invalid`）。云函数免鉴权，所以两侧只需要
 * 一个我们自己约定的共享密钥头，防止 URL 化出来的公网地址被人乱调。
 *
 * 失败一律吞掉：通知是 fan-out 出来的，一个人的设备状态不该中断其他人，
 * 而且调度器的 `finally` 无条件置 `firedAt`，抛上去也换不来重试。
 */
@Injectable()
export class UnicloudPushProvider implements PushProvider {
  private readonly logger = new Logger(UnicloudPushProvider.name)
  private readonly url: string
  private readonly token: string
  private readonly pushReminderDue: boolean

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly timeoutMs: number = REQUEST_TIMEOUT_MS,
  ) {
    this.url = config.get<string>('UNICLOUD_PUSH_URL') ?? ''
    this.token = config.get<string>('UNICLOUD_PUSH_TOKEN') ?? ''
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
        `[unicloud] 到点提醒由设备本地定时负责，服务端不发送（PUSH_REMINDER_DUE 未开）user=${userId}`,
      )
      return
    }

    const devices = await this.prisma.device.findMany({
      where: { userId },
      select: { clientId: true },
    })
    const cids = devices.map((device) => device.clientId)
    if (cids.length === 0) {
      this.logger.debug(`[unicloud] user=${userId} 没有登记设备，跳过推送`)
      return
    }

    const payload = this.payloadFor(data ?? {})

    try {
      const response = await this.fetchFn(
        this.url,
        this.withTimeout({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-push-token': this.token,
          },
          body: JSON.stringify({
            cids,
            title: clamp(title, TITLE_MAX),
            content: clamp(body, CONTENT_MAX),
            payload,
            ttl: TTL_MS,
          }),
        }),
      )
      const json = await readJson(response)
      if (!isOk(response, json)) {
        this.warnFailure(cids, title, body, this.failureCode(response, json))
        return
      }
      this.logger.debug(
        `[unicloud] 已投递 devices=${cids.length} titleLen=${title.length} bodyLen=${body.length}`,
      )
    } catch (err) {
      this.warnFailure(cids, title, body, err instanceof Error ? err.name : String(err))
    }
  }

  /**
   * payload 超长时发空对象而不是截断字符串：截断会产出坏 JSON，而客户端读坏
   * payload 的结果是点击落回首页——消息照样到，只是少了深链，这是两者里较轻的。
   */
  private payloadFor(data: Record<string, unknown>): Record<string, unknown> {
    const serialized = JSON.stringify(data)
    if (serialized.length <= PAYLOAD_MAX) return data
    this.logger.warn(
      `[unicloud] payload 超长（${serialized.length} > ${PAYLOAD_MAX} 字符），本次推送不带跳转数据`,
    )
    return {}
  }

  /** 每次往返都带上超时：调用方在等，而云函数挂住时不会自己醒。 */
  private withTimeout(init: RequestInit): RequestInit {
    return { ...init, signal: AbortSignal.timeout(this.timeoutMs) }
  }

  /** 401 只可能是两侧密钥没对上，说清楚，别让人去查个推。 */
  private failureCode(res: Response, json?: PushJson): string {
    if (res.status === 401 || json?.code === 401) {
      return '401（UNICLOUD_PUSH_TOKEN 与云函数的 PUSH_TOKEN 不匹配）'
    }
    return String(json?.code ?? res.status)
  }

  /** 日志里只留 cid 后 6 位和正文长度：通知正文写着娃吃了多少奶、谁在找回密码。 */
  private warnFailure(
    cids: string[],
    title: string,
    body: string,
    code: string,
  ): void {
    this.logger.warn(
      `[unicloud] 推送失败 code=${code} cid=[${cids
        .map((cid) => `…${cid.slice(-6)}`)
        .join(',')}] titleLen=${title.length} bodyLen=${body.length}`,
    )
  }
}

async function readJson(res: Response): Promise<PushJson | undefined> {
  try {
    return (await res.json()) as PushJson
  } catch {
    return undefined
  }
}

function isOk(res: Response, json?: PushJson): boolean {
  return res.ok && json?.code === 0
}
