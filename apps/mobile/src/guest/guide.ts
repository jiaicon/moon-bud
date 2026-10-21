/**
 * 游客在三格 Tab 上撞到的那一句"这里为什么是空的"。
 *
 * 三个页面共用这一份文案：同一个问题在三个地方写成三种说法，读起来就像三个不同的应用，
 * 而下次改文案的人只找得到其中一处。
 */
export type GuestGuidePage = 'home' | 'events' | 'reminders'

export const GUEST_GUIDE: Record<GuestGuidePage, { icon: string; title: string; hint: string }> = {
  home: {
    icon: '🌙',
    title: '还没有登录',
    hint: '登录后，这里会显示宝宝今天吃了多少、换了几次尿布。',
  },
  events: {
    icon: '📋',
    title: '还没有登录',
    hint: '记录都存在你家的账号里。登录后能看到全家人记的每一条。',
  },
  reminders: {
    icon: '⏰',
    title: '还没有登录',
    hint: '喂药、体检、该睡觉——登录后到点全家一起收到。',
  },
}

export const GUEST_LOGIN_LABEL = '登录 / 注册'
export const GUEST_TEACH_LABEL = '先看看它能做什么'

/** 被服务端踢回来的那一句。不说清原因，人会以为是应用坏了。 */
export const SESSION_EXPIRED_TOAST = '登录已过期，重新登录就能接着记。'

/** 会话过期与退出之后人落在哪：游客态的首页，不是登录页。 */
export const GUEST_LANDING_URL = '/pages/home/index'
