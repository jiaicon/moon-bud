/**
 * "返回"必须真的把人退出去。`uni.navigateBack()` 在页面栈只剩当前这一页时什么都不做，
 * 而深链、扫码落地、冷启动直接打开一个表单恰好造成那种栈形：
 * 点保存、toast 一闪、人还停在原地，于是被当成"没保存上"，其实东西已经存好了。
 * 退无可退时落回首页——它是 tab 页，永远在。
 */
export function stepBack(fallbackUrl = '/pages/home/index'): void {
  const stack = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  if (stack.length > 1) {
    uni.navigateBack()
    return
  }
  uni.reLaunch({ url: fallbackUrl })
}
