import { createHash } from 'node:crypto'

/** 个推 REST v2 的基址：appId 就是 DCloud 后台那个 "__UNI__…" 之外的个推 appId。 */
export const GETUI_BASE = (appId: string): string =>
  `https://restapi.getui.com/v2/${appId}`

export function buildAuthBody(
  appKey: string,
  masterSecret: string,
  timestamp: string,
): { appKey: string; sign: string; timestamp: string } {
  return {
    appKey,
    sign: createHash('sha256').update(appKey + masterSecret + timestamp).digest('hex'),
    timestamp,
  }
}

export interface PushBodyInput {
  cids: string[]
  title: string
  body: string
  /** 消息在个推服务器上的存活毫秒数：设备此刻离线，上线后仍能补发。 */
  ttlMs: number
  requestId: string
  data: Record<string, unknown>
  /** 小米"私信/服务类"分类 id；未审批下来时不传，请求体里也不留空字段。 */
  pushCategory?: string
}

export function buildPushBody(input: PushBodyInput): Record<string, unknown> {
  return {
    request_id: input.requestId,
    audience: { cid: input.cids },
    settings: { ttl: input.ttlMs },
    // classification 1 = 系统消息，厂商才不会按营销消息限流/折叠。
    push_channel: {
      android: {
        classification: 1,
        ...(input.pushCategory ? { category: input.pushCategory } : {}),
      },
    },
    // notification 交给系统托盘展示；click_type NONE 表示点击由客户端的
    // onPushMessage 自己处理，不让个推打开某个 Activity。
    notification: {
      android: {
        title: input.title,
        body: input.body,
        click_type: 'NONE',
      },
    },
    push_message: {
      android: {
        title: input.title,
        body: input.body,
        transmission: JSON.stringify(input.data),
      },
    },
  }
}
