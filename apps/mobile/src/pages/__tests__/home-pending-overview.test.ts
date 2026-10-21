import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 断网时记下的一顿奶：记录页有它（挂着"待同步"），首页概览却说"今天 0 次"。
 * 同一屏上两个数互相打脸，人不知道该信哪个。这里锁住首页确实把出箱并进概览，
 * 并且在读它之前先把队列从盘上捞回来。
 */
const src = readFileSync(join(__dirname, '..', 'home', 'index.vue'), 'utf8')

describe('首页概览要数上待同步的那几笔', () => {
  it('概览的输入先过一遍出箱合并，并且只数当前孩子的', () => {
    expect(src).toMatch(/mergePendingRows\(\s*events\.items as EventDto\[\],[\s\S]{0,80}familyId\.value,[\s\S]{0,80}sessionMeta\.value,?\s*\)/)
    expect(src).toMatch(/\.filter\(\(e\) => e\.childId === child\.value\?\.id\)/)
  })

  it('读队列在前：内存里那份是空的，盘上才是上次记下的', () => {
    expect(src).toMatch(/outboxStore\.load\(\)/)
  })
})
