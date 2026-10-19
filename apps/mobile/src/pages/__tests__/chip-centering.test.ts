import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, '../event-list/index.vue'), 'utf-8')

describe('记录页芯片居中', () => {
  it('两条芯片条都把算好的偏移交给 scroll-left', () => {
    expect(source).toContain(':scroll-left="typeScrollLeft"')
    expect(source).toContain(':scroll-left="childScrollLeft"')
    expect(source).toContain('centerScrollLeft(')
  })

  // H5 的 scroll-view 带动画时把偏移做成 transform 覆盖层，之后的同值赋值会被 uni
  // 判为"无需动"直接丢掉，芯片就会只居中一次。注释里会写这个词，所以只挑独占一行的属性。
  it('不挂 scroll-with-animation', () => {
    expect(source).not.toMatch(/^\s*scroll-with-animation/m)
  })
})
