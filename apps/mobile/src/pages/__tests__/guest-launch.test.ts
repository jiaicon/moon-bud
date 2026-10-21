import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = (rel: string) => readFileSync(join(__dirname, '..', '..', ...rel.split('/')), 'utf8')

/** pages.json 允许 `//` 注释，JSON.parse 之前要剥掉。 */
function routes(): Array<{ path: string; style?: { navigationBarTitleText?: string } }> {
  return JSON.parse(src('pages.json').replace(/^\s*\/\/.*$/gm, '')).pages
}

/** 递归收集 src 下的源码文件，用来确认没有代码还指着已删掉的那一页。测试文件自己不在其列。 */
function files(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__') files(full, acc)
    } else if (/\.(vue|ts)$/.test(name)) acc.push(full)
  }
  return acc
}

/**
 * 游客现在从首页进应用，欢迎页整页删除。
 *
 * 这一格挡的是两种回归：pages.json 的第一条被人挪回欢迎页（启动就又把人关在门外），
 * 以及某处还 reLaunch 到一个已经不存在的路由（点了没反应，还不报错）。
 */
describe('启动页就是首页，欢迎页已经不存在', () => {
  it('pages.json 第一条是首页', () => {
    expect(routes()[0].path).toBe('pages/home/index')
  })

  it('注册路由里没有 welcome', () => {
    expect(routes().map((r) => r.path)).not.toContain('pages/welcome/index')
  })

  it('src 下再没有任何源码文件提到已删掉的那一页', () => {
    // 扫的是整个 src：产品代码里任何一处 reLaunch/navigateTo 到这条路，点了只会没反应。
    const root = join(__dirname, '..', '..')
    const pointing = files(root).filter((f) => readFileSync(f, 'utf8').includes('pages/welcome'))
    expect(pointing, `这些地方还指着已删掉的欢迎页：${pointing.join(', ')}`).toEqual([])
  })

  it('预览那一页改口叫教学', () => {
    const preview = routes().find((r) => r.path === 'pages/preview/index')
    expect(preview?.style?.navigationBarTitleText).toBe('功能教学')
  })
})
