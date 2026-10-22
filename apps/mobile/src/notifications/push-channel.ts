/**
 * 通知渠道 id。定下就别改：安卓 8+ 的规则是渠道一旦建好，App 自己就再也改不动它的
 * 重要度（只有用户能在系统设置里改），换 id 等于重新建一个渠道，旧的那些还留在
 * 用户的通知设置列表里。
 */
export const PUSH_CHANNEL_ID = 'moonbud-reminder'

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
 * 冷启动第一件事里的一件：把推送用的通知渠道按最高档建好。
 *
 * 为什么要抢在第一条通知之前：`force_notification` 的通知是 uni-push SDK 用它自己的
 * 渠道弹的，那个渠道是默认档 —— 实测就是"下拉面板里躺一条，不弹横幅、不响、不震"。
 * 只有把它调高才响，而那是让用户自己去系统设置里发现的开关，家长不会去发现。
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
