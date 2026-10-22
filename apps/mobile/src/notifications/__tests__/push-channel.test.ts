import { afterEach, describe, expect, it, vi } from 'vitest'
import { configurePushChannel } from '../push-channel'

/**
 * 真机测出来的：通知轻不轻（弹不弹横幅、响不响、震不震）不由消息决定，由安卓 8+ 的
 * 通知渠道决定。SDK 自建的渠道是默认档，所以只有用户在设置里把它调高才响 —— 这不该
 * 是让每个家长自己去发现的开关。
 *
 * 注意 API 的长相：`getChannelManager` 平铺在 uni 上（和 getPushClientId 一样），
 * 不存在 `uni.push` 这个命名空间。
 */
describe('推送通知渠道', () => {
  function stubManager(manager: unknown) {
    if (manager === undefined) {
      delete (uni as unknown as Record<string, unknown>).getChannelManager
      return
    }
    ;(uni as unknown as Record<string, unknown>).getChannelManager = () => manager
  }

  afterEach(() => {
    stubManager(undefined)
  })

  it('把渠道设成最高档：弹横幅、响铃、震动、锁屏也看得见', () => {
    const setPushChannel = vi.fn()
    stubManager({ setPushChannel })

    configurePushChannel()

    expect(setPushChannel).toHaveBeenCalledWith({
      // 这个 id 不是我们起的名字：dumpsys 里 SDK 往通知栏投消息用的就是它
      // （`AppSettings: top.iconmen.yueya` 下唯一一条渠道，原始 importance=3）。
      // 自创一个 id 只会多建一条没人往里投通知的渠道，看着生效、其实没作用。
      channelId: 'DcloudChannelID',
      channelDesc: '到点提醒',
      importance: 4,
      enableVibration: true,
      lockscreenVisibility: 1,
    })
  })

  it('H5 上没有这个 API、安卓 8 以下管理器是 null：什么都不做也不抛', () => {
    stubManager(undefined)
    expect(() => configurePushChannel()).not.toThrow()

    stubManager(null)
    expect(() => configurePushChannel()).not.toThrow()
  })

  it('管理器本身抛错也不许冒到启动流程里', () => {
    stubManager({
      setPushChannel: () => {
        throw new Error('Android 8 以下没有通知渠道')
      },
    })

    expect(() => configurePushChannel()).not.toThrow()
  })
})
