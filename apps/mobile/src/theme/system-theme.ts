/**
 * "跟随系统"只在冷启动读一次的话，系统入夜后 App 仍是白天色，
 * 直到用户杀掉重开 —— 用户理解为"这个开关不管用"。这里补上变更监听。
 *
 * 两端机制完全不同：APP 端由 uni 转发系统主题回调，H5 端只有 CSS 媒体查询。
 * 两条都挂，缺哪条就跳过哪条（node 测试环境里两条都没有）。
 */
export function watchSystemTheme(onDark: (dark: boolean) => void): () => void {
  const disposers: (() => void)[] = []
  const uniApi = (globalThis as Record<string, any>).uni

  if (typeof uniApi?.onThemeChange === 'function') {
    const handler = (res: { theme?: string }) => onDark(res?.theme === 'dark')
    uniApi.onThemeChange(handler)
    disposers.push(() => {
      if (typeof uniApi.offThemeChange === 'function') uniApi.offThemeChange(handler)
    })
  }

  if (typeof (globalThis as Record<string, any>).matchMedia === 'function') {
    const query = (globalThis as Record<string, any>).matchMedia('(prefers-color-scheme: dark)')
    const listener = (event: { matches: boolean }) => onDark(event.matches)
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', listener)
      disposers.push(() => query.removeEventListener('change', listener))
    }
  }

  return () => disposers.forEach((dispose) => dispose())
}
