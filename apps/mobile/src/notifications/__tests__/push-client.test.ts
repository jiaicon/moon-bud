import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/http', () => ({ apiRequest: vi.fn() }))
// 本地排期的开关：这里只核对 push-client 有没有按 cid 的有无去拨它，开关本身的行为
// 在 local-notify.test.ts 里钉。
vi.mock('../local-notify', () => ({ setLocalPushEnabled: vi.fn() }))

import { apiRequest } from '../../api/http'
import { setLocalPushEnabled } from '../local-notify'
import { CLIENT_ID_KEY, registerPushClient, startPushClickHandler, unregisterPushClient } from '../push-client'
import { useFamilyStore } from '../../stores/family'

const CID = 'CID_FROM_SDK_A1B2C3'
const uni = (globalThis as Record<string, any>).uni as Record<string, any>

/**
 * 每次用例都给一个"SDK 可用"的 uni；H5 那条自己把它拆掉。
 * 回调形状照 @dcloudio/types 的 GetPushClientIdSuccessData：字段就叫 `cid`。
 * 真机上 success 是来了的，而我们读的是 `client_id`，于是服务端一条设备记录都没收到。
 */
function stubPushSdk(clientId: string | null = CID): void {
  uni.getPushClientId = vi.fn((opts: { success?: (res: { cid?: string; errMsg?: string }) => void; fail?: (e: unknown) => void }) => {
    if (clientId) opts.success?.({ cid: clientId, errMsg: 'getPushClientId:ok' })
    else opts.fail?.({ code: -1 })
  })
}

describe('push-client', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(apiRequest).mockReset()
    vi.mocked(apiRequest).mockResolvedValue(undefined as never)
    vi.mocked(setLocalPushEnabled).mockReset()
    stubPushSdk()
  })

  afterEach(() => {
    delete uni.getPushClientId
    delete uni.onPushMessage
    uni.removeStorageSync(CLIENT_ID_KEY)
  })

  it('拿到 cid 就上报，并把 cid 留在本地供退出时注销', async () => {
    await expect(registerPushClient()).resolves.toBe(CID)

    expect(apiRequest).toHaveBeenCalledWith('/devices/push-client', {
      method: 'POST',
      data: { clientId: CID, platform: 'android' },
    })
    expect(uni.getStorageSync(CLIENT_ID_KEY)).toBe(CID)
  })

  it('SDK 拿不到 cid：不发请求，也不抛', async () => {
    stubPushSdk(null)

    await expect(registerPushClient()).resolves.toBeNull()
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('success 回调来了但 cid 是空的：同样不上报（个推还没注册上时的样子）', async () => {
    uni.getPushClientId = vi.fn((opts: { success?: (res: { cid?: string }) => void }) => {
      opts.success?.({ cid: '' })
    })

    await expect(registerPushClient()).resolves.toBeNull()
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('上报失败绝不打断登录：返回 null 而不抛', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('网络不佳'))

    await expect(registerPushClient()).resolves.toBeNull()
    expect(uni.getStorageSync(CLIENT_ID_KEY)).toBe('')
  })

  it('退出时注销本地存过的 cid，并把 key 清掉', async () => {
    uni.setStorageSync(CLIENT_ID_KEY, CID)

    await unregisterPushClient()

    expect(apiRequest).toHaveBeenCalledWith('/devices/push-client', {
      method: 'DELETE',
      data: { clientId: CID },
    })
    expect(uni.getStorageSync(CLIENT_ID_KEY)).toBe('')
  })

  it('本地没存过 cid 就不做无谓的注销请求', async () => {
    await unregisterPushClient()

    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('注销失败也要清掉本地 cid：下次登录重新上报，别抱着一个死地址', async () => {
    uni.setStorageSync(CLIENT_ID_KEY, CID)
    vi.mocked(apiRequest).mockRejectedValue(new Error('网络不佳'))

    await expect(unregisterPushClient()).resolves.toBeUndefined()
    expect(uni.getStorageSync(CLIENT_ID_KEY)).toBe('')
  })

  it('H5 上没有 getPushClientId，注册直接返回 null', async () => {
    delete uni.getPushClientId

    await expect(registerPushClient()).resolves.toBeNull()
    expect(apiRequest).not.toHaveBeenCalled()
  })

  // plus 排上去的定时消息撤不掉（clear() 只管通知栏里已经显示的那些），所以推送通道
  // 在的这台设备必须由服务端发到点提醒，本地一条都不能排；反过来没有推送通道时，
  // 本地兜底是唯一还能响的东西。
  it('上报到了 cid：关掉本地排期，到点提醒交给服务端推送', async () => {
    await expect(registerPushClient()).resolves.toBe(CID)
    expect(setLocalPushEnabled).toHaveBeenCalledWith(false)
  })

  it('拿不到 cid、上报失败、H5 没有 SDK：本地排期兜底', async () => {
    stubPushSdk(null)
    await registerPushClient()
    expect(setLocalPushEnabled).toHaveBeenCalledWith(true)

    vi.mocked(setLocalPushEnabled).mockReset()
    vi.mocked(apiRequest).mockRejectedValue(new Error('网络不佳'))
    await registerPushClient()
    expect(setLocalPushEnabled).toHaveBeenCalledWith(true)

    vi.mocked(setLocalPushEnabled).mockReset()
    delete uni.getPushClientId
    await registerPushClient()
    expect(setLocalPushEnabled).toHaveBeenCalledWith(true)
  })

  it('点推送落到那件事发生的地方：找回请求去成员列表，并先切成通知里那一家庭', async () => {
    const navigateTo = vi.fn()
    uni.navigateTo = navigateTo
    const familyStore = useFamilyStore()
    familyStore.switchFamily('fam_other')

    let handler: ((msg: unknown) => void) | undefined
    uni.onPushMessage = vi.fn((cb: (msg: unknown) => void) => {
      handler = cb
    })
    startPushClickHandler()

    handler?.({
      type: 'click',
      data: { payload: JSON.stringify({ familyId: 'fam_reset', kind: 'password_reset' }) },
    })

    expect(familyStore.currentFamilyId).toBe('fam_reset')
    expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/member-list/index' })
  })

  it('不是点击（前台收到）或没有 payload 时什么都不做', () => {
    const navigateTo = vi.fn()
    const switchTab = vi.fn()
    uni.navigateTo = navigateTo
    uni.switchTab = switchTab

    const messages: unknown[] = [
      { type: 'receive', data: { payload: JSON.stringify({ familyId: 'fam_reset', kind: 'password_reset' }) } },
      { type: 'click' },
      { type: 'click', data: {} },
    ]
    uni.onPushMessage = vi.fn((cb: (msg: unknown) => void) => {
      for (const msg of messages) cb(msg)
    })

    startPushClickHandler()

    expect(navigateTo).not.toHaveBeenCalled()
    expect(switchTab).not.toHaveBeenCalled()
  })
})
