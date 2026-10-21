import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = (rel: string) => readFileSync(join(__dirname, '..', '..', ...rel.split('/')), 'utf8')

const TAB_PAGES = {
  'pages/home/index.vue': 'home',
  'pages/event-list/index.vue': 'events',
  'pages/reminder-list/index.vue': 'reminders',
}

/** a 必须在 b 之前出现，否则游客会在会话还没问出来时先看到一句假话。 */
function before(who: string, text: string, a: string, b: string): void {
  const at = text.indexOf(a)
  const then = text.indexOf(b)
  expect(at, `${who} 里没有「${a}」`).toBeGreaterThan(-1)
  expect(then, `${who} 里没有「${b}」`).toBeGreaterThan(-1)
  expect(at, `${who}：「${a}」排在了「${b}」后面`).toBeLessThan(then)
}

describe('游客空状态组件', () => {
  const guide = src('components/GuestGuide.vue')

  it('文案取自 guest/guide 那一份，不在组件里另写一套', () => {
    expect(guide).toMatch(/GUEST_GUIDE\[props\.page\]/)
    expect(guide).toContain('GUEST_LOGIN_LABEL')
    expect(guide).toContain('GUEST_TEACH_LABEL')
  })

  it('主按钮去登录页，辅助那一行去教学页', () => {
    // 游客看完介绍就该有两条路：一条要账号，一条不要。
    expect(guide).toMatch(/uni\.navigateTo\(\{ url: LOGIN_ENTRY_URL \}\)/)
    expect(guide).toMatch(/uni\.navigateTo\(\{ url: TEACH_PATH \}\)/)
  })

  it('游客在这一屏伸手不到的东西：没有记一笔、没有添加、没有 FAB', () => {
    expect(guide).not.toMatch(/event-form|reminder-form|child-form|goCreate|goForm/)
  })
})

describe('三格 Tab 页都按游客分流', () => {
  for (const [rel, page] of Object.entries(TAB_PAGES)) {
    const text = src(rel)

    it(`${page}：先等会话落定，再决定说哪一句`, () => {
      // isLoggedIn 是内存态。不等 bootstrap 就看它，冷启动会把老用户演成游客。
      before(page, text, 'await authStore.bootstrap()', 'familyStore.load()')
    })

    it(`${page}：游客根本走不进"还没有家庭"那一格`, () => {
      // 2026-10-20 改了规矩：骨架先画、引导坐内容空白区，所以"引导排在家庭空态之前"
      // 不再是这句该保证的东西。更强的保证是：家庭空态在游客身上根本不出现。
      const tpl = text.slice(text.indexOf('<template>'))
      if (page === 'home') {
        expect(tpl, `${page} 没有游客分支`).toContain(`view === 'guest'`)
        return
      }
      expect(tpl, `${page} 的家庭空态没按身份挡住`).toMatch(/v-else-if="!isGuest && !familyId"/)
      expect(tpl, `${page} 的引导没认游客`).toMatch(/<guest-guide v-if="isGuest"/)
    })

    it(`${page}：会话还没问出来的那一瞬说"正在确认"`, () => {
      expect(text, `${page} 没有会话未定时的样子`).toContain('正在确认登录状态')
    })

    it(`${page}：挂游客引导这一屏时不发通知请求，也不画角标`, () => {
      // refreshUnreadTabBadge 在没有会话时自己会返回 null，但角标那一格仍会被上一次的值留着；
      // 游客这一屏必须压根不去画，而不是"画了个空的"。
      // 守卫认的是"有没有会话"而不是"是不是游客"：会话还没问出来的那一趟同样发不出这个请求。
      before(page, text, 'if (!authStore.isLoggedIn) return', 'refreshUnreadTabBadge()')
    })
  }
})

