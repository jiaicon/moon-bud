import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 「说一句话」上一版只活在首页那一格，而人说话的场景是"我正看着这张记录列表，突然想记一条"。
 * 所以记录页与提醒页也要有入口，并且点开的是同一个面板——每页各写一遍"调用→判断→交接→跳转"，
 * 就是三份会各自漂移的判定。
 */
const pages = ['event-list', 'reminder-list'] as const

function source(page: (typeof pages)[number]): string {
  return readFileSync(join(__dirname, '..', page, 'index.vue'), 'utf8')
}

describe('记录页与提醒页的悬浮入口', () => {
  for (const page of pages) {
    it(`${page}：入口是胶囊，点开的是共用的那一个面板`, () => {
      const src = source(page)
      expect(src).toContain('class="ask-pill"')
      expect(src).toContain('说一句话')
      expect(src).toContain("import AskSheet from '../../components/AskSheet.vue'")
      expect(src).toContain('<ask-sheet')
      expect(src).toContain('v-model:open="askOpen"')
      // 面板自己不知道当前是哪个孩子，这一页才知道。
      expect(src).toContain(':child-id')
    })

    it(`${page}：列表页一行都不碰助手接口`, () => {
      expect(source(page)).not.toContain('assistantApi')
    })

    it(`${page}：胶囊与「＋」共用同一个 v-if——能记的地方就是能说的地方`, () => {
      // 游客口径是"引导只占空白区、点击静默、不弹窗"，所以这一条不是 gate 掉点击，
      // 而是和"能不能记一笔"绑在同一个判断上：游客与没家庭的人两个都看不见。
      const src = source(page)
      const fab = /<view v-if="([^"]+)" class="fab"/.exec(src)
      const pill = /<view v-if="([^"]+)" class="ask-pill"/.exec(src)
      expect(fab, '找不到 FAB 的 v-if').not.toBeNull()
      expect(fab![1]).toContain('!isGuest')
      expect(pill, '找不到胶囊的 v-if').not.toBeNull()
      expect(pill![1]).toBe(fab![1])
    })

    it(`${page}：胶囊排在「＋」FAB 之上，两个同时在场不叠在一起`, () => {
      const src = source(page)
      // FAB：贴着 tabBar 上方 40rpx；胶囊再往上让出一个 FAB 的身位。
      expect(src).toContain('bottom: calc(var(--window-bottom) + 40rpx);')
      expect(src).toContain(
        'bottom: calc(var(--window-bottom) + 40rpx + 108rpx + 16rpx);',
      )
    })
  }
})
