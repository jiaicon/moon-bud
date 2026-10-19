/** 邀请码是人手敲进来的：小写、空格、连字符都可能，进系统前先归一。 */
export function normalizeInviteCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

/**
 * 二维码里那点字符串就是全家唯一一处"跨端约定"：APP 内画码、微信扫它、扫完落到 H5。
 * uni 的 H5 默认是 hash 路由，所以落地地址长成 `/#/pages/join/index?code=`，
 * 写成 `/join?code=` 的话扫出来是一个 404 —— 而 404 在家人手机上没有任何提示。
 */
export function joinPageUrl(baseUrl: string | null, code: string): string {
  if (!baseUrl) return ''
  const clean = normalizeInviteCode(code)
  if (!clean) return ''
  return `${baseUrl.replace(/\/+$/, '')}/#/pages/join/index?code=${clean}`
}
