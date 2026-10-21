export interface ConfirmDangerInput {
  title: string
  /** 必须写清后果（"归档后无法再打开"），而不是"确定吗"。 */
  content: string
  confirmText?: string
  /** 退路也要说人话：登录那一类的"不"不是拒绝危险操作，是"我再想想"。 */
  cancelText?: string
}

/** 用户是否明确点了确认。平台拿不到弹窗时返回 false —— 宁可什么都不做。 */
export function confirmDanger(input: ConfirmDangerInput): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof uni === 'undefined' || typeof uni.showModal !== 'function') {
      resolve(false)
      return
    }
    uni.showModal({
      title: input.title,
      content: input.content,
      confirmText: input.confirmText ?? '确认',
      cancelText: input.cancelText ?? '取消',
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false),
    })
  })
}
