import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const pagesDir = join(__dirname, '..', '..')

function vueFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const at = join(dir, entry.name)
    if (entry.name === '__tests__') continue
    if (entry.isDirectory()) vueFiles(at, acc)
    else if (entry.name.endsWith('.vue')) acc.push(at)
  }
  return acc
}

/**
 * `@click="go('/pages/x')"` 里 Vue 编译出的是 `$event => go('/pages/x')`：
 * 表达式跑完就丢掉返回值。所以如果 `go` 是 `(path) => () => 跳转` 这种柯里工厂，
 * 点一行只是"造了一个没人调的函数"——界面看着是入口，实际永远不动。
 * （真出过：profile 页八行全哑。）
 */
describe('@click 的处理器不能是柯里工厂', () => {
  for (const file of vueFiles(pagesDir)) {
    const src = readFileSync(file, 'utf8')
    const rel = file.slice(pagesDir.length + 1).replace(/\\/g, '/')

    it(`${rel} 的每个内联 @click 都指向一个直接执行动作的函数`, () => {
      const dead: string[] = []
      for (const [, fn] of src.matchAll(/@click="([a-zA-Z_$][\w$]*)\((?:'[^']*'|[^'")][^)]*)?\)"/g)) {
        // 只查页面里自己定义的箭头函数；emit / store 动作不在射程内。
        const def = new RegExp(`const ${fn}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*\\([^)]*\\)\\s*=>`).exec(src)
        if (def) dead.push(`${fn}: ${def[0].trim()}`)
      }
      expect(dead, `${rel} 有 @click 指向柯里工厂，点了不会动`).toEqual([])
    })
  }
})
