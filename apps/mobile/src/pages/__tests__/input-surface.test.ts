import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * uni-app 把 `<input>` 的宿主 `uni-input` 写成 `height: 1.4em; overflow: hidden`。
 * 于是宿主上的上下 padding 会把真正可输入的 inner input 挤成约 1px 高，打进去的字
 * 被 overflow 裁掉 —— 页面看着是个正常框，实际"无法输入"。只有宿主自己给高度、
 * padding 只留左右时才成立（family-settings / invite-qrcode 就是这么写的）。
 *
 * 这条门禁只查得出来 CSS 层面的约定，浏览器里的实测另说。
 */

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return vueFiles(full)
    return entry.endsWith('.vue') ? [full] : []
  })
}

function classTokens(tagSource: string): string[] {
  const match = /class="([^"]+)"/.exec(tagSource)
  return match ? match[1].trim().split(/\s+/) : []
}

function declarationsFor(styleSource: string, token: string): string | null {
  const css = styleSource.replace(/\/\*[\s\S]*?\*\//g, '')
  const blocks = css.match(/[^{}]+\{[^}]*\}/g) ?? []
  const selector = new RegExp(`\\.${token}(?![\\w-])`)
  const mine = blocks
    .filter((block) =>
      block
        .slice(0, block.indexOf('{'))
        .split(',')
        .some((part) => selector.test(part)),
    )
    .map((block) => block.slice(block.indexOf('{') + 1, block.lastIndexOf('}')))
  return mine.length ? mine.join(';') : null
}

function verticalPadding(decls: string): string | null {
  const shorthand = /(?:^|;)\s*padding:\s*([^;]+)/.exec(decls)
  if (shorthand) {
    const parts = shorthand[1].trim().split(/\s+/)
    return parts[0]
  }
  const explicit = /(?:^|;)\s*padding-top:\s*([^;]+)/.exec(decls)
  return explicit ? explicit[1].trim() : null
}

describe('裸 <input> 的样式约定', () => {
  // 页面和共用组件都算：AskSheet 那类面板里的输入框一旦踩了这个坑，
  // 三个页面会同时"看着能输、其实打不进字"，比单个页面更贵。
  const files = ['../../pages', '../../components']
    .flatMap((dir) => vueFiles(join(__dirname, dir)))
    .filter((file) => /<input[\s>]/.test(readFileSync(file, 'utf8')))

  it('仓库里确实扫到了裸 input（否则这条门禁是空转）', () => {
    expect(files.length).toBeGreaterThanOrEqual(4)
  })

  for (const file of files) {
    it(`${file.split(/[\\/]/).slice(-3, -1).join('/')} 的每个裸 input 类都自带高度且上下无 padding`, () => {
      const source = readFileSync(file, 'utf8')
      const style = /<style[^>]*>([\s\S]*)<\/style>/.exec(source)?.[1] ?? ''
      const tags = source.match(/<input[\s\S]*?\/>/g) ?? []
      const problems: string[] = []

      for (const tag of tags) {
        for (const token of classTokens(tag)) {
          const decls = declarationsFor(style, token)
          if (!decls) {
            problems.push(`.${token} 在本文件里没有样式规则`)
            continue
          }
          if (!/(?:^|;)\s*(height|min-height):/.test(decls)) {
            problems.push(`.${token} 没有 height（宿主被 uni-app 定成 1.4em，inner 会被压成 1px）`)
          }
          const vertical = verticalPadding(decls)
          if (vertical && vertical !== '0') {
            problems.push(`.${token} 有上下 padding: ${vertical}（会把 inner input 挤没）`)
          }
        }
      }

      expect(problems).toEqual([])
    })
  }
})
