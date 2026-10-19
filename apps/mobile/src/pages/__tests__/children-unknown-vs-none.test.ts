import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(srcDir, p), 'utf8')

/**
 * "这个家庭还没有孩子"是一句需要证据的话：孩子名单没读到过的时候说它，
 * 家长读到的是"我没给孩子建过档"，而真相是"我还不知道"。冷启动、换家庭
 * 的那一瞬都会撞上。
 */
describe("孩子名单：还不知道 ≠ 没有", () => {
  it('首页把 childrenLoaded / childrenLoadFailed 交给了视图判定，并且有对应的占位', () => {
    const source = read('pages/home/index.vue')
    expect(source).toContain('familyId.value in childStore.childrenByFamily')
    expect(source).toContain('childrenLoaded: childrenLoaded.value')
    expect(source).toContain('childrenLoadFailed: childrenLoadFailed.value')
    expect(source).toContain("view === 'loading'")
    // 挂在"正在读取"上没有出路，等于把失败藏起来。
    expect(source).toContain("view === 'child-retry'")
  })

  it('记录页在孩子为空的提示之前先挡住"还没读到"', () => {
    const source = read('pages/event-list/index.vue')
    const gate = source.indexOf('v-else-if="!childrenLoaded"')
    const lie = source.indexOf('这个家庭还没有孩子')
    expect(gate).toBeGreaterThan(-1)
    expect(gate, '还没读到的那一瞬会说"这个家庭还没有孩子"').toBeLessThan(lie)
    expect(source).toContain('if (await childStore.load(familyId.value)) await load(true)')
  })

  it('孩子切换器读的时候写"读取中"，不写"未添加"', () => {
    const source = read('components/ChildSwitcher.vue')
    expect(source).toContain('familyId.value in childStore.childrenByFamily')
    expect(source).toContain("'读取中'")
    expect(source, '触发条还在无条件说"未添加"').not.toContain("current ? current.name : '未添加'")
  })

  it('家庭设置里的孩子分区也分得清"没有"和"还不知道"', () => {
    const source = read('pages/family-settings/index.vue')
    expect(source).toContain('familyId.value in childStore.childrenByFamily')
    expect(source).toContain("childrenLoaded ? '还没有孩子'")
  })
})
