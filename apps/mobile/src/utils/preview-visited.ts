const KEY = 'previewVisited'

/** 游客看过一次功能预览就记一笔；注册/登录成功的一刻必须清掉。 */
export function markPreviewVisited(): void {
  uni.setStorageSync(KEY, '1')
}

export function hasPreviewVisited(): boolean {
  return Boolean(uni.getStorageSync(KEY))
}

export function clearPreviewVisited(): void {
  uni.removeStorageSync(KEY)
}
