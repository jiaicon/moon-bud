import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '..', '..', 'pages', 'event-list', 'index.vue'), 'utf8')

describe('记录页的"按记录人筛"接线', () => {
  it('请求里的筛项全部走 buildEventQuery，空值不会当成条件发出去', () => {
    expect(src).toMatch(/buildEventQuery\(\{[^}]*type: typeFilter\.value[^}]*childId: childId\.value[^}]*createdBy: recorderFilter\.value/)
  })

  it('有记录人这一行，且一个人的家庭不画它', () => {
    expect(src).toContain('id="recorder-chips"')
    expect(src).toMatch(/v-if="recorders\.length > 1"[^>]*id="recorder-chips"|id="recorder-chips"[\s\S]*?v-if/)
    expect(src).toMatch(/v-if="recorders\.length > 1"/)
    expect(src).toContain('pickRecorder(')
  })

  it('名单是问服务端要的，不是拿"我 + 记录里出现过的人"凑的', () => {
    expect(src).toMatch(/membersApi\.list\(/)
  })

  it('换家庭会把记录人筛选清掉：上一个家庭的人在这里没有意义', () => {
    expect(src).toMatch(/watch\(familyId,[\s\S]*recorderFilter\.value = ''[\s\S]*\}\)/)
  })

  it('筛选下空着时念的是筛选，不是"家里没有记录"', () => {
    expect(src).toMatch(/const emptyCopy = computed\([\s\S]*emptyListCopy\(/)
    expect(src).toMatch(/:title="emptyCopy\.title"/)
    expect(src).toMatch(/:hint="emptyCopy\.hint"/)
  })
})
