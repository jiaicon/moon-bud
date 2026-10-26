import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 首页那个入口的存在感就是这个任务本身，所以钉的全是"它到底像不像一个能按的东西"：
 * 一条 placeholder 里写着说明的输入框，长得和表单里任何一栏没区别——上一版就是这么摆的，
 * 结果没人知道那里能说话。现在它和记录页/提醒页是**同一颗右下角悬浮胶囊**、同一个样式，
 * 逻辑整块搬进 AskSheet。
 */
const page = readFileSync(join(__dirname, '..', 'home', 'index.vue'), 'utf8')
/** 三处入口只许差一个 bottom 偏移：长得不一样，人就认不出"那是同一个东西"。 */
const listPage = readFileSync(join(__dirname, '..', 'event-list', 'index.vue'), 'utf8')

describe('首页的助手入口', () => {
  it('入口是右下角那颗胶囊，不是一栏输入框也不是一条内容块', () => {
    expect(page).toContain('ask-pill')
    expect(page).toContain('说一句话')
    // 上一版的样子：一栏 input + placeholder 里写着"说一句话，如：…"。
    expect(page).not.toContain('v-model="askText"')
    // 也不许再摆成内容区里的一块：内容区会滚，滚走了就等于没有。
    expect(page).not.toContain('ask-entry')
  })

  it('样式与列表页那颗只差 bottom 一行', () => {
    const block = (src: string) => {
      const start = src.indexOf('.ask-pill {')
      expect(start).toBeGreaterThan(-1)
      let depth = 0
      for (let i = src.indexOf('{', start); i < src.length; i += 1) {
        if (src[i] === '{') depth += 1
        if (src[i] === '}') {
          depth -= 1
          if (depth === 0) return src.slice(start, i + 1).replace(/\s+/g, ' ')
        }
      }
      throw new Error('.ask-pill 的样式块没闭合')
    }
    const strip = (css: string) =>
      css.replace(/bottom:[^;]+;/, '').replace(/\/\*[^]*?\*\//g, '').replace(/\s+/g, ' ').trim()
    expect(strip(block(page))).toBe(strip(block(listPage)))
    // 首页没有 FAB，所以胶囊就坐在 FAB 那一格上；列表页那颗要让出一个身位。
    expect(page).toContain('bottom: calc(var(--window-bottom) + 40rpx);')
    expect(page).not.toContain('class="fab"')
  })

  it('点了就把面板打开，面板由首页管开合', () => {
    expect(page).toContain('askOpen = true')
    expect(page).toContain('<ask-sheet')
    expect(page).toContain('v-model:open="askOpen"')
    // 草稿要落在当前孩子身上，这是首页才知道的事，得传进面板。
    expect(page).toContain(':child-id')
  })

  it('解析这件事不在首页发生了：首页一行都不碰助手接口', () => {
    // 三个页面共用一个面板。每页各写一遍"调用→判断→交接→跳转"，就是四份会漂移的判定。
    expect(page).not.toContain('assistantApi')
    expect(page).not.toContain('stageDraft')
    expect(page).not.toContain('assistantTarget')
  })

  it('游客那一路没有这颗胶囊（它本来就不在游客那段里）', () => {
    // 游客的口径是"引导只占空白区、点击静默、不弹窗"：一个点开只会说"先登录"的助手
    // 入口比没有入口更坏，所以这里不是 gate 掉点击，而是根本不摆。
    const guestBranch = page.slice(page.indexOf("<template v-else-if=\"view === 'guest'\""), page.indexOf('<template v-else>'))
    expect(guestBranch).not.toContain('ask')
    expect(page.indexOf('ask-pill')).toBeGreaterThan(page.indexOf("<template v-else-if=\"view === 'guest'\""))
    expect(page).not.toContain('confirmLoginGate')
  })

  it('dropped 那句提示归表单横幅，首页不再抢着说', () => {
    // 首页说"有些字段没填上"，人已经跳走了，看不见那句话到底在说哪一栏；
    // 表单里那条会连着把哪几栏空着一起说。
    expect(page).not.toContain('有些字段没填上')
  })

  it('只画在 ready 那一支（没登录、没家庭、没孩子都不摆）', () => {
    const ready = page.indexOf('<template v-else>')
    expect(ready).toBeGreaterThan(-1)
    expect(page.indexOf('class="ask-pill"')).toBeGreaterThan(ready)
    for (const branch of ["view === 'checking'", "view === 'add-child'", "view === 'create-family'"]) {
      const start = page.indexOf(branch)
      expect(start).toBeGreaterThan(-1)
      expect(page.slice(start, page.indexOf('</view>', start))).not.toContain('ask-pill')
    }
  })
})
