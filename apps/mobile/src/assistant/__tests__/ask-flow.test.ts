import { describe, expect, it } from 'vitest'
import { ASK_EXAMPLES, askBannerCopy } from '../ask-flow'

/**
 * 面板上那三句例句和表单顶部那一条横幅，是这个功能唯一"替人开口"的地方：
 * 例句把人带去一个还没做的功能，第一次用就是被告知"我没看懂"；横幅在半空时说"填好了"，
 * 是谎报。两条都在这里被钉住，而不是钉在界面上——界面上的字没人逐字读。
 */
describe('助手面板的例句', () => {
  it('恰好三句，一句填不满一屏、三句也够说出两种意图', () => {
    expect(ASK_EXAMPLES).toHaveLength(3)
  })

  it('每句都不长到在手机上折行成一坨（30 字以内）', () => {
    for (const example of ASK_EXAMPLES) {
      expect(example.length).toBeLessThanOrEqual(30)
    }
  })

  it('记一笔和设提醒各有例句，只写一种会让人以为助手只管一半', () => {
    // 判据就是"这句里有没有『提醒』"——面板要给的两种意图也正是这一词之差。
    expect(ASK_EXAMPLES.some((e) => e.includes('提醒'))).toBe(true)
    expect(ASK_EXAMPLES.some((e) => !e.includes('提醒'))).toBe(true)
  })

  it('不许出现"问数据"那类例句：这一期还只会往里写，不会往外读', () => {
    // 点一句换不来任何东西的例句，比没有例句更坏——它是一次当面的"没看懂"。
    for (const forbidden of ['多少', '查一下', '什么时候醒', '昨天']) {
      expect(ASK_EXAMPLES.some((e) => e.includes(forbidden))).toBe(false)
    }
  })
})

describe('表单顶部那句"助手填好了"', () => {
  it('什么都没丢，才允许说"填好了"', () => {
    const copy = askBannerCopy([])
    expect(copy).toContain('填好了')
    expect(copy).not.toContain('没填上')
  })

  it('丢了任何一个字段，就不许再说"填好了"，要说没填上', () => {
    for (const dropped of [['event.payload'], ['reminder.actionPayload'], ['reminder.eventType']]) {
      const copy = askBannerCopy(dropped)
      expect(copy).toContain('没填上')
      expect(copy).not.toContain('填好了')
    }
  })

  it('念的是人话，不是路径：dropped 里那种 event.payload 不许出现在屏幕上', () => {
    const copy = askBannerCopy(['event.payload', 'reminder.actionPayload'])
    expect(copy).not.toContain('payload')
    expect(copy).not.toContain('event.')
    // 也不逐条念：两句都"没填上"和一句话说"没填上"，人要做的是同一件事。
    expect(copy.match(/没填上/g)).toHaveLength(1)
  })
})
