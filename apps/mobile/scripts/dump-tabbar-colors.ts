import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { THEME_PRESETS } from '../src/theme/presets'
import { tabBarStyle } from '../src/theme/native-chrome'

/**
 * tabBar 图标是烘死颜色的 PNG，PowerShell 生成脚本读不动 TS，所以颜色由这里导出。
 * 改了预设色就重跑 `npx vite-node scripts/dump-tabbar-colors.ts`，再跑
 * `gen-tabbar-icons.ps1`；两份真相走散了由 __tests__/tabbar-icons.test.ts 报红。
 */
const out = {
  note: '生成物，别手改：npx vite-node scripts/dump-tabbar-colors.ts',
  size: 81,
  presets: {} as Record<string, { idle: { light: string; dark: string }; active: { light: string; dark: string } }>,
}

for (const [id, preset] of Object.entries(THEME_PRESETS)) {
  const light = tabBarStyle(preset.light)
  const dark = tabBarStyle(preset.dark)
  out.presets[id] = {
    idle: { light: light.color, dark: dark.color },
    active: { light: light.selectedColor, dark: dark.selectedColor },
  }
}

writeFileSync(
  fileURLToPath(new URL('./tabbar-colors.json', import.meta.url)),
  `${JSON.stringify(out, null, 2)}\n`,
)
console.log(`wrote ${Object.keys(out.presets).length} presets`)
