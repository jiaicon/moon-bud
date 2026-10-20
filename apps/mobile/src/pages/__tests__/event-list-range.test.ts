import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '..', '..', 'pages', 'event-list', 'index.vue'), 'utf8')

describe('记录页的"按日期区间筛"接线', () => {
  it('时间界由 rangeBounds 按账号时区算出，再并进 buildEventQuery', () => {
    expect(src).toMatch(/rangeBounds\(rangeFilter\.value,\s*timezone\.value\)/)
    expect(src).toMatch(/buildEventQuery\(\{[\s\S]*\.\.\.bounds[\s\S]*\},\s*next,\s*PAGE_SIZE\)/)
  })

  it('画得出 4 项预设芯片，点一次就重查', () => {
    expect(src).toMatch(/v-for="opt in RANGE_OPTIONS"/)
    expect(src).toMatch(/@click="pickRange\(opt\.value\)"/)
    expect(src).toMatch(/function pickRange\(next: EventRange\)[\s\S]*rangeFilter\.value = next[\s\S]*load\(true\)/)
  })

  it('筛完为空时空状态要念出时间区间，而不是"家里没有记录"', () => {
    expect(src).toMatch(/rangeFilter\.value \? RANGE_OPTIONS\.find[\s\S]*\?\.label/)
  })
})
