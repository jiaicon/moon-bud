import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ThemePresetId } from '@moonbud/shared'
import { THEME_PRESETS } from '../presets'
import { TABBAR_GLYPHS, tabBarStyle, tabBarItemPaths } from '../native-chrome'

/**
 * tabBar 图标是烘死颜色的 PNG，两份真相（主题代码 / 磁盘上的素材）很容易走散：
 * 改了预设色忘了重新生成图，或者新增了预设忘了补文件，页面只会安静地显示旧颜色
 * 或者干脆没图。这份测试把两边钉在一起。
 */
const MOBILE_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
// tabBarItemPaths 返回的是 `/static/...` 这种包内绝对路径，接在 src 后面就是磁盘上的位置。
const SRC_ROOT = `${MOBILE_ROOT}src`

const colors = JSON.parse(
  readFileSync(new URL('../../../scripts/tabbar-colors.json', import.meta.url), 'utf8'),
) as {
  presets: Record<string, { idle: Record<'light' | 'dark', string>; active: Record<'light' | 'dark', string> }>
}

const presetIds = Object.keys(THEME_PRESETS) as ThemePresetId[]

describe('tabBar 图标的颜色表', () => {
  it('覆盖的预设与 THEME_PRESETS 一一对应', () => {
    expect(Object.keys(colors.presets).sort()).toEqual([...presetIds].sort())
  })

  it('烘进 PNG 的颜色就是运行时 tabBarStyle 算出来的那两个色', () => {
    for (const id of presetIds) {
      for (const mode of ['light', 'dark'] as const) {
        const tokens = mode === 'light' ? THEME_PRESETS[id].light : THEME_PRESETS[id].dark
        const style = tabBarStyle(tokens)
        expect(colors.presets[id]?.active[mode], `${id}.${mode} 选中色`).toBe(style.selectedColor)
        expect(colors.presets[id]?.idle[mode], `${id}.${mode} 静息色`).toBe(style.color)
      }
    }
  })
})

describe('tabBar 图标素材', () => {
  it('代码里会引用到的每个路径，磁盘上都有对应的 PNG', () => {
    const missing: string[] = []
    for (const id of presetIds) {
      for (const dark of [false, true]) {
        for (let index = 0; index < TABBAR_GLYPHS.length; index++) {
          const paths = tabBarItemPaths(index, id, dark)
          for (const path of [paths.iconPath, paths.selectedIconPath]) {
            if (!existsSync(`${SRC_ROOT}${path}`)) missing.push(path)
          }
        }
      }
    }
    expect(missing, `缺 ${missing.length} 个文件`).toEqual([])
  })
})
