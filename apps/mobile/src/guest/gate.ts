/**
 * 游客在"我的"里点一行之后该不该进去，只有这一处知道。
 *
 * 白名单取"哪些行不用登录"的反面（默认都要登录），新增页面天生就被拦着——不会出现
 * "游客点了半天，进去看到一个 401 报错页"。
 *
 * 2026-10-21：这一处只回答"要不要账号"，不再负责"怎么告诉他要账号"。游客点要账号的东西
 * 一律无反应，页面上的登录入口（那颗"登录 / 注册"）才是唯一那条明路。
 */

/** 教学页：原功能预览，游客不需要账号就能看。 */
export const TEACH_PATH = '/pages/preview/index'

/** 改的是这台手机自己的偏好，不需要账号。 */
export const PUBLIC_ENTRY: readonly string[] = [TEACH_PATH, '/pages/theme-settings/index']

/** 要账号才能进去看的那些行。时区那一行是选择器，用 '时区' 这个键单独管。 */
export const GATE_ENTRY_PATHS: readonly string[] = [
  '/pages/family-settings/index',
  '/pages/member-list/index',
  '/pages/invite-qrcode/index',
  '/pages/family-select/index',
  '/pages/notification-center/index',
  '/pages/change-password/index',
  '/pages/dup-window-settings/index',
  '/pages/stats/index',
  '时区',
]

export function needsLogin(entry: string, isGuest: boolean): boolean {
  return isGuest && !PUBLIC_ENTRY.includes(entry)
}

/** 游客在任何一屏撞到的"登录"都走这一条：默认落在注册那一挡，三挡并列、切一下就行。 */
export const LOGIN_ENTRY_URL = '/pages/login/index?mode=register'
