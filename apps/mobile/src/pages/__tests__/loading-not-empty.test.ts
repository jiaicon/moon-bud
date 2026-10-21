import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function srcOf(rel: string): string {
  return readFileSync(join(__dirname, '..', '..', rel), 'utf8')
}

/**
 * "还没读到"和"没有"是两件事：前者要说"读取中/没读到"，后者才配说数字或空。
 * 说错的代价是家长以为家里真的没东西，于是去做一件重复的事（再记一笔、再建一个孩子）。
 */
describe('加载状态不许说成"没有"', () => {
  it('孩子切换器：名单读砸了说"没读到"，不留在"读取中"也不说"未添加"', () => {
    const src = srcOf(join('components', 'ChildSwitcher.vue'))
    expect(src).toMatch(/if \(loaded\.value\) return '未添加'/)
    expect(src).toMatch(/childStore\.error \? '没读到' : '读取中'/)
  })

  it('通知中心：未读数是服务端的话，取回来之前只说"正在数…"', () => {
    const src = srcOf(join('pages', 'notification-center', 'index.vue'))
    expect(src).toMatch(/const loaded = ref\(false\)/)
    expect(src).toMatch(/loaded\.value = true/)
    expect(src).toMatch(/<text v-if="loaded" class="head__count">/)
    expect(src).toMatch(/<text v-else class="head__count">正在数…<\/text>/)
  })

  it('邀请码：有效小时数由 inviteWindow 校验，不再被 Number(hours) || 72 顶掉', () => {
    const src = srcOf(join('pages', 'invite-qrcode', 'index.vue'))
    expect(src).toMatch(/import \{ inviteWindow \} from '\.\.\/\.\.\/invite\/invite-window'/)
    expect(src).toMatch(/const parsed = inviteWindow\(hours\.value\)/)
    expect(src).toMatch(/if \(!parsed\.ok\)/)
    expect(src).toMatch(/parsed\.expiresInHours/)
    expect(src).not.toMatch(/Number\(hours\) \|\| 72/)
    // 构建期术语不该出现在家人看得见的文案里
    expect(src).not.toMatch(/VITE_INVITE_BASE_URL/)
  })
})
