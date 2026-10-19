import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 对用户露面的地方一律用中文名「月芽」；moonBud 只留在安装身份里
 * （包名 @moonbud/*、appid __UNI__MOONBUD、目录名），那些不该被这条门禁管。
 */

const LATIN = /moonBud|MoonBud/

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return files(full, ext)
    return entry.endsWith(ext) ? [full] : []
  })
}

const srcDir = join(__dirname, '..', '..')

describe('应用展示名', () => {
  it('manifest 与 pages.json 的展示名是「月芽」', () => {
    const manifest = readFileSync(join(srcDir, 'manifest.json'), 'utf8')
    const pages = readFileSync(join(srcDir, 'pages.json'), 'utf8')
    expect(/"name"\s*:\s*"月芽"/.test(manifest)).toBe(true)
    expect(/"navigationBarTitleText"\s*:\s*"月芽"/.test(pages)).toBe(true)
  })

  for (const file of [...files(srcDir, '.vue'), ...files(srcDir, '.json')]) {
    it(`${file.slice(srcDir.length + 1).replace(/\\/g, '/')} 里没有拉丁品牌名`, () => {
      expect(LATIN.test(readFileSync(file, 'utf8'))).toBe(false)
    })
  }
})
