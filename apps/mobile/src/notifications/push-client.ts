import { devicesApi } from '../api/endpoints'
import { useFamilyStore } from '../stores/family'
import { setLocalPushEnabled } from './local-notify'
import { notificationTarget } from './routing'

/** 退出登录时要用它发 DELETE，所以上报成功必须把 cid 留在本地。 */
export const CLIENT_ID_KEY = 'pushClientId'

/**
 * 只声明本文件真正用到的部分，不写成 any。字段名以 @dcloudio/types 的
 * `GetPushClientIdSuccessData` 为准：成功回调给的是 `{ cid, errMsg }`，不是 `client_id`
 * ——真机上 success 一直正常，读错键让服务端一条设备记录都没收到过。
 */
interface PushClientApi {
  getPushClientId?: (options: {
    success?: (res: { cid?: string }) => void
    fail?: (err: unknown) => void
  }) => void
  onPushMessage?: (callback: (message: PushMessage) => void) => void
}

interface PushMessage {
  type?: 'click' | 'receive'
  data?: unknown
}

interface PushPayload {
  familyId?: string | null
  occurrenceId?: string | null
  kind?: string
}

function pushApi(): PushClientApi {
  return uni as unknown as PushClientApi
}

/** 个推的 cid。失败一律 resolve 成 null：调用方不该因为推送没起来就卡住登录。 */
function requestClientId(): Promise<string | null> {
  return new Promise((resolve) => {
    pushApi().getPushClientId?.({
      success: (res) => resolve(res.cid || null),
      fail: () => resolve(null),
    })
  })
}

/**
 * cid 有没有报进服务端，决定这台设备的到点提醒由谁负责：报上了就走服务端推送（停掉、
 * 改时间的那一刻就不发了）；报不上只剩本地排期能响 —— 而本地消息排上就撤不掉。
 */
export async function registerPushClient(): Promise<string | null> {
  const clientId = await reportClientId()
  setLocalPushEnabled(clientId === null)
  return clientId
}

async function reportClientId(): Promise<string | null> {
  if (typeof pushApi().getPushClientId !== 'function') {
    // H5 上这是常态，不是故障，所以不刷警告：控制台里每条 warn 都得当作值得看的东西。
    return null
  }
  const clientId = await requestClientId()
  if (!clientId) return null

  try {
    await devicesApi.register(clientId)
  } catch (err) {
    console.warn('[moonBud] 推送设备上报失败，提醒仍会写进站内通知中心', err)
    return null
  }
  uni.setStorageSync(CLIENT_ID_KEY, clientId)
  return clientId
}

export async function unregisterPushClient(): Promise<void> {
  const stored = uni.getStorageSync(CLIENT_ID_KEY)
  if (typeof stored !== 'string' || stored.length === 0) return

  try {
    await devicesApi.unregister(stored)
  } catch (err) {
    console.warn('[moonBud] 推送设备注销失败（不影响退出登录）', err)
  } finally {
    // 无论成不成都要清：留着旧 cid，下次登录上报的新 cid 会被一个死地址缠着。
    uni.removeStorageSync(CLIENT_ID_KEY)
  }
}

/**
 * 点击推送落到"那件事发生的地方"，落点与站内提醒中心共用同一条分流（routing.ts）。
 * payload 由服务端 buildPushBody 放进 transmission，形态在各平台上略有出入，
 * 所以这里按"字符串就解析、对象就取 payload 字段"两层剥。
 */
export function startPushClickHandler(): void {
  if (typeof pushApi().onPushMessage !== 'function') return

  // #ifdef APP-PLUS
  pushApi().onPushMessage?.((message) => {
    if (message?.type !== 'click') return
    const payload = readPayload(message.data)
    if (!payload) return
    openTarget(payload)
  })
  // #endif
}

function readPayload(raw: unknown): PushPayload | null {
  const outer = toRecord(raw)
  if (!outer) return null
  // 透传消息在个推里裹了一层 payload（字符串或对象，随平台不同），通知消息则直接就是数据体。
  const inner = 'payload' in outer ? toRecord(outer.payload) : outer
  return isPushPayload(inner) ? (inner as PushPayload) : null
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return toRecord(JSON.parse(value))
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/**
 * 认出"这确实是月芽的推送"才照着它分流：个推在通知消息里也会塞进一个只含
 * title/content 的对象，照着那种东西导航会把人送进成员列表。
 */
function isPushPayload(record: Record<string, unknown> | null): boolean {
  if (!record) return false
  return !!(record.kind || record.familyId || record.occurrenceId)
}

function openTarget(payload: PushPayload): void {
  const target = notificationTarget({
    occurrenceId: payload.occurrenceId ?? null,
    // 空串是"没有家庭"的既有表示（routing.ts 把它读成 null）。
    familyId: payload.familyId ?? '',
  })
  switch (target.kind) {
    case 'members':
      // 找回请求说的是某一个家庭；不先切过去，管理员站在当前家庭里找不到请求者。
      if (target.familyId) {
        const familyStore = useFamilyStore()
        if (target.familyId !== familyStore.currentFamilyId) familyStore.switchFamily(target.familyId)
      }
      uni.navigateTo({ url: '/pages/member-list/index' })
      return
    case 'reminders':
      uni.setStorageSync('reminderTabFocus', 'ACTIVE')
      uni.switchTab({ url: '/pages/reminder-list/index' })
  }
}
