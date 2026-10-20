import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 离线出箱最容易"写歪而测试还全绿"的地方，是界面到底有没有说真话。这里直接对源码下闸门：
 * 保存/删除失败时不许谎称已存，待同步的行要看得出来，恢复网络要有人接手把队列催上去，
 * 退出登录要连着上一个账号的待上传一起清掉。
 */
const srcDir = join(__dirname, '..', '..')
const read = (...p: string[]) => readFileSync(join(srcDir, ...p), 'utf8')

describe('离线写入在界面上不说反话', () => {
  const form = read('pages', 'event-form', 'index.vue')

  it('表单走待同步入队，并且按 saved/queued 给不一样的话', () => {
    expect(form).toMatch(/outboxStore\.submitCreate\(/)
    expect(form).toMatch(/outboxStore\.submitUpdate\(/)
    expect(form).toMatch(/res\.kind === 'queued' \? '已存到待同步，恢复网络后自动上传'/)
  })

  const list = read('pages', 'event-list', 'index.vue')

  it('删除也走入队通道，排队时不把"已删除"当成事实', () => {
    expect(list).toMatch(/outboxStore\.submitDelete\(/)
    expect(list).toMatch(/已排到待同步，恢复网络后自动删除/)
  })

  it('待同步的创建并进时间线、待删的行先藏起来、并且有"待同步 N"的重试出口', () => {
    expect(list).toMatch(/pendingCreateRows\(/)
    expect(list).toMatch(/pendingDeletedIds\(/)
    expect(list).toMatch(/events\.value\.filter\(\(e\) => !pendingDeleted\.value\.has\(e\.id\)\)/)
    expect(list).toMatch(/待同步 \$\{outboxStore\.pendingCount\} 条 · 点此重试/)
    expect(list).toMatch(/@click="retrySync"/)
  })

  it('离线改一条已同步的记录，列表要立刻显示成改后的样子', () => {
    // 表单已经说了"已存到待同步"，列表却还念服务器上的旧奶量——同一屏两个答案。
    // 编辑那道 PATCH 得盖在行上，统计页也用同一个函数盖，两页才算同一份数据。
    expect(list).toMatch(/applyPendingUpdates\(/)
    expect(list).toMatch(/import \{ applyPendingUpdates, filterRows, pendingCreateRows, pendingDeletedIds \} from '\.\.\/\.\.\/sync\/pending-view'/)
  })

  it('待同步那条还没进云端，编辑要挡住而不是交给一个不存在的记录', () => {
    expect(list).toMatch(/if \(pendingIds\.value\.has\(event\.id\)\)/)
    expect(list).toMatch(/这条还在待同步，上传后才能编辑/)
  })

  const app = read('App.vue')
  it('网络一恢复、每次回前台，都催一趟待同步', () => {
    expect(app).toMatch(/uni\.onNetworkStatusChange\(/)
    expect(app).toMatch(/if \(res\.isConnected && useAuthStore\(\)\.isLoggedIn\) void useOutboxStore\(\)\.flush\(\)/)
    expect(app).toMatch(/if \(useAuthStore\(\)\.isLoggedIn\) void useOutboxStore\(\)\.flush\(\)/)
  })

  const auth = read('stores', 'auth.ts')
  it('主动退出连同上一个账号的待上传一起清掉', () => {
    expect(auth).toMatch(/useOutboxStore\(\)\.clear\(\)/)
  })
})