describe('游客碰不到写入的控件', () => {
  it('记录与提醒的 FAB 只在有会话时出现', () => {
    for (const rel of ['pages/event-list/index.vue', 'pages/reminder-list/index.vue']) {
      const fab = /<view v-if="([^"]*)" class="fab"/.exec(src(rel))
      expect(fab, `${rel} 找不到 FAB`).not.toBeNull()
      expect(fab![1], `${rel} 的 FAB 没按会话挡住：${fab![1]}`).toContain('!isGuest')
    }
  })

  it('首页的切换器对游客画成短横线，点了问一句而不是开选择器', () => {
    const home = src('pages/home/index.vue')
    // 旧规矩是"游客整块看不见切换器"；现在骨架要全画出来，值用短横线，点击落到门禁上。
    expect(home).not.toMatch(/<view v-if="!isGuest" class="home__switchers">/)
    const switchers = guestBranchOf(home, 'v-else-if="isGuest"', '<!--')
    expect(switchers).toContain('home__switchers')
    // 真的家庭/孩子切换器带请求与选择器，游客那一格只能是占位。
    expect(switchers).not.toMatch(/family-switcher|child-switcher/)
    expect(switchers, '游客的切换器没接门禁').toMatch(/gate\('/)
  })
})

/**
 * 这一组挡的是"游客整屏只剩引导"那个版本：用户 2026-10-20 明确要求页面骨架照常显示，
 * 引导只占内容空白区。骨架没画出来 = 游客仍然只看到一张海报，这一格就该红。
 */
function guestBranchOf(text: string, marker: string, until: string): string {
  const tpl = text.slice(text.indexOf('<template>'))
  const start = tpl.indexOf(marker)
  expect(start, `模板里找不到「${marker}」`).toBeGreaterThan(-1)
  const end = tpl.indexOf(until, start)
  expect(end, `「${marker}」这一段找不到结束标记`).toBeGreaterThan(start)
  return tpl.slice(start, end)
}

describe('游客看得到整副骨架，引导只占空白区', () => {
  it('首页：切换器 → 概览卡（短横线）→ 引导 → 记一笔 → 统计入口', () => {
    const home = src('pages/home/index.vue')
    const tpl = home.slice(home.indexOf('<template>'))
    // 引导在内容区，不在最上面：两格切换器要先画出来。
    before('home', tpl, 'v-else-if="isGuest"', '<guest-guide page="home"')
    const branch = guestBranchOf(tpl, "view === 'guest'", `v-else-if="view === 'retry'"`)
    for (const part of ['guestRows', '<guest-guide', '记一笔', '看趋势']) {
      expect(branch, `首页游客分支少了「${part}」`).toContain(part)
    }
    before('home', branch, '<guest-guide', '记一笔')
    // 行里的值必须来自游客专用的构建器：那份通用的会说"今天还没有"，而游客没有家。
    expect(home).toMatch(/const guestRows = computed\(\(\) => buildGuestOverviewRows\(\)\)/)
  })

  it('记录页：筛选栏画在引导之上，游客点它只问一句', () => {
    const events = src('pages/event-list/index.vue')
    const tpl = events.slice(events.indexOf('<template>'))
    before('events', tpl, 'class="timeline__filters"', '<guest-guide')
    expect(events).toMatch(/<guest-guide v-if="isGuest"/)
    // 筛选与导出在游客身上不许直接改状态或发请求。
    expect(events).toMatch(/if \(gate\('筛选'\)\) return/)
    expect(events).toMatch(/if \(gate\('导出 CSV'\)\) return/)
  })

  it('提醒页：三段与提醒中心画在引导之上，游客点它们只问一句', () => {
    const reminders = src('pages/reminder-list/index.vue')
    const tpl = reminders.slice(reminders.indexOf('<template>'))
    before('reminders', tpl, 'u-subsection', '<guest-guide')
    before('reminders', tpl, '提醒中心', '<guest-guide')
    expect(reminders).toMatch(/<guest-guide v-if="isGuest"/)
    expect(reminders).toMatch(/if \(gate\('提醒分段'\)\) return/)
  })

  it('三页都自带一个"游客问一句、会员照旧走"的 gate 助手', () => {
    for (const rel of ['pages/home/index.vue', 'pages/event-list/index.vue', 'pages/reminder-list/index.vue']) {
      const text = src(rel)
      expect(text, `${rel} 没接门禁`).toContain('confirmLoginGate')
      // 判断只许有这一处：散在模板的 @click 里，加一个控件就有人漏掉游客。
      expect(text, `${rel} 的游客判断没集中成一个 gate 助手`).toMatch(
        /function gate\(key: string\): boolean \{[\s\S]*?isGuest[\s\S]*?\}/,
      )
    }
  })
})
