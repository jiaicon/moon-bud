import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(__dirname, '..', '..')

/**
 * 危险操作的失败必须在操作旁边说出来。家庭设置页的错误文本只挂在"家庭名称"
 * 那块表单里（v-if="canManage"），而"退出家庭"对普通成员也开着：失败写进
 * `error` 就等于没说话，用户会以为已经退出了。移除孩子的失败用的就是 toast，
 * 这里对齐。
 */
const source = readFileSync(join(srcDir, 'pages/family-settings/index.vue'), 'utf8')

function bodyOf(fn: string): string {
  const start = source.indexOf(`async function ${fn}(`)
  expect(start, `${fn} 不在了`).toBeGreaterThan(-1)
  const end = source.indexOf('\n}', start)
  return source.slice(start, end)
}

describe('危险操作的失败反馈', () => {
  for (const action of ['leave', 'archive']) {
    it(`${action} 失败时用 toast 当场说出来，不写进只有管理员看得见的位置`, () => {
      const body = bodyOf(action)
      expect(body).toContain('uni.showToast')
      expect(body).not.toContain('error.value')
    })
  }
})
