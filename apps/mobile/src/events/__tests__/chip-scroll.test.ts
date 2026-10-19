import { describe, expect, it } from 'vitest'
import { centerScrollLeft } from '../chip-scroll'

type Params = Parameters<typeof centerScrollLeft>[0]
const box = (over: Partial<Params> = {}) => ({
  containerWidth: 300,
  rowLeft: 20,
  rowWidth: 1000,
  chipLeft: 0,
  chipWidth: 80,
  ...over,
})

describe('筛选芯片居中', () => {
  it('把选中的芯片滚到容器中间', () => {
    // 芯片在内容里 490..570，中心 530；容器中心 150 → 滚 380。
    expect(centerScrollLeft(box({ chipLeft: 510 }))).toBe(380)
  })

  it('只看芯片在内容里的位置，与它当前被滚到哪无关', () => {
    // rowLeft 变了（说明已经在滚），结果必须一样：不拿"当前滚动量"参与计算才不会因为
    // H5 用 transform 滚动而读到过期的值。
    expect(centerScrollLeft(box({ rowLeft: -653, chipLeft: -163 }))).toBe(380)
  })

  it('最左边的芯片封到 0，不把整行推出去', () => {
    expect(centerScrollLeft(box({ chipLeft: 20 }))).toBe(0)
  })

  it('最右边的芯片封到内容末尾，宁可贴边也不留出空白', () => {
    // 想让 920..1000 居中需要滚 850，但只有 700 可滚。
    expect(centerScrollLeft(box({ chipLeft: 920 }))).toBe(700)
  })

  it('容器比内容还宽时不动', () => {
    expect(centerScrollLeft(box({ containerWidth: 1400, chipLeft: 920 }))).toBe(0)
  })
})
