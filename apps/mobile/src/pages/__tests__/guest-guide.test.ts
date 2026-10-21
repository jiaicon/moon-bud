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

/** 某一段函数体：从它的定义到第一个顶格右花括号。 */
function functionBody(text: string, signature: string): string {
  const at = text.indexOf(signature)
  expect(at, `找不到「${signature}」`).toBeGreaterThan(-1)
  return text.slice(at, text.indexOf('\n}', at))
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

  it('首页的切换器对游客画成"无"，点了什么也不做', () => {
    const home = src('pages/home/index.vue')
    // 旧规矩是"游客整块看不见切换器"；现在骨架要全画出来，值说实话，点击不弹窗。
    expect(home).not.toMatch(/<view v-if="!isGuest" class="home__switchers">/)
    const switchers = guestBranchOf(home, 'v-else-if="isGuest"', '<!--')
    expect(switchers).toContain('home__switchers')
    // 真的家庭/孩子切换器带请求与选择器，游客那一格只能是占位。
    expect(switchers).not.toMatch(/family-switcher|child-switcher/)
    // 2026-10-21：占位就是占位，不挂任何动作——弹窗那句已经撤了。
    expect(switchers, '游客的切换器还挂着点击').not.toMatch(/@click=/)
    expect(switchers).not.toMatch(/gate\(/)
    expect(switchers, '游客切换器的值没写"无"').toContain('>无<')
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
  it('首页：切换器 → 概览卡（无）→ 引导；记一笔与曲线整块拿掉', () => {
    const home = src('pages/home/index.vue')
    const tpl = home.slice(home.indexOf('<template>'))
    // 引导在内容区，不在最上面：两格切换器要先画出来。
    before('home', tpl, 'v-else-if="isGuest"', '<guest-guide page="home"')
    const branch = guestBranchOf(tpl, "view === 'guest'", `v-else-if="view === 'retry'"`)
    for (const part of ['guestRows', '<guest-guide']) {
      expect(branch, `首页游客分支少了「${part}」`).toContain(part)
    }
    // 记一笔要落在一个孩子身上，曲线要读这一家的记录：游客两样都没有，
    // 于是这两块连入口都不画，而不是留一颗点了没反应的按钮。
    for (const gone of ['记一笔', '看趋势', 'stats-entry', 'grid__cell', 'goEvent']) {
      expect(branch, `首页游客分支还留着「${gone}」`).not.toContain(gone)
    }
    // 行里的值必须来自游客专用的构建器：那份通用的会说"今天还没有"，而游客没有家。
    expect(home).toMatch(/const guestRows = computed\(\(\) => buildGuestOverviewRows\(\)\)/)
  })

  it('记录页：筛选栏画在引导之上，游客点它只换高亮、不发请求', () => {
    const events = src('pages/event-list/index.vue')
    const tpl = events.slice(events.indexOf('<template>'))
    before('events', tpl, 'class="timeline__filters"', '<guest-guide')
    expect(events).toMatch(/<guest-guide v-if="isGuest"/)
    // 筛项对游客放开：弹窗那句已经撤了，取数由"没有家庭就返回"这一格挡着。
    expect(events, '游客点筛选还在弹窗').not.toMatch(/gate\('筛选'\)/)
    expect(events).toMatch(/async function run\(reset: boolean\): Promise<void> \{[\s\S]{0,40}if \(!familyId\.value\) return/)
    // 顶行那颗展开按钮也是筛选，游客同样点得开。
    expect(events).toMatch(/@click="openTypeSheet"/)
    expect(functionBody(events, 'function openTypeSheet()')).toMatch(/typeSheetOpen\.value = true/)
    // 导出读的是全家的记录，游客连家庭都没有：这一颗不画。
    expect(tpl).toMatch(/<view v-if="!isGuest" class="export"/)
  })

  it('提醒页：三段对游客可点，提醒中心不画', () => {
    const reminders = src('pages/reminder-list/index.vue')
    const tpl = reminders.slice(reminders.indexOf('<template>'))
    before('reminders', tpl, 'u-subsection', '<guest-guide')
    expect(reminders).toMatch(/<guest-guide v-if="isGuest"/)
    expect(reminders, '游客点分段还在弹窗').not.toMatch(/gate\('提醒分段'\)/)
    expect(reminders).toMatch(/async function run\(reset: boolean\): Promise<void> \{[\s\S]{0,40}if \(!familyId\.value\) return/)
    // 提醒中心里是这一家还没处理的通知，游客没有家：这一行整格收掉。
    expect(tpl).toMatch(/<view v-if="!isGuest" class="link-row">/)
  })

  it('三页加"我的"都不再向游客弹登录引导', () => {
    for (const rel of [
      'pages/home/index.vue',
      'pages/event-list/index.vue',
      'pages/reminder-list/index.vue',
      'pages/profile/index.vue',
    ]) {
      const text = src(rel)
      expect(text, `${rel} 还在弹"需要登录"`).not.toContain('confirmLoginGate')
      expect(text, `${rel} 还留着 gate 助手`).not.toMatch(/function gate\(key: string\)/)
    }
  })
})

describe('游客在"我的"点一行', () => {
  const profile = src('pages/profile/index.vue')
  const open = functionBody(profile, 'function open(entry')

  it('要账号的那一行直接返回，不跳也不弹', () => {
    expect(open).toMatch(/if \(needsLogin\(entry, isGuest\.value\)\) return/)
    expect(open).toContain('uni.navigateTo({ url: entry })')
    expect(profile.indexOf('needsLogin(entry')).toBeLessThan(profile.indexOf('uni.navigateTo({ url: entry })'))
  })

  it('教学与主题那两行照旧进得去，登录那颗照旧是明路', () => {
    expect(profile).toMatch(/@click="open\(TEACH_PATH\)"/)
    expect(profile).toMatch(/function goLogin\(\): void \{[\s\S]{0,40}uni\.navigateTo\(\{ url: LOGIN_ENTRY_URL \}\)/)
  })
})
