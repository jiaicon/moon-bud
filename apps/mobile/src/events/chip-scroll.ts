export interface ChipScrollParams {
  /** 可见容器的宽度（scroll-view 本身）。 */
  containerWidth: number
  /** 芯片所在那一行的视口左缘：它带着当前的滚动偏移，所以芯片减去它就和滚动无关了。 */
  rowLeft: number
  rowWidth: number
  chipLeft: number
  chipWidth: number
}

/**
 * 让选中的芯片落在容器正中。
 * 偏移一律从"芯片在内容里的位置"算，不读当前滚动量：H5 的 scroll-view 是用
 * transform 平移内容的，scrollLeft 恒为 0，拿它当基准会把居中算成乱跑。
 * 两端各封一次：左边不许为负，右边不许露出内容之外的空白。
 */
export function centerScrollLeft(params: ChipScrollParams): number {
  const chipCenterInRow = params.chipLeft - params.rowLeft + params.chipWidth / 2
  const desired = chipCenterInRow - params.containerWidth / 2
  const max = Math.max(0, params.rowWidth - params.containerWidth)
  return Math.min(max, Math.max(0, desired))
}
