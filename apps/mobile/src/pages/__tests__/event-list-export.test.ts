import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '..', '..', 'pages', 'event-list', 'index.vue'), 'utf8')

describe('记录页的"导出当前筛选 CSV"接线', () => {
  it('导出取的是当前这套筛项，且一路翻到 total 取齐，不是只导屏幕上那几页', () => {
    // 复用与列表同一份筛项来源
    expect(src).toMatch(/function currentFilters[\s\S]*type: typeFilter\.value[\s\S]*childId: childId\.value[\s\S]*createdBy: recorderFilter\.value[\s\S]*rangeBounds\(rangeFilter\.value,\s*timezone\.value\)/)
    // 按后端单页上限 100 翻页，直到取满 total
    expect(src).toMatch(/buildEventQuery\(base,\s*page,\s*100\)/)
    expect(src).toMatch(/while \(collected\.length < total\)/)
  })

  it('导出按钮点下去跑 exportCurrent，文件名带区间、内容走 exportCsv、落地走 saveCsv', () => {
    expect(src).toMatch(/@click="exportCurrent"/)
    expect(src).toMatch(/csvFileName\([\s\S]*rangeFilter\.value[\s\S]*timezone\.value\)/)
    expect(src).toMatch(/saveCsv\(name,\s*exportCsv\(events,\s*children\.value,\s*timezone\.value\)\)/)
    expect(src).toMatch(/import \{ csvFileName, exportCsv, saveCsv \} from '\.\.\/\.\.\/events\/csv-export'/)
  })

  it('正在导出时按钮显示"导出中…"并挡住重复点', () => {
    expect(src).toMatch(/exporting\.value\) return/)
    expect(src).toMatch(/\{\{ exporting \? '导出中…' : '导出 CSV' \}\}/)
  })
})
