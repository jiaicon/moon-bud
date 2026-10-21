import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 三个表单页既能新建也能编辑，正文标题会跟着变，原生导航栏却一直是 pages.json
 * 里写死的"添加孩子/记一笔/提醒"。编辑时头顶写着"添加孩子"，人会以为自己
 * 正在新建一条重复的记录。
 */
const PAGES = ['child-form', 'event-form', 'reminder-form'] as const

describe('表单页的导航栏标题要说实话', () => {
  it.each(PAGES)('%s 在 onLoad 里按模式改过导航栏标题', (page) => {
    const src = readFileSync(join(__dirname, '..', page, 'index.vue'), 'utf8')
    expect(src).toMatch(
      /setNavigationBarTitle\(\{ title: [\s\S]{0,40}\? '编辑[\s\S]{0,20}: '(添加孩子|记一笔|新建提醒)' \}\)/,
    )
  })
})
