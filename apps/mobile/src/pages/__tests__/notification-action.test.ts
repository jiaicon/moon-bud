import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(__dirname, '..', '..')
const source = readFileSync(join(srcDir, 'pages/notification-center/index.vue'), 'utf8')

/**
 * 通知中心是"顺手"的地方：看见一条到点的提醒，就地记掉，不用先进弹框再跳页。
 * 这一页钉的是三件事——动作入口确实存在、点它不会连着换页、点完列表立刻反映已读。
 */
describe('通知中心的一键记录入口', () => {
  it('到点通知右侧有动作芯片，且不冒泡成整行跳转', () => {
    expect(source).toMatch(/v-if="actionOf\(item\)"/)
    expect(source).toMatch(/@click\.stop="act\(item\)"/)
  })

  it('动作来自 quickRecordPlan，本页不自己判能不能记（归档不归档由服务端说）', () => {
    expect(source).toMatch(/quickRecordPlan\(item, new Date\(\)\)/)
    // 客户端的孩子列表接口本来就不返回归档孩子，本页没有判归档的资格；
    // 自己判过一次就是 C1：那个分支永远为 false，测试却以为它在拦。
    expect(source).not.toMatch(/archivedAt/)
    expect(source).not.toMatch(/childArchivedFor/)
  })

  it('在线那一次重新取列表；断网排队那一次就地标已读，不去取列表', () => {
    // 在线：列表回来，那条自然不再红着。
    expect(source).toMatch(/void load\(true\)/)
    // 断网时这一次 load 必定失败，「通知加载失败」会紧跟在刚记上的一笔后面，
    // 界面说得像这一笔压根没记上——而它其实已经排队等上传了。
    expect(source).toMatch(/if \(result === 'queued'\) \{/)
    expect(source).toMatch(/item\.readAt = new Date\(\)\.toISOString\(\)/)
    // 排队那一路必须先 return，不许再碰列表。
    expect(source).toMatch(/if \(result === 'queued'\) \{[\s\S]{0,800}?\n    return\n  \}\n  void load\(true\)/)
  })

  it('多条到点在弹框里没有动作，但在这一页逐条都有（这是弹框合框的补偿）', () => {
    // 断言本页不按 items.length 做任何开关：源码里 act/actionOf 都不接 index 或长度条件
    expect(source).not.toMatch(/actionOf\(item,[\s\S]*length/)
  })
})
