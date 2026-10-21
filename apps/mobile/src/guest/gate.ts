import { confirmDanger } from '../utils/confirm'

/**
 * "我的"里每一行在游客身上该怎么表现，只有这一处知道。
 *
 * 判断散在模板的 `@click` 里，加一行就有人忘记加判断；而白名单取"哪些行不用登录"的
 * 反面（默认都要登录），新增页面天生就被拦着——不会出现"游客点了半天，
 * 进去看到一个 401 报错页"。
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

/**
 * 页面骨架里那些"点不动的控件"。游客现在看得到整副骨架（切换器、筛选栏、分段、
 * 记一笔九宫格），这些不是路由，所以用中文键登记，和上面那些行共用同一套默认拒绝。
 */
export const GATE_ACTION_KEYS: readonly string[] = [
  '家庭',
  '孩子',
  '记一笔',
  '筛选',
  '导出 CSV',
  '提醒分段',
]

export function needsLogin(entry: string, isGuest: boolean): boolean {
  return isGuest && !PUBLIC_ENTRY.includes(entry)
}

export const LOGIN_GATE_TITLE = '需要登录'
const LOGIN_GATE_CONFIRM = '去登录'
const LOGIN_GATE_CANCEL = '再想想'
/** 游客在任何一屏撞到的"登录"都走这一条：默认落在注册那一挡，三挡并列、切一下就行。 */
export const LOGIN_ENTRY_URL = '/pages/login/index?mode=register'

/**
 * 弹窗要说清"登录之后这一行给你什么"。只写"请先登录"等于让人盲选：
 * 他不知道登录是为了看成员还是为了改密码。
 */
const GATE_CONTENT: Record<string, string> = {
  '/pages/family-settings/index': '家庭设置改的是你们家的名字和孩子，登录后就能改。',
  '/pages/member-list/index': '成员管理要看的是这一家有几口人，登录后就能看全家。',
  '/pages/invite-qrcode/index': '邀请家人要凭你们家的邀请码，登录后就能生成一张码。',
  '/pages/family-select/index': '切换家庭要在你名下的家庭之间挑一个，登录后就能切。',
  '/pages/notification-center/index': '提醒中心里是这一家还没处理的提醒，登录后就能收到。',
  '/pages/change-password/index': '改密码改的是你的账号，登录进来就能改。',
  '/pages/dup-window-settings/index': '重复提醒提示管的是同一条提醒多久只响一次，登录后就能改。',
  '/pages/stats/index': '统计画的是这一家记下来的趋势，登录后就能看。',
  时区: '时区决定这些钟点念给谁听，登录后就能改。',
  家庭: '这一格定的是当前看哪一家的记录，登录后就能在自己名下之间切。',
  孩子: '这一格切的是给哪个孩子看、给哪个孩子记，登录后就能在自家孩子之间挑。',
  记一笔: '记一笔要落在一个孩子身上，登录后就能记下第一条。',
  筛选: '筛选在一堆记录里挑类型、挑日期、挑谁记的，登录后就能按这些筛。',
  '导出 CSV': '导出把这一家记下的东西导成表格给医生看，登录后就能导。',
  提醒分段: '待办 / 已过期 / 已完成是提醒的三格，登录后就能设提醒、看到这三格。',
}

export function gateContent(entry: string): string {
  return GATE_CONTENT[entry] ?? '这一页要读你们家的数据，登录后就能看。'
}

/** 问一句，愿意就去登录页，不愿意就留在这一行。返回有没有真的走。 */
export async function confirmLoginGate(entry: string): Promise<boolean> {
  const ok = await confirmDanger({
    title: LOGIN_GATE_TITLE,
    content: gateContent(entry),
    confirmText: LOGIN_GATE_CONFIRM,
    cancelText: LOGIN_GATE_CANCEL,
  })
  if (!ok) return false
  uni.navigateTo({ url: LOGIN_ENTRY_URL })
  return true
}
