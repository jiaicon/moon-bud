/**
 * 临时密码必须改掉才能用（spec 第 5 节）。守卫只认一个事实：改密页此刻在不在页面栈顶。
 *
 * 用"这次会话已经拦过了"的布尔来去重是错的——系统返回键能把改密页退掉，
 * 退掉之后标记仍是真，人就拿着一个随时该作废的密码继续在四 tabBar 之间走。
 * 看栈顶则不需要复位：回到本页时栈顶不再是改密页，自然再拦一次；
 * 已经站在改密页上时不叠第二层，改完返回不用退两次。
 */
export function guardForcedChange(mustChangePassword: boolean): boolean {
  if (!mustChangePassword) return false

  // 页面栈读不出来（平台差异/单测环境）时宁可拦：漏放的代价是一份能被作废的凭证还在用。
  const stack = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  const top = stack[stack.length - 1] as { route?: string } | undefined
  if (top?.route?.includes('change-password')) return true

  uni.navigateTo({ url: '/pages/change-password/index?forced=1' })
  return true
}
