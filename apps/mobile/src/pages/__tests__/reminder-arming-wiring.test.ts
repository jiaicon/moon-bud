import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', ...parts), 'utf8')

const app = read('App.vue')
const form = read('pages', 'reminder-form', 'index.vue')
const list = read('pages', 'reminder-list', 'index.vue')

/**
 * 本地推送只会"在某一刻响一次"。哪个页面在什么时机重排它，决定了家长建好一条
 * 重复提醒后，第二天还有没有声音 —— 而家长不会回头编辑它。
 */
describe('提醒排期的重算时机', () => {
  it('每次回到前台都重排一次', () => {
    const onShow = app.indexOf('onShow(() => {')
    expect(onShow).toBeGreaterThan(-1)
    const body = app.slice(onShow, app.indexOf('})', onShow))
    expect(body).toMatch(/resyncActiveReminderSchedules\(\)/)
  })

  it('保存或改完提醒后立刻重排，不等下一次开 App', () => {
    const onSubmit = form.indexOf('async function onSubmit')
    expect(onSubmit).toBeGreaterThan(-1)
    const body = form.slice(onSubmit, form.indexOf('\n}', onSubmit))
    expect(body).toMatch(/await resyncActiveReminderSchedules\(\)/)
  })

  it('停掉提醒走本地撤销，不依赖重算能不能拉到列表', () => {
    const cancel = form.indexOf('async function cancelReminder')
    expect(cancel).toBeGreaterThan(-1)
    const body = form.slice(cancel, form.indexOf('\n}', cancel))
    expect(body).toMatch(/disarmReminder\(reminderId\.value\)/)
  })

  it('完成本次后重排：这一次完了，下一次的时间点要重新落', () => {
    const complete = list.indexOf('async function complete')
    expect(complete).toBeGreaterThan(-1)
    const body = list.slice(complete, list.indexOf('\n}', complete))
    expect(body).toMatch(/await resyncActiveReminderSchedules\(\)/)
  })

  it('没有哪一页还在只排"下一次"——那正是响过就哑掉的写法', () => {
    expect(form).not.toMatch(/scheduleLocalNotification/)
    expect(list).not.toMatch(/scheduleLocalNotification/)
    expect(form).not.toMatch(/cancelLocalNotification/)
    expect(list).not.toMatch(/cancelLocalNotification/)
  })
})
