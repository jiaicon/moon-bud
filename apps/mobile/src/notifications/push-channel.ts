/**
 * 通知渠道 id。这不是我们起的名字，是 dumpsys 实测出来的 SDK 自己那条渠道
 * （`AppSettings: top.iconmen.yueya` 下唯一的渠道，名"消息推送"，原始 importance=3）：
 * 通知栏里弹出的消息全投在它上面。
 *
 * 为什么不能用一个自创的 id：那样只会多建一条谁都不往里投通知的渠道 —— 用户的设置里
 * 确实多了一格"到点提醒"，实际响法一点没变。要改就得改在真正被用的那一条上。
 */
export const PUSH_CHANNEL_ID = 'DcloudChannelID'

/** 4 = IMPORTANCE_HIGH：弹横幅、响系统提示音、按渠道默认震动。 */
const IMPORTANCE_HIGH = 4
/** 1 = VISIBILITY_PUBLIC：锁屏上也看得见内容（夜奶提醒常常就是锁屏那一刻要读）。 */
const VISIBILITY_PUBLIC = 1

interface ChannelManagerLike {
  setPushChannel?: (options: Record<string, unknown>) => void
}

function channelManager(): ChannelManagerLike | null {
  const getManager = (uni as unknown as {
    getChannelManager?: () => ChannelManagerLike | null
  }).getChannelManager
  // H5 与小程序上这个 API 不存在，安卓 8 以下 DCloud 明确返回 null。
  if (typeof getManager !== 'function') return null
  try {
    return getManager() ?? null
  } catch {
    return null
  }
}

/**
 * 冷启动第一件事里的一件：赶在第一条通知弹出来之前，把 SDK 用来弹通知的那条渠道
 * （id 见 `PUSH_CHANNEL_ID`）按最高档建好。
 *
 * 为什么要抢：`force_notification` 的通知就是走这个渠道，建成默认档只能是"下拉面板里
 * 躺一条，不弹横幅、不响、不震"；而安卓事后不许 App 改已建渠道的重要度 —— 不抢在这一刻，
 * "提醒很轻"就只剩让用户自己去系统设置里调高这一条路，家长不会去发现。
 */
export function configurePushChannel(): void {
  const manager = channelManager()
  if (!manager || typeof manager.setPushChannel !== 'function') return

  try {
    // 不传 soundName：那要求 APK 的 res/raw 里真有那个音频文件，缺了整套渠道就建不起来；
    // 用系统默认铃音就够响。
    manager.setPushChannel({
      channelId: PUSH_CHANNEL_ID,
      channelDesc: '到点提醒',
      importance: IMPORTANCE_HIGH,
      enableVibration: true,
      lockscreenVisibility: VISIBILITY_PUBLIC,
    })
  } catch (err) {
    // 提醒照样会进通知栏，只是可能不弹横幅，不值得为它打断启动。
    console.warn('[moonBud] 通知渠道设置失败，到点提醒可能不弹横幅', err)
  }
}
