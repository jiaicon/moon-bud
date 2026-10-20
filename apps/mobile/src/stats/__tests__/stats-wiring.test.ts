import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(__dirname, '..', '..')
const page = readFileSync(join(srcDir, 'pages', 'stats', 'index.vue'), 'utf8')
const home = readFileSync(join(srcDir, 'pages', 'home', 'index.vue'), 'utf8')
const pagesJson = readFileSync(join(srcDir, 'pages.json'), 'utf8')

/**
 * 统计页是"界面不许说谎"的又一处：
 *
 * 1. 切日与生长点的日期标签都必须走账号时区，而不是设备本地——和列表/首页一致，
 *    否则凌晨那条在两个家长手机上算不同的一天，柱状图横轴就假了。
 * 2. 加载失败 ≠ 没有数据。失败要出 error 文案 + 出路，不能对着失败的接口喊"还没有记录"。
 * 3. 每日柱子来自纯函数 careSeries 的逐日桶（含空白天），生长折线来自 growthSeries+valueExtent，
 *    页面自己不许重算一遍聚合——那会跟单测覆盖的那份分叉。
 */
describe('统计页接线', () => {
  it('用账号时区调用纯聚合函数，页面不自己重算', () => {
    expect(page).toMatch(/careSeries\(statsEvents\.value,\s*timezone\.value,\s*windowDays\.value\)/)
    expect(page).toMatch(/growthSeries\(statsEvents\.value,\s*timezone\.value,\s*growthField\.value\)/)
    expect(page).toMatch(/maxCareValue\(buckets\.value,\s*metric\.value\)/)
    expect(page).toMatch(/valueExtent\(growthPoints\.value\)/)
    // 翻页取数按 id 去重：分页是 skip/take + 固定倒序，别的家长在这一趟里记了一条就会让行号
    // 整体位移，同一条记录可能在两页各出现一次（或被顶掉），次数与奶量就此说谎。
    expect(page).toMatch(/uniqueById\(/)
  })

  it('统计聚合的是"眼前那份数据"：待同步的创建/编辑/删除都算数', () => {
    // 记录页明明画着这一行（还写着"待同步"），统计却不认它——同一屏两个答案，
    // 家长会以为图错了或者记录丢了。所以先并出那份眼前数据，再交给纯聚合。
    expect(page).toMatch(/const statsEvents = computed\(\(\) =>/)
    expect(page).toMatch(/pendingDeletedIds\(/)
    expect(page).toMatch(/applyPendingUpdates\(/)
    expect(page).toMatch(/pendingCreateRows\(/)
    expect(page).toMatch(/filterRows\(/)
  })

  it('加载失败与"这段时间没有数据"是两条不同的路，失败不被说成没有', () => {
    expect(page).toMatch(/v-if="error"/)
    // 首屏就失败时 events 是空的，`!error` 一挡，柱状图那条 v-else 会画出满屏 0 高的柱子
    // ——那是"这七天什么都没记"的样子，而真相是"我没读到"。图只在该有数的时候画。
    expect(page).toMatch(/<scroll-view v-if="hasDaily"/)
    expect(page).toMatch(/v-else-if="!error && !loading"/)
    // 生长那一栏同理：曲线只在有点的时候画，空文案只在没失败、没加载时才念
    expect(page).toMatch(/<view v-if="growthPoints\.length"/)
  })

  it('诚实交代口径：待同步的那几条也进了图，就明说它们的身份', () => {
    // 旧文案"统计只含已同步到服务器的记录"在并进取数之后就是假话了。
    // 本机上压着几条没传上去的，界面要念出"有几条、已计入"，而不是继续否认。
    expect(page).toMatch(/条没传上去的记录/)
    expect(page).toMatch(/已经一并算进/)
    expect(page).not.toMatch(/统计只含已同步到服务器的记录/)
    // 待同步要用出箱队列，就得先把本地那份读回来，否则统计永远看不到它。
    expect(page).toMatch(/outboxStore\.load\(\)/)
  })

  it('刷新失败但手上还有旧数字时，说清这些数是几点读到的', () => {
    // 上一次成功读到的数字 + 一行"失败了"，仍然可能让人以为那是此刻的状态；
    // 时间标签把"这是刚才读到的"这件事交还给界面。
    expect(page).toMatch(/loadedAt\.value = Date\.now\(\)/)
    expect(page).toMatch(/readAtLabel\(timezone\.value,\s*loadedAt\.value\)/)
    expect(page).toMatch(/v-if="error && events\.length && readAt"/)
  })

  it('路由已注册，且从首页有入口（不占底部 Tab 第 5 格）', () => {
    expect(pagesJson).toMatch(/"pages\/stats\/index"/)
    expect(home).toMatch(/goStats[\s\S]*navigateTo\(\{ url: '\/pages\/stats\/index' \}\)/)
  })
})
