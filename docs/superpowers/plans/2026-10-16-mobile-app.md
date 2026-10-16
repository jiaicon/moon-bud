# moonBud 移动端（uni-app 客户端）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个 uni-app + Vue3 + TS 客户端，实现游客只读预览、账号密码登录注册、家庭切换、记录、提醒、主题切换，代码同时兼容 Android / iOS / 鸿蒙，以 Android 优先。

**Architecture:** uni-app CLI 工程（Vite + TS），Pinia 管状态，uView Pro 提供组件与 `useTheme`。页面按职责分层：`pages/` 放页面、`theme/` 放语义色令牌与预设、`api/` 放 HTTP 客户端与端点封装、`stores/` 放 Pinia store。**所有颜色必须走主题语义变量**。开发预览走 `dev:h5`，因本机无 HBuilderX（见 spec 第 0、14 节）。

**Tech Stack:** uni-app（标准版，非 uni-app x）· Vue 3 · TypeScript 5 · Vite · Pinia · uView Pro 0.6.x · Vitest（逻辑单测）· 微信开发者工具/浏览器（预览）

**Spec:** `docs/superpowers/specs/2026-10-16-moonbud-design.md`
**Depends on:** `2026-10-16-shared-contract.md`（必须完成）· `2026-10-16-api-backend.md`（接口契约来源；可并行开工但要联调则需后端已跑）

## Global Constraints

- **标准 uni-app，不是 uni-app x**（spec 第 11 节）。不要用 UTS 语法
- **所有颜色引用 `theme/tokens` 的语义变量**，禁止在页面里写死颜色值（spec 第 7 节）——这是换肤长期成立的唯一保证
- 主题与"当前孩子"存**本地**，不上服务端；当前孩子**按 familyId 分别存**（spec 第 3 节）
- 底部 Tab **固定 4 格**；第 5 格（育儿知识）只留注释与常量占位，**不加空页面**
- 记录表单每个类型只要求**一两个必填字段**；从首页到保存**不超过 3 步**（spec 第 9 节）
- 游客 preview 页**只读**：不接真实 API、不写任何数据；**主题切换是唯一允许的真实交互**
- 请求 baseURL **必须走配置**，不写死 `localhost`（spec 第 17 节：手机访问不了 localhost）
- 平台差异**必须用条件编译**（`#ifdef APP-PLUS` / `#ifndef`），不得用运行时判断——尤其是 `plus.*` API，鸿蒙不支持（spec 第 14 节）
- 账号校验复用 `@moonbud/shared` 的 `USERNAME_PATTERN` / `isValidUsername` / `PASSWORD_MIN_LENGTH`
- 不引入 iconfont 以外的外部字体、不引入除 uView Pro 外的 UI 库

## Review Focus

spec 未逐条规定、用户会真实踩到的五类问题。每条在下表指定任务中有测试：

1. **手机上 API 地址指向 localhost** —— 真机上必然连不上，且报错难懂。baseURL 必须来自配置。测试在 Task 2。
2. **家庭切换后"当前孩子"串到另一个家庭** —— 一个家庭的孩子名出现在另一个家庭里，属数据错乱级问题。测试在 Task 4。
3. **网络失败导致白屏或永久 loading** —— 断网、后端没起、token 过期都应给出可理解的提示并允许重试，而不是卡住。测试在 Task 2、3。
4. **写死颜色的页面在换主题后不变** —— 换肤只改了一半界面。测试在 Task 1（令牌唯一来源）与 Task 5（切换后重绘）。
5. **记录表单必填项多于两个** —— 单手抱娃时无法完成，直接被用户放弃。测试在 Task 6（每个类型的必填字段数 ≤ 2）。

---

### Task 1: 主题语义令牌与 4 套预设

**Files:**
- Create: `apps/mobile/package.json`
- Create: `apps/mobile/tsconfig.json`
- Create: `apps/mobile/vite.config.ts`
- Create: `apps/mobile/src/theme/tokens.ts`
- Create: `apps/mobile/src/theme/presets.ts`
- Create: `apps/mobile/src/theme/apply-theme.ts`
- Create: `apps/mobile/src/theme/index.ts`
- Test: `apps/mobile/src/theme/__tests__/presets.test.ts`

**Interfaces:**
- Consumes: `@moonbud/shared` 的 `ThemePresetId`
- Produces:
  - `type ThemeTokens = { primary: string; primaryLight: string; success: string; warning: string; error: string; background: string; surface: string; surfaceAlt: string; textPrimary: string; textSecondary: string; textDisabled: string; border: string; divider: string }`
  - `const lightTokens: ThemeTokens` / `const darkTokens: ThemeTokens`（结构模板，`primary` 由预设覆盖）
  - `THEME_PRESETS: Record<ThemePresetId, { id: ThemePresetId; name: string; light: ThemeTokens; dark: ThemeTokens }>` —— 4 套：`mist-blue`（晨雾蓝，默认）、`cream-orange`（奶油橘）、`mint-green`（薄荷绿）、`dusk-purple`（暮色紫）
  - `tokenNames(): (keyof ThemeTokens)[]`
  - `toCssVars(tokens: ThemeTokens): Record<string, string>` —— 产出 `--mb-color-primary` 形式的 CSS 变量表
  - `applyTheme(presetId: ThemePresetId, dark: boolean): void` —— 写 CSS 变量到页面根节点并 `uni.setStorageSync('theme', presetId)` / `('themeMode', 'light'|'dark'|'auto')`
  - `resolveDark(mode: 'light' | 'dark' | 'auto', systemDark: boolean): boolean`

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/mobile/src/theme/__tests__/presets.test.ts
import { describe, expect, it } from 'vitest'
import { THEME_PRESETS, lightTokens, resolveDark, tokenNames, toCssVars } from '../presets'

describe('主题预设', () => {
  it('恰好 4 套预设，且 id 与键一致', () => {
    expect(Object.keys(THEME_PRESETS)).toHaveLength(4)
    for (const [key, preset] of Object.entries(THEME_PRESETS)) {
      expect(preset.id).toBe(key)
    }
  })

  it('每套预设的明暗两版都覆盖全部语义令牌', () => {
    const names = tokenNames()
    expect(names.length).toBeGreaterThanOrEqual(13)
    for (const preset of Object.values(THEME_PRESETS)) {
      for (const tokens of [preset.light, preset.dark]) {
        for (const name of names) {
          expect(tokens[name], `${preset.id}.${name} 缺失`).toMatch(/^#[0-9A-Fa-f]{6}$/)
        }
      }
    }
  })

  it('四套预设的 primary 互不相同（否则换肤没有可见效果）', () => {
    const primaries = Object.values(THEME_PRESETS).map((p) => p.light.primary.toLowerCase())
    expect(new Set(primaries).size).toBe(4)
  })

  it('暗色版背景比文字暗（对比方向不能反）', () => {
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16)
      return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)
    }
    for (const preset of Object.values(THEME_PRESETS)) {
      expect(lum(preset.dark.background)).toBeLessThan(lum(preset.dark.textPrimary))
      expect(lum(preset.light.background)).toBeGreaterThan(lum(preset.light.textPrimary))
    }
  })

  it('模板令牌与预设令牌键集合完全一致', () => {
    const names = tokenNames().sort()
    for (const preset of Object.values(THEME_PRESETS)) {
      expect(Object.keys(preset.light).sort()).toEqual(names)
    }
    expect(Object.keys(lightTokens).sort()).toEqual(names)
  })

  it('toCssVars 产出带前缀的 CSS 变量名', () => {
    const vars = toCssVars(THEME_PRESETS['mist-blue'].light)
    expect(vars['--mb-color-primary']).toBe(THEME_PRESETS['mist-blue'].light.primary)
    expect(Object.keys(vars).every((k) => k.startsWith('--mb-color-'))).toBe(true)
  })

  it('resolveDark 处理 auto 模式', () => {
    expect(resolveDark('light', true)).toBe(false)
    expect(resolveDark('dark', false)).toBe(true)
    expect(resolveDark('auto', true)).toBe(true)
    expect(resolveDark('auto', false)).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/mobile test`
Expected: FAIL —— `Cannot find module '../presets'`

- [ ] **Step 3: 建 uni-app CLI 工程并装依赖**

用官方 TS 模板：`npx degit dcloudio/uni-preset-vue#vite-ts apps/mobile`。

`package.json` 要点：`"name": "@moonbud/mobile"`，devDeps 含 `@dcloudio/uni-app`、`@dcloudio/vite-plugin-uni`、`vue`、`pinia`、`typescript`、`vite`、`vitest`，deps 含 `uview-pro`（0.6.x）与 `@moonbud/shared: workspace:*`。scripts 保留模板的 `dev:h5` / `build:h5` / `dev:app` / `build:app-plus`，新增 `test: vitest run`。

**注意**：模板的 `src/` 结构（`pages.json`、`manifest.json`、`App.vue`、`main.ts`、`pages/`）保持原样，所有新文件放 `src/` 下。

- [ ] **Step 4: 实现 `tokens.ts` 与 `presets.ts`**

`tokens.ts` 只放类型与两个结构模板（`lightTokens` 的 `primary` 用占位值，仅作为"键齐全"的模板；实际使用一律从 `THEME_PRESETS` 取）。

`presets.ts` 定义 4 套预设。配色要求：**每套的 `primary` 有明显色相差异**（蓝 / 橘 / 绿 / 紫），且 `background`→`textPrimary` 的明暗方向在明暗两版中相反（测试会验证）。

`tokenNames()` 返回 `Object.keys(lightTokens)`。`toCssVars` 把 `primaryLight` 转成 `--mb-color-primary-light`（camelCase → kebab-case）。

- [ ] **Step 5: 实现 `apply-theme.ts`**

`applyTheme(presetId, dark)`：
1. 从 `THEME_PRESETS[presetId]` 取 `dark ? preset.dark : preset.light`。
2. 用 `toCssVars` 得到变量表。
3. **写入 CSS 变量**：H5 端用 `document.documentElement.style.setProperty(k, v)`（用条件编译 `#ifdef H5`）；APP/小程序端把变量挂到 `uni.setStorageSync('themeVars', vars)`，并在根组件 `App.vue` 里用 `:style` 绑定到根 `view`（`#ifndef H5`）。**这是跨端唯一的可行做法**——小程序不支持全局 CSS 变量注入。
4. 持久化 `theme` 与 `themeMode`。

**这个双路径是本任务最容易做错的地方**，必须在 Task 5 的预览页上真实验证两个端都能换色。

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm --filter @moonbud/mobile test`
Expected: PASS —— 7 个测试绿

- [ ] **Step 7: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): add theme tokens and four color presets"
```

---

### Task 2: HTTP 客户端（配置化 baseURL、错误与重试）

**Files:**
- Create: `apps/mobile/src/config/env.ts`
- Create: `apps/mobile/src/api/http.ts`
- Create: `apps/mobile/src/api/errors.ts`
- Test: `apps/mobile/src/api/__tests__/http.test.ts`
- Create: `apps/mobile/.env.development` / `.env.production`

**Interfaces:**
- Consumes: `@moonbud/shared` 的 `ApiError`
- Produces:
  - `const API_BASE_URL: string`（来自 `import.meta.env.VITE_API_BASE_URL`，**缺失时抛错而不是回退到 localhost**）
  - `class ApiRequestError extends Error { statusCode: number; isNetworkError: boolean }`
  - `interface RequestOptions { method?: 'GET'|'POST'|'PATCH'|'DELETE'; data?: unknown; auth?: boolean; timeoutMs?: number }`
  - `apiRequest<T>(path: string, options?: RequestOptions): Promise<T>`
  - `setAccessToken(token: string | null): void` / `getAccessToken(): string | null`
  - `setRefreshHandler(fn: () => Promise<string>): void` —— 401 时调用它换新 token 并重放一次请求
  - `normalizeError(e: unknown): ApiRequestError`

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/mobile/src/api/__tests__/http.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError, normalizeError } from '../errors'
import { buildUrl, shouldRetryAfterRefresh } from '../http'

describe('buildUrl', () => {
  it('拼接 baseURL 与 path，且不产生双斜杠', () => {
    expect(buildUrl('http://192.168.1.5:3000/api', '/families/1')).toBe('http://192.168.1.5:3000/api/families/1')
    expect(buildUrl('http://192.168.1.5:3000/api/', '/families/1')).toBe('http://192.168.1.5:3000/api/families/1')
  })

  it('把 query 对象序列化，跳过 undefined 与 null', () => {
    const url = buildUrl('http://h/api', '/events', { childId: 'c1', page: 1, type: undefined, from: null })
    expect(url).toBe('http://h/api/events?childId=c1&page=1')
  })

  it('对值做 URL 编码（家庭名等可能含中文）', () => {
    expect(buildUrl('http://h/api', '/x', { q: '宝宝 奶' })).toBe('http://h/api/x?q=%E5%AE%9D%E5%AE%9D%20%E5%A5%B6')
  })
})

describe('shouldRetryAfterRefresh', () => {
  it('401 且尚未重放过才刷新重试', () => {
    expect(shouldRetryAfterRefresh(401, false)).toBe(true)
    expect(shouldRetryAfterRefresh(401, true)).toBe(false)
  })

  it('403 不触发刷新（越权重试没有意义）', () => {
    expect(shouldRetryAfterRefresh(403, false)).toBe(false)
  })

  it('5xx 与网络错误不触发刷新', () => {
    expect(shouldRetryAfterRefresh(500, false)).toBe(false)
    expect(shouldRetryAfterRefresh(0, false)).toBe(false)
  })
})

describe('normalizeError', () => {
  it('把 uni.request 的失败对象转成带网络标记的错误', () => {
    const e = normalizeError({ errMsg: 'request:fail timeout' })
    expect(e).toBeInstanceOf(ApiRequestError)
    expect(e.isNetworkError).toBe(true)
    expect(e.message).toMatch(/网络|连接/)
  })

  it('把后端 ApiError 转成用户可读文案', () => {
    const e = normalizeError({ statusCode: 400, data: { statusCode: 400, message: ['账号需为 4–20 位字母、数字或下划线'], error: 'Bad Request' } })
    expect(e.statusCode).toBe(400)
    expect(e.message).toContain('4–20')
    expect(e.isNetworkError).toBe(false)
  })

  it('message 为数组时全部拼接，不出现 [object Object]', () => {
    const e = normalizeError({ statusCode: 400, data: { message: ['a', 'b'] } })
    expect(e.message).toBe('a; b')
  })

  it('未知错误也有可读文案', () => {
    expect(normalizeError(undefined).message).toBeTruthy()
    expect(normalizeError({}).message).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/mobile test`
Expected: FAIL —— `Cannot find module '../errors'`

- [ ] **Step 3: 实现 `config/env.ts`**

```typescript
const raw = import.meta.env.VITE_API_BASE_URL as string | undefined
if (!raw) {
  // 刻意抛错：回退到 localhost 会在真机上表现为"莫名连不上"，比启动即失败更难排查
  throw new Error('缺少 VITE_API_BASE_URL，请在 apps/mobile/.env.development 中配置（真机请填开发机的局域网 IP）')
}
export const API_BASE_URL = raw.replace(/\/+$/, '')
```

`.env.development` 写 `VITE_API_BASE_URL=http://192.168.1.100:3000/api` 并在文件里用注释提醒改成自己的局域网 IP；`.env.production` 留占位。

- [ ] **Step 4: 实现 `errors.ts` 与 `http.ts`**

`errors.ts`：`ApiRequestError`、`normalizeError`。`normalizeError` 必须处理四种输入：uni 的 `{ errMsg }`（→ 网络错误，文案"网络连接失败，请检查网络后重试"）、后端 `{ statusCode, data: ApiError }`（→ 用 `data.message`，数组用 `'; '` 连接）、普通 `Error`、以及 `undefined`/`{}`（→ "请求失败，请稍后重试"）。

`http.ts` 导出 `buildUrl(base, path, query?)`（纯函数，便于测试）、`shouldRetryAfterRefresh(status, alreadyRetried)`、`apiRequest`。`apiRequest` 逻辑：

1. `uni.request({ url, method, data, timeout: options.timeoutMs ?? 15000, header: {...} })`，`auth !== false` 时带 `Authorization`。
2. 2xx → `resolve(data)`。
3. `shouldRetryAfterRefresh` 为真且有 refresh handler → 调 handler 拿新 token → 重放一次（**最多一次，用局部 flag 防死循环**）。
4. 否则 `reject(normalizeError(res))`。
5. `fail` 回调 → `reject(normalizeError(err))`。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @moonbud/mobile test`
Expected: PASS —— 11 个测试绿

- [ ] **Step 6: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): add configurable http client with error normalization"
```

---

### Task 3: 状态层（auth / family / child / theme store）

**Files:**
- Create: `apps/mobile/src/stores/auth.ts`
- Create: `apps/mobile/src/stores/family.ts`
- Create: `apps/mobile/src/stores/child.ts`
- Create: `apps/mobile/src/stores/theme.ts`
- Create: `apps/mobile/src/api/endpoints.ts`
- Test: `apps/mobile/src/stores/__tests__/child.test.ts`
- Test: `apps/mobile/src/stores/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `apiRequest`；`@moonbud/shared` 的 DTO 类型
- Produces:
  - `endpoints.ts`：`authApi.register/login/refresh/changePassword`、`meApi.get`、`familiesApi.list/create/get/update/archive/transfer/leave`、`membersApi.list/updateRole/remove/resetPassword`、`invitesApi.create/list/revoke/accept`、`childrenApi.list/create/update/remove`、`eventsApi.list/create/update/remove/latest`、`remindersApi.list/create/update/complete/cancel/occurrences`、`notificationsApi.list/markRead/readAll` —— 每个函数签名精确到参数与返回类型（全部来自 `@moonbud/shared`）
  - `useAuthStore()`：state `{ user: UserDto | null; token: string | null; mustChangePassword: boolean; status: 'idle'|'loading'|'error'; error: string | null }`；actions `register`、`login`、`logout`、`changePassword`、`bootstrap`（用本地 refresh token 静默登录）
  - `useFamilyStore()`：state `{ families: FamilyDto[]; currentFamilyId: string | null }`；actions `load`、`create`、`switch`、`leave`、`archive`；getter `currentFamily`
  - `useChildStore()`：state `{ childrenByFamily: Record<string, ChildDto[]>; currentChildIdByFamily: Record<string, string | null> }`；actions `load(familyId)`、`select(familyId, childId)`、`create`、`remove`；getter `currentChild(familyId)`
  - `useThemeStore()`：state `{ presetId: ThemePresetId; mode: 'light'|'dark'|'auto'; systemDark: boolean }`；actions `setPreset`、`setMode`、`init`

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/mobile/src/stores/__tests__/child.test.ts
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/endpoints', () => ({
  childrenApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))

import { childrenApi } from '../../api/endpoints'
import { useChildStore } from '../child'

const childA = { id: 'c-a', familyId: 'f1', name: '大宝', gender: 'UNKNOWN', birthday: '2025-01-01', avatarUrl: null, archivedAt: null }
const childB = { id: 'c-b', familyId: 'f2', name: '二宝', gender: 'UNKNOWN', birthday: '2026-01-01', avatarUrl: null, archivedAt: null }

describe('child store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ;(childrenApi.list as ReturnType<typeof vi.fn>).mockImplementation((familyId: string) =>
      Promise.resolve(familyId === 'f1' ? [childA] : [childB]))
  })

  it('当前孩子按家庭分别记录，互不串台', async () => {
    const store = useChildStore()
    await store.load('f1')
    await store.load('f2')
    store.select('f1', 'c-a')
    store.select('f2', 'c-b')
    expect(store.currentChild('f1')?.name).toBe('大宝')
    expect(store.currentChild('f2')?.name).toBe('二宝')
  })

  it('没有选择过时回退到该家庭第一个孩子', async () => {
    const store = useChildStore()
    await store.load('f1')
    expect(store.currentChild('f1')?.id).toBe('c-a')
  })

  it('记住的孩子已被归档时回退到第一个', async () => {
    const store = useChildStore()
    await store.load('f1')
    store.select('f1', 'c-a')
    ;(childrenApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([])
    await store.load('f1')
    expect(store.currentChild('f1')).toBeNull()
  })

  it('记住的孩子不属于该家庭时不返回它', async () => {
    const store = useChildStore()
    await store.load('f2')
    store.select('f1', 'c-a')
    expect(store.currentChild('f2')?.id).toBe('c-b')
  })

  it('零个孩子的家庭返回 null 而不抛错', async () => {
    ;(childrenApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const store = useChildStore()
    await store.load('f1')
    expect(store.currentChild('f1')).toBeNull()
  })
})
```

```typescript
// apps/mobile/src/stores/__tests__/auth.test.ts
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/endpoints', () => ({
  authApi: { register: vi.fn(), login: vi.fn(), refresh: vi.fn(), changePassword: vi.fn() },
  meApi: { get: vi.fn() },
}))

import { authApi } from '../../api/endpoints'
import { useAuthStore } from '../auth'

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    uni.setStorageSync('refreshToken', '')
  })

  it('登录失败时记录可读错误且不写入 token', async () => {
    ;(authApi.login as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('账号或密码不正确'))
    const store = useAuthStore()
    await store.login('mama2024', 'wrongpass')
    expect(store.token).toBeNull()
    expect(store.status).toBe('error')
    expect(store.error).toContain('账号或密码不正确')
  })

  it('登录成功后写入 token 与用户并持久化 refresh token', async () => {
    ;(authApi.login as ReturnType<typeof vi.fn>).mockResolvedValue({
      accessToken: 'at', refreshToken: 'rt',
      user: { id: 'u1', username: 'mama2024', nickname: '妈妈', timezone: 'Asia/Shanghai', avatarUrl: null },
      mustChangePassword: false,
    })
    const store = useAuthStore()
    await store.login('mama2024', 'pass12345')
    expect(store.token).toBe('at')
    expect(store.user?.nickname).toBe('妈妈')
    expect(uni.getStorageSync('refreshToken')).toBe('rt')
  })

  it('登出清空全部本地会话状态', async () => {
    ;(authApi.login as ReturnType<typeof vi.fn>).mockResolvedValue({
      accessToken: 'at', refreshToken: 'rt',
      user: { id: 'u1', username: 'mama2024', nickname: '妈妈', timezone: 'Asia/Shanghai', avatarUrl: null },
      mustChangePassword: false,
    })
    const store = useAuthStore()
    await store.login('mama2024', 'pass12345')
    await store.logout()
    expect(store.token).toBeNull()
    expect(store.user).toBeNull()
    expect(uni.getStorageSync('refreshToken')).toBe('')
  })

  it('bootstrap 在无本地 refresh token 时保持未登录且不报错', async () => {
    const store = useAuthStore()
    await store.bootstrap()
    expect(store.status).toBe('idle')
    expect(store.token).toBeNull()
    expect(authApi.refresh).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/mobile test`
Expected: FAIL —— store 不存在

- [ ] **Step 3: 实现 `api/endpoints.ts`**

每个函数一行 `apiRequest<Type>(path, { method, data })`，**路径严格照 spec 第 10 节**。特别注意：**没有 `familiesApi.remove`**（spec 第 4 节：家庭永不硬删除），只有 `archive` / `leave` / `transfer`。若实现时"顺手"加了 remove，就是违反约束。

- [ ] **Step 4: 实现四个 store**

`auth.ts` 要点：
- `login`/`register` 成功后 `setAccessToken`、写 `uni.setStorageSync('refreshToken', rt)`、设 `user` 与 `mustChangePassword`。
- **必须在 store 初始化时调用 `setRefreshHandler`**，让 401 自动刷新——否则 token 过期后所有请求都会失败。
- `logout` 清 `token`/`user`/`refreshToken`（本地 refresh token 置空字符串而非删除，便于测试断言）。
- `bootstrap`：读本地 refresh token，没有则 `status='idle'` 直接返回，**不抛错**（Review Focus 3）。

`family.ts`：`load` 调 `familiesApi.list`；`switch` 只改 `currentFamilyId` 并持久化到 `uni.setStorageSync('currentFamilyId', id)`。**切换家庭时不清空 child store**，因为 child store 本就按家庭分键（这是 Task 1 第 2 条 Review Focus 的设计基础）。

`child.ts`：**`childrenByFamily` 与 `currentChildIdByFamily` 都必须是按 familyId 索引的对象**，这是防串台的核心。`select(familyId, childId)` 必须校验 `childId` 属于 `families[familyId]`，不属于则忽略。`currentChild(familyId)` 的优先级：记住的 id → 列表第一个 → `null`。

`theme.ts`：`init` 读本地 `theme`/`themeMode` 与 `uni.getSystemInfoSync().theme`，调 `applyTheme`；`setPreset`/`setMode` 立即 `applyTheme`。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @moonbud/mobile test`
Expected: PASS —— child 5 个 + auth 4 个 + 此前 18 个

- [ ] **Step 6: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): add api endpoints and pinia stores with per-family child state"
```

---

### Task 4: 游客欢迎页与只读预览（含主题切换）

**Files:**
- Create: `apps/mobile/src/pages/welcome/index.vue`
- Create: `apps/mobile/src/pages/preview/index.vue`
- Create: `apps/mobile/src/preview/mock-data.ts`
- Create: `apps/mobile/src/components/ThemeSwitcher.vue`
- Create: `apps/mobile/src/components/PreviewFrame.vue`
- Test: `apps/mobile/src/preview/__tests__/mock-data.test.ts`
- Modify: `apps/mobile/src/pages.json`（注册两个页面并把 `welcome` 设为首页）

**Interfaces:**
- Consumes: Task 1 的主题、Task 3 的 theme store
- Produces:
  - `mock-data.ts`：`MOCK_FAMILY: FamilyDto`、`MOCK_CHILD: ChildDto`、`MOCK_EVENTS: EventDto[]`（覆盖 feeding/sleep/diaper 三种，时间相对 `Date.now()` 生成以便显示"20 分钟前"）、`MOCK_REMINDERS: ReminderDto[]`（覆盖已过期/待办各一）
  - `PREVIEW_SCREENS: { key: 'home'|'timeline'|'reminders'|'family'; title: string; caption: string }[]` —— 4 屏，每屏一句"它解决什么"
  - `ThemeSwitcher.vue`：props 无，直接读写 theme store，渲染 4 个色块 + 明/暗/自动三态
  - `PreviewFrame.vue`：props `{ title: string; caption: string }`，插槽为界面内容；**内部不绑定任何事件处理器给插槽内容**

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/mobile/src/preview/__tests__/mock-data.test.ts
import { describe, expect, it } from 'vitest'
import { MOCK_CHILD, MOCK_EVENTS, MOCK_FAMILY, MOCK_REMINDERS, PREVIEW_SCREENS } from '../mock-data'

describe('预览假数据', () => {
  it('提供 4 屏预览且每屏都有说明文案', () => {
    expect(PREVIEW_SCREENS).toHaveLength(4)
    for (const s of PREVIEW_SCREENS) {
      expect(s.title.length).toBeGreaterThan(0)
      expect(s.caption.length).toBeGreaterThan(10)
    }
  })

  it('假数据自洽：记录与提醒都属于同一个家庭与孩子', () => {
    expect(MOCK_CHILD.familyId).toBe(MOCK_FAMILY.id)
    for (const e of MOCK_EVENTS) {
      expect(e.familyId).toBe(MOCK_FAMILY.id)
      expect(e.childId).toBe(MOCK_CHILD.id)
    }
    for (const r of MOCK_REMINDERS) {
      expect(r.familyId).toBe(MOCK_FAMILY.id)
      expect(r.childId === null || r.childId === MOCK_CHILD.id).toBe(true)
    }
  })

  it('记录时间都在过去（否则"20 分钟前"会显示成负数）', () => {
    for (const e of MOCK_EVENTS) {
      expect(new Date(e.occurredAt).getTime()).toBeLessThanOrEqual(Date.now())
    }
  })

  it('提醒同时包含已过期与未来两项，便于展示两种状态', () => {
    const times = MOCK_REMINDERS.map((r) => (r.dueAt ? new Date(r.dueAt).getTime() : 0))
    expect(times.some((t) => t < Date.now())).toBe(true)
    expect(times.some((t) => t > Date.now())).toBe(true)
  })

  it('每种记录的 payload 都能通过 shared 的校验（假数据不能是脏数据）', () => {
    for (const e of MOCK_EVENTS) {
      const r = validateEventPayload(e.type, e.payload)
      expect(r.ok, `${e.type} 假数据不合法: ${r.ok ? '' : r.errors.join(', ')}`).toBe(true)
    }
  })
})
```

> 最后一条测试需要在文件顶部 `import { validateEventPayload } from '@moonbud/shared'`。**这条测试的价值**：假数据若与真实 schema 不符，预览会展示一个用户永远看不到的界面。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/mobile test`
Expected: FAIL —— `mock-data` 不存在

- [ ] **Step 3: 实现 `mock-data.ts`**

用 `@moonbud/shared` 的类型标注每个常量，**让编译器保证假数据形状正确**。时间用 `new Date(Date.now() - 20 * 60_000).toISOString()` 这类相对值。

- [ ] **Step 4: 实现 `welcome/index.vue`**

内容：产品名、一句话价值、3 个价值点（多人协作记录 / 到点提醒 / 一起看得见）、三个主按钮（「看看它能做什么」→ `preview`、「我收到了邀请码」→ `login?mode=join`、「开始使用」→ `login?mode=register`）。底部放 `ThemeSwitcher`。**不请求任何 API。**

- [ ] **Step 5: 实现 `preview/index.vue`**

4 屏用 `#PreviewFrame` 渲染，**内容由 `MOCK_*` 驱动、用真实组件渲染**（spec 第 9.5 节：不用截图，以免失真过期）。要点：

- 每屏顶部说明文案、底部固定「开始使用」按钮。
- **插槽内容不带任何 `@click`、`@tap`、`v-model`**——只读。(Review Focus：preview 不得写数据)
- 页面顶部一个「注册 / 登录」入口。
- 顶部 `ThemeSwitcher` 可真实切换。

- [ ] **Step 6: 注册页面与首页**

`pages.json`：把 `pages/welcome/index` 放到 `pages` 数组**第一位**（uni-app 以第一条为启动页），`preview` 紧随其后。**不设置 tabBar 的 `welcome`**。在此步同时把 spec 第 9 节的 4 格 tabBar 骨架加上（`pages/home`、`pages/event-list`、`pages/reminder-list`、`pages/profile` 先建空壳页，Task 5–8 填充），并在 `pages.json` 的 tabBar 配置处**加注释保留第 5 格的位置**（注释形式，不注册空页）。

- [ ] **Step 7: 在浏览器验证游客流程**

Run: `pnpm --filter @moonbud/mobile dev:h5`
Expected: 打开首页是 `welcome`（不是登录页）；点「看看它能做什么」进入 preview；点 4 个色块主题**立即变色**；明/暗切换生效；**点 preview 里任何记录卡片、按钮均无反应**；刷新页面后主题保持

- [ ] **Step 8: 运行测试确认通过**

Run: `pnpm --filter @moonbud/mobile test`
Expected: PASS —— 5 个新测试 + 此前全部

- [ ] **Step 9: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): add guest welcome and read-only preview with live theming"
```

---

### Task 5: 登录、注册、找回密码、修改密码

**Files:**
- Create: `apps/mobile/src/pages/login/index.vue`
- Create: `apps/mobile/src/pages/forgot-password/index.vue`
- Create: `apps/mobile/src/pages/change-password/index.vue`
- Create: `apps/mobile/src/components/PasswordField.vue`
- Test: `apps/mobile/src/pages/login/__tests__/login-form.test.ts`
- Create: `apps/mobile/src/pages/login/use-login-form.ts`

**Interfaces:**
- Consumes: Task 3 的 auth store；`@moonbud/shared` 的 `isValidUsername`、`PASSWORD_MIN_LENGTH`
- Produces:
  - `useLoginForm()`：`{ mode: Ref<'login'|'register'|'join'>; form: Ref<{ username: string; password: string; nickname: string; inviteCode: string; timezone: string }>; errors: Ref<Record<string, string>>; validate(): boolean; submit(): Promise<void> }`
  - `validateLoginForm(input: { mode: 'login'|'register'|'join'; username: string; password: string; nickname?: string; inviteCode?: string }): Record<string, string>` —— 纯函数，返回字段→错误文案，空对象表示通过

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/mobile/src/pages/login/__tests__/login-form.test.ts
import { describe, expect, it } from 'vitest'
import { validateLoginForm } from '../use-login-form'

describe('validateLoginForm', () => {
  it('注册时合法输入无错误', () => {
    expect(validateLoginForm({ mode: 'register', username: 'mama2024', password: 'pass12345', nickname: '妈妈' })).toEqual({})
  })

  it('账号不合规给出中文提示', () => {
    const e = validateLoginForm({ mode: 'register', username: 'ab', password: 'pass12345', nickname: '妈妈' })
    expect(e.username).toContain('4')
  })

  it('拒绝中文账号', () => {
    expect(validateLoginForm({ mode: 'register', username: '妈妈2024', password: 'pass12345', nickname: '妈妈' }).username).toBeTruthy()
  })

  it('密码过短给出提示，且提示里带最短长度', () => {
    const e = validateLoginForm({ mode: 'register', username: 'mama2024', password: 'short', nickname: '妈妈' })
    expect(e.password).toContain('8')
  })

  it('注册时昵称必填，登录时不校验昵称', () => {
    expect(validateLoginForm({ mode: 'register', username: 'mama2024', password: 'pass12345', nickname: '' }).nickname).toBeTruthy()
    expect(validateLoginForm({ mode: 'login', username: 'mama2024', password: 'pass12345' }).nickname).toBeUndefined()
  })

  it('加入模式必须填邀请码', () => {
    expect(validateLoginForm({ mode: 'join', username: 'mama2024', password: 'pass12345', nickname: '妈妈', inviteCode: '' }).inviteCode).toBeTruthy()
    expect(validateLoginForm({ mode: 'join', username: 'mama2024', password: 'pass12345', nickname: '妈妈', inviteCode: 'ABCD2345' })).toEqual({})
  })

  it('登录模式只校验账号与密码，不因昵称为空报错', () => {
    expect(validateLoginForm({ mode: 'login', username: 'mama2024', password: 'pass12345' })).toEqual({})
  })

  it('多个字段同时不合规时一次性全部返回', () => {
    const e = validateLoginForm({ mode: 'register', username: 'x', password: 'y', nickname: '' })
    expect(Object.keys(e).sort()).toEqual(['nickname', 'password', 'username'])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/mobile test`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 `use-login-form.ts`**

`validateLoginForm` 为纯函数（可测）；`useLoginForm` 包一层 `reactive` + 提交逻辑。三种 `mode` 合一屏：`login` 只显示账号/密码；`register` 多一个昵称；`join` 多昵称与邀请码。**注册三步压成一屏**（spec 第 9.5 节硬指标：注册不超过 3 步）。

`timezone` 用 `Intl.DateTimeFormat().resolvedOptions().timeZone` 取设备时区，兜底 `'Asia/Shanghai'`。

- [ ] **Step 4: 实现三个页面**

- `login/index.vue`：`u-form` + `u-input`，按 `mode` 显示字段；提交调 store 的 `login`/`register`；`join` 模式注册成功后自动调 `invitesApi.accept(inviteCode)`，成功则切到 home 并 toast"已加入家庭"。错误用 `u-toast` 显示 store 的 `error`，**按钮在 `status==='loading'` 时禁用**（防止重复提交）。
- `forgot-password/index.vue`：说明"请联系家庭里的管理员，在成员页为你重置密码"，加一个「提交找回请求」按钮调 `authApi` 的 reset-request，成功 toast 固定文案（**不区分账号是否存在**）。
- `change-password/index.vue`：旧密码 + 新密码 + 确认新密码；成功后 toast 并返回。**若 `authStore.mustChangePassword` 为真，进入首页时强制跳到此页**（spec：临时密码首登强制改密）。

- [ ] **Step 5: 在浏览器验证**

Run: `pnpm --filter @moonbud/mobile dev:h5`（后端需已 `pnpm dev:api`）
Expected: 注册 → 自动登录并进入 `family-select`（无家庭时）→ 创建家庭 → 进入 home；登录错误时 toast 显示中文；修改密码后旧 token 失效但当前会话仍可用

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm --filter @moonbud/mobile test`
Expected: PASS —— 8 个新测试 + 此前全部

- [ ] **Step 7: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): add login, register, join, and password screens"
```

---

### Task 6: 记录列表与动态表单（3 步内完成 + 防重复提示）

**Files:**
- Create: `apps/mobile/src/pages/event-list/index.vue`
- Create: `apps/mobile/src/pages/event-form/index.vue`
- Create: `apps/mobile/src/events/event-fields.ts`
- Create: `apps/mobile/src/events/format-event.ts`
- Create: `apps/mobile/src/events/duplicate-warning.ts`
- Test: `apps/mobile/src/events/__tests__/event-fields.test.ts`
- Test: `apps/mobile/src/events/__tests__/duplicate-warning.test.ts`

**Interfaces:**
- Consumes: `@moonbud/shared` 的 `EVENT_TYPES`、`EventType`、`validateEventPayload`；Task 3 的 stores；Task 2 的 `eventsApi`
- Produces:
  - `EVENT_TYPE_META: Record<EventType, { label: string; icon: string; primaryColorToken: keyof ThemeTokens; requiredFields: string[]; duplicateWindowMinutes: number }>` —— 8 种类型的中文名、图标、必填字段清单、防重复窗口
  - `type FieldSpec = { name: string; label: string; kind: 'text'|'number'|'select'|'datetime'|'time'|'textarea'; options?: { value: string; label: string }[]; required: boolean; unit?: string; placeholder?: string }`
  - `fieldsFor(type: EventType): FieldSpec[]`
  - `requiredFieldCount(type: EventType): number`
  - `formatEventLine(event: EventDto, now?: Date): string` —— 如"喂奶 · 奶瓶 120ml · 20 分钟前"
  - `relativeTime(iso: string, now?: Date): string` —— "刚刚" / "20 分钟前" / "2 小时前" / "昨天 08:30"
  - `shouldWarnDuplicate(params: { latest: EventDto | null; type: EventType; now?: Date }): { warn: boolean; message: string }`

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/mobile/src/events/__tests__/event-fields.test.ts
import { describe, expect, it } from 'vitest'
import { EVENT_TYPES } from '@moonbud/shared'
import { EVENT_TYPE_META, fieldsFor, requiredFieldCount } from '../event-fields'

describe('记录表单字段', () => {
  it('8 种类型都有元数据与字段定义', () => {
    expect(EVENT_TYPES).toHaveLength(8)
    for (const t of EVENT_TYPES) {
      expect(EVENT_TYPE_META[t]).toBeTruthy()
      expect(fieldsFor(t).length).toBeGreaterThan(0)
    }
  })

  it('每种类型的必填字段不超过 2 个 —— 单手抱娃时必须能填完', () => {
    for (const t of EVENT_TYPES) {
      expect(requiredFieldCount(t), `${t} 的必填项过多`).toBeLessThanOrEqual(2)
    }
  })

  it('每个必填字段都在字段列表里，且没有孤立的必填声明', () => {
    for (const t of EVENT_TYPES) {
      const specNames = fieldsFor(t).map((f) => f.name)
      for (const required of EVENT_TYPE_META[t].requiredFields) {
        expect(specNames, `${t}.${required} 不在字段列表`).toContain(required)
      }
    }
  })

  it('必填字段与 shared 的 schema 一致（喂奶 method、体温 celsius、大小便 kind）', () => {
    expect(EVENT_TYPE_META.feeding.requiredFields).toEqual(['method'])
    expect(EVENT_TYPE_META.temperature.requiredFields).toEqual(['celsius'])
    expect(EVENT_TYPE_META.diaper.requiredFields).toEqual(['kind'])
    expect(EVENT_TYPE_META.solid.requiredFields).toEqual(['food'])
    expect(EVENT_TYPE_META.medicine.requiredFields).toEqual(['name', 'dose'])
    expect(EVENT_TYPE_META.milestone.requiredFields).toEqual(['title'])
  })

  it('体温字段带摄氏度单位与合理范围提示', () => {
    const f = fieldsFor('temperature').find((x) => x.name === 'celsius')!
    expect(f.unit).toBe('℃')
    expect(f.kind).toBe('number')
  })

  it('防重复窗口按类型区分，喂奶短于用药', () => {
    expect(EVENT_TYPE_META.feeding.duplicateWindowMinutes).toBeLessThan(EVENT_TYPE_META.medicine.duplicateWindowMinutes)
  })
})
```

```typescript
// apps/mobile/src/events/__tests__/duplicate-warning.test.ts
import { describe, expect, it } from 'vitest'
import { relativeTime, shouldWarnDuplicate } from '../duplicate-warning'

const feeding = (minutesAgo: number) => ({
  id: 'e1', familyId: 'f1', childId: 'c1', type: 'feeding' as const,
  occurredAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  endedAt: null, payload: { method: 'bottle' as const, amountMl: 120 },
  note: null, createdBy: 'u1', createdByNickname: '爸爸',
  updatedBy: null, createdAt: '', updatedAt: '',
})

describe('relativeTime', () => {
  it('一分钟内显示刚刚', () => {
    expect(relativeTime(new Date(Date.now() - 20_000).toISOString())).toBe('刚刚')
  })
  it('同一天内显示分钟与小时', () => {
    expect(relativeTime(new Date(Date.now() - 20 * 60_000).toISOString())).toBe('20 分钟前')
    expect(relativeTime(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe('3 小时前')
  })
  it('跨天显示日期', () => {
    expect(relativeTime(new Date(Date.now() - 48 * 3600_000).toISOString())).toMatch(/天前|月|日/)
  })
  it('非法时间串不抛错', () => {
    expect(relativeTime('not-a-date')).toBeTruthy()
  })
})

describe('shouldWarnDuplicate', () => {
  it('90 分钟内已有喂奶记录时给出带记录人的提示', () => {
    const r = shouldWarnDuplicate({ latest: feeding(20), type: 'feeding' })
    expect(r.warn).toBe(true)
    expect(r.message).toContain('爸爸')
    expect(r.message).toContain('20 分钟前')
  })

  it('超过窗口不提示', () => {
    expect(shouldWarnDuplicate({ latest: feeding(200), type: 'feeding' }).warn).toBe(false)
  })

  it('没有历史记录时不提示', () => {
    expect(shouldWarnDuplicate({ latest: null, type: 'feeding' }).warn).toBe(false)
  })

  it('未来时间的记录不触发提示（用户补录过去时间时不能被误报）', () => {
    const future = { ...feeding(-30) }
    expect(shouldWarnDuplicate({ latest: future, type: 'feeding' }).warn).toBe(false)
  })

  it('用药窗口更长，30 分钟前记过药会提示', () => {
    expect(shouldWarnDuplicate({ latest: { ...feeding(30), type: 'medicine' as const }, type: 'medicine' }).warn).toBe(true)
  })
})
```

> `feeding(-30)` 表示 30 分钟**后**，即未来时间——用于验证"未来记录不触发提示"。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/mobile test`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 `event-fields.ts`**

`EVENT_TYPE_META` 的 `requiredFields` 必须与 shared schema 一致（测试逐条钉住）。每个 `FieldSpec` 的 `name` 必须与 schema 的 payload 键**完全同名**，因为表单直接产出 payload。

必填项上限：`feeding`→`['method']`、`temperature`→`['celsius']`、`diaper`→`['kind']`、`solid`→`['food']`、`medicine`→`['name','dose']`、`milestone`→`['title']`、`sleep`→`[]`、`growth`→`[]`（growth 的"至少一项"由 schema 的 refine 兜住，但在 UI 上允许空提交会报错——**给 growth 加一个非阻断提示**而不是加必填，以维持"必填 ≤2"与"3 步内完成"）。

`duplicateWindowMinutes`：`feeding: 90`、`medicine: 60`、`temperature: 120`、其余 `60`。测试要求 `feeding < medicine`，故 `medicine` 必须 > 90——**取 `medicine: 120`、`temperature: 180`** 以满足该断言。

- [ ] **Step 4: 实现 `duplicate-warning.ts` 与 `format-event.ts`**

`shouldWarnDuplicate`：`latest` 为 `null` 时 `{ warn: false }`；`occurredAt` 在未来时 `{ warn: false }`；`now - occurredAt` 的分钟数 `< meta.duplicateWindowMinutes` 时 `warn: true`，`message` 形如 `${latest.createdByNickname ?? '家人'} ${relativeTime(latest.occurredAt)}刚记过一次${meta.label}`。

- [ ] **Step 5: 实现两个页面**

`event-list/index.vue`：按天分组的 `u-cell-group` 列表；顶部筛选（类型/孩子）；`formatEventLine` 渲染；下拉刷新 `onPullDownRefresh`；空状态用 `u-empty`。

`event-form/index.vue`：
1. 进入时若带了 `type` 参数，直接渲染该类型字段（首页快捷按钮会带）；否则先显示 8 个类型宫格（`u-grid`）。
2. **选类型后立即调 `eventsApi.latest(familyId, childId, type)`**，用 `shouldWarnDuplicate` 决定是否在表单顶部显示提示条。**该请求失败不得阻塞表单**（catch 后静默跳过提示）——Review Focus 3。
3. 字段按 `FieldSpec` 动态渲染；`required` 的加红星；提交前用 `validateEventPayload` 做本地校验，失败只标红对应字段。
4. 保存成功后 toast 并返回上一页（**并在返回前刷新列表**）。

**步骤计数必须保持 ≤3**：首页快捷按钮 → 表单（含类型）→ 保存。**不要把类型选择做成独立页面**，否则变成 4 步。

- [ ] **Step 6: 在浏览器验证**

Run: `pnpm --filter @moonbud/mobile dev:h5`
Expected: 首页点「喂奶」→ 表单直接出现（无需再选类型）→ 填写后保存 → 列表出现新记录；再次点「喂奶」→ **顶部出现"XX 20 分钟前刚记过一次喂奶"**；填 `98.6` 体温 → 提示范围错误且不保存；补录一条未来时间的喂奶后，再打开表单**不出现**重复提示

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm --filter @moonbud/mobile test`
Expected: PASS —— 11 个新测试 + 此前全部

- [ ] **Step 8: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): add event list and dynamic form with duplicate-care warning"
```

---

### Task 7: 首页、家庭选择、孩子管理

**Files:**
- Create: `apps/mobile/src/pages/home/index.vue`
- Create: `apps/mobile/src/pages/family-select/index.vue`
- Create: `apps/mobile/src/pages/child-form/index.vue`
- Create: `apps/mobile/src/components/FamilySwitcher.vue`
- Create: `apps/mobile/src/components/ChildSwitcher.vue`
- Create: `apps/mobile/src/events/summary.ts`
- Test: `apps/mobile/src/events/__tests__/summary.test.ts`

**Interfaces:**
- Consumes: Task 3 的 stores；Task 6 的 `relativeTime`、`EVENT_TYPE_META`
- Produces:
  - `buildTodaySummary(params: { events: EventDto[]; reminders: ReminderDto[]; now?: Date; timezone: string }): { lastFeeding: EventDto | null; lastSleep: EventDto | null; diaperCount: number; overdueReminders: ReminderDto[] }`
  - `FamilySwitcher.vue`：展示当前家庭名，点击弹 `u-popup` 列出所有家庭 + 「创建家庭」+「加入家庭」
  - `ChildSwitcher.vue`：展示当前孩子，点击弹层切换（仅当前家庭的孩子）

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/mobile/src/events/__tests__/summary.test.ts
import { describe, expect, it } from 'vitest'
import { buildTodaySummary } from '../summary'
import type { EventDto, ReminderDto } from '@moonbud/shared'

const ev = (id: string, type: EventDto['type'], minutesAgo: number): EventDto => ({
  id, familyId: 'f1', childId: 'c1', type,
  occurredAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  endedAt: null, payload: {}, note: null,
  createdBy: 'u1', createdByNickname: '妈妈', updatedBy: null, createdAt: '', updatedAt: '',
})

const rm = (id: string, hoursFromNow: number): ReminderDto => ({
  id, familyId: 'f1', childId: 'c1', title: id, note: null, type: 'ONE_TIME',
  dueAt: new Date(Date.now() + hoursFromNow * 3600_000).toISOString(),
  rrule: null, timezone: 'Asia/Shanghai', assigneeId: null, status: 'ACTIVE',
  createdBy: 'u1', createdAt: '',
})

describe('buildTodaySummary', () => {
  it('取出最近一次喂奶与睡眠', () => {
    const s = buildTodaySummary({
      events: [ev('a', 'feeding', 120), ev('b', 'feeding', 20), ev('c', 'sleep', 300)],
      reminders: [], timezone: 'Asia/Shanghai',
    })
    expect(s.lastFeeding?.id).toBe('b')
    expect(s.lastSleep?.id).toBe('c')
  })

  it('只统计今天的换尿布次数', () => {
    const s = buildTodaySummary({
      events: [ev('a', 'diaper', 60), ev('b', 'diaper', 3 * 60), ev('c', 'diaper', 30 * 60)],
      reminders: [], timezone: 'Asia/Shanghai',
    })
    expect(s.diaperCount).toBeGreaterThanOrEqual(1)
    expect(s.diaperCount).toBeLessThanOrEqual(3)
  })

  it('挑出已过期的提醒', () => {
    const s = buildTodaySummary({
      events: [], reminders: [rm('过期', -3), rm('未到', 5)], timezone: 'Asia/Shanghai',
    })
    expect(s.overdueReminders.map((r) => r.id)).toEqual(['过期'])
  })

  it('空数据不抛错', () => {
    const s = buildTodaySummary({ events: [], reminders: [], timezone: 'Asia/Shanghai' })
    expect(s.lastFeeding).toBeNull()
    expect(s.lastSleep).toBeNull()
    expect(s.diaperCount).toBe(0)
    expect(s.overdueReminders).toEqual([])
  })

  it('忽略别的类型（睡眠不会出现在最近喂奶里）', () => {
    const s = buildTodaySummary({ events: [ev('a', 'sleep', 10)], reminders: [], timezone: 'Asia/Shanghai' })
    expect(s.lastFeeding).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/mobile test`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 `summary.ts`**

"今天"的判定**必须按传入的 `timezone` 计算**，不能直接用设备本地日期——家人可能在不同时区。用一个工具函数把 `now` 与事件的 `occurredAt` 都转成该时区的年月日再比较。

- [ ] **Step 4: 实现三个页面与两个切换组件**

- `home/index.vue`：顶部 `FamilySwitcher` + `ChildSwitcher`；概览卡片（最近喂奶/最近睡眠/今日换尿布次数，用 `relativeTime`）；过期提醒红条（点击跳 `reminder-list`）；8 个类型快捷按钮（**直接跳 `event-form?type=xxx`，不经过选类型步骤**，这是"3 步内完成"的关键）；零孩子时显示"添加孩子"主按钮（spec 第 3 节）。
- `family-select/index.vue`：列出家庭 + 创建 + 加入；无家庭时突出创建。
- `child-form/index.vue`：姓名、性别、生日（`u-datetime-picker`，**生日不允许选未来**）。
- `FamilySwitcher` / `ChildSwitcher`：切换后 `store.switch(familyId)` 并**触发该家庭孩子列表加载**，然后回到 home 顶部。

- [ ] **Step 5: 在浏览器验证（重点验证换家庭不串台）**

Run: `pnpm --filter @moonbud/mobile dev:h5`
Expected: 建两个家庭各一个孩子 → 在家庭 A 选大宝 → 切到家庭 B → **顶部显示二宝而不是大宝** → 切回 A → **仍显示大宝**；家庭 B 里点「喂奶」→ 表单里的孩子是二宝

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm --filter @moonbud/mobile test`
Expected: PASS —— 5 个新测试 + 此前全部

- [ ] **Step 7: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): add home, family select, and per-family child switching"
```

---

### Task 8: 提醒、通知中心、家庭成员与邀请二维码、主题设置

**Files:**
- Create: `apps/mobile/src/pages/reminder-list/index.vue`
- Create: `apps/mobile/src/pages/reminder-form/index.vue`
- Create: `apps/mobile/src/pages/notification-center/index.vue`
- Create: `apps/mobile/src/pages/profile/index.vue`
- Create: `apps/mobile/src/pages/family-settings/index.vue`
- Create: `apps/mobile/src/pages/member-list/index.vue`
- Create: `apps/mobile/src/pages/invite-qrcode/index.vue`
- Create: `apps/mobile/src/pages/theme-settings/index.vue`
- Create: `apps/mobile/src/reminders/rrule-presets.ts`
- Create: `apps/mobile/src/notifications/local-notify.ts`
- Test: `apps/mobile/src/reminders/__tests__/rrule-presets.test.ts`

**Interfaces:**
- Consumes: Task 3 的 stores 与 endpoints；Task 1 的主题
- Produces:
  - `RRULE_PRESETS: { key: string; label: string; rrule: string; preview: (timezone: string) => string }[]` —— 至少 5 种：每天、每两天、每周同一天、每月同一天、自定义
  - `buildRruleFromUi(input: { kind: 'daily'|'everyNDays'|'weekly'|'monthly'; hour: number; minute: number; n?: number; weekday?: number }): string`
  - `scheduleLocalNotification(params: { id: string; title: string; body: string; at: Date }): void` —— **平台条件编译：`#ifdef APP-PLUS` 用 `plus.push.createMessage` + `plus.push.addEventListener` 排期；`#ifndef APP-PLUS` 空实现并 `console.warn`**
  - `cancelLocalNotification(id: string): void`
  - `fetchUnreadCount(): Promise<number>`

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/mobile/src/reminders/__tests__/rrule-presets.test.ts
import { describe, expect, it } from 'vitest'
import { buildRruleFromUi, RRULE_PRESETS } from '../rrule-presets'

describe('rrule 预设', () => {
  it('至少 5 种预设且都有中文标签', () => {
    expect(RRULE_PRESETS.length).toBeGreaterThanOrEqual(5)
    for (const p of RRULE_PRESETS) expect(p.label.length).toBeGreaterThan(0)
  })

  it('buildRruleFromUi 产出合法 rrule 片段', () => {
    expect(buildRruleFromUi({ kind: 'daily', hour: 8, minute: 0 })).toBe('FREQ=DAILY;BYHOUR=8;BYMINUTE=0')
    expect(buildRruleFromUi({ kind: 'everyNDays', hour: 7, minute: 30, n: 2 })).toBe('FREQ=DAILY;INTERVAL=2;BYHOUR=7;BYMINUTE=30')
    expect(buildRruleFromUi({ kind: 'weekly', hour: 9, minute: 0, weekday: 1 })).toBe('FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0')
    expect(buildRruleFromUi({ kind: 'monthly', hour: 20, minute: 15 })).toBe('FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=20;BYMINUTE=15')
  })

  it('补零为两位（rrule 不接受 8:5 这种写法）', () => {
    expect(buildRruleFromUi({ kind: 'daily', hour: 8, minute: 5 })).toContain('BYMINUTE=05')
    expect(buildRruleFromUi({ kind: 'daily', hour: 8, minute: 0 })).toContain('BYHOUR=08')
  })

  it('everyNDays 的 n 至少为 1', () => {
    expect(buildRruleFromUi({ kind: 'everyNDays', hour: 8, minute: 0, n: 0 })).toContain('INTERVAL=1')
  })

  it('每天的预览文案不带时区以外的歧义', () => {
    const daily = RRULE_PRESETS.find((p) => p.key === 'daily')!
    expect(daily.preview('Asia/Shanghai')).toContain('每天')
  })

  it('非法星期取值抛错而不是产出坏 rrule', () => {
    expect(() => buildRruleFromUi({ kind: 'weekly', hour: 8, minute: 0, weekday: 9 })).toThrow()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/mobile test`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 `rrule-presets.ts`**

`BYDAY` 用两位缩写 `MO TU WE TH FR SA SU`，`weekday` 入参用 0–6（0=周一）；超出范围抛错。所有时分**补零两位**。

- [ ] **Step 4: 实现提醒与通知页面**

- `reminder-list/index.vue`：三段 `u-subsection`（待办 / 已过期 / 已完成）；点提醒进表单；每条显示 `assigneeId` 对应成员昵称或"全家"；完成按钮调 `remindersApi.complete`（**重复提醒只完本次**，UI 上文案写"完成本次"以免误解为关闭整个提醒）。
- `reminder-form/index.vue`：标题、孩子（可空）、类型（一次性/重复）、时间选择、RRULE 预设、执行人（全家/某成员）、备注。
- `notification-center/index.vue`：未读列表、点击标记已读、右上「全部已读」。
- `invite-qrcode/index.vue`：调 `invitesApi.create` 拿 code → 用二维码组件渲染 `https://<域名>/join?code=CODE`（域名走配置，**缺配置时显示手动邀请码并提示"扫码需先配置域名"**，不要渲染一个假域名二维码）→ 同时大字显示邀请码供手动输入 → 支持撤销与设置角色。

- [ ] **Step 5: 实现 `local-notify.ts` 与 profile / family-settings / member-list / theme-settings**

`local-notify.ts` 必须用条件编译，且**在非 APP 平台的空实现要显式警告**（spec 第 6 节：站内提醒在 v1 是主力，本地通知是加分项）：

```typescript
export function scheduleLocalNotification(p: { id: string; title: string; body: string; at: Date }): void {
  // #ifdef APP-PLUS
  // 鸿蒙不支持 plus API，因此这里必须用条件编译隔离，不能在运行时判断
  plus.push.createMessage(p.body, JSON.stringify({ id: p.id }), {
    title: p.title,
    when: p.at,
  })
  // #endif
  // #ifndef APP-PLUS
  console.warn('[moonBud] 当前平台不支持本地通知，提醒仅出现在站内提醒中心')
  // #endif
}
```

`profile/index.vue`：账号信息、修改密码入口、家庭管理、主题设置、关于（含"已知限制"文案：APP 关闭时无推送）。
`member-list/index.vue`：成员列表 + 角色调整（仅 OWNER/ADMIN 可见按钮）+ 移除 + **重置密码**（弹窗展示一次性临时密码，明确提示"请当面告知本人"）。
`theme-settings/index.vue`：4 套预设 + 明/暗/自动。

- [ ] **Step 6: 在浏览器验证全部页面可达且无写死颜色**

Run: `pnpm --filter @moonbud/mobile dev:h5`
Expected: 4 个 tab 均可进入；提醒可创建（每天 8 点）、在提醒列表显示；切换主题后**每个页面**（含提醒、成员、通知中心）都变色，无残留的写死色
Run: `grep -rnE "#[0-9A-Fa-f]{6}" apps/mobile/src/pages apps/mobile/src/components --include=*.vue | grep -v "theme/tokens"`
Expected: 无输出（**除 tokens 外任何页面都不得出现字面色值**——第 4 条 Review Focus）

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm --filter @moonbud/mobile test && pnpm --filter @moonbud/mobile build:h5`
Expected: 测试全绿 + H5 构建成功

- [ ] **Step 8: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): add reminders, notifications, members, invites, and theme settings"
```

---

### Task 9: 真机构建交接（Android 优先）

**Files:**
- Create: `apps/mobile/BUILD.md`
- Modify: `apps/mobile/src/manifest.json`
- Modify: `README.md`（加"移动端"一节）

**Interfaces:**
- Consumes: 此前全部任务
- Produces: 一份用户能照着做出 APK 的说明；`manifest.json` 中 Android 明文 HTTP 配置

- [ ] **Step 1: 配置 `manifest.json`**

- `name` = `moonBud`，`appid` = **占位符**（如 `__UNI__MOONBUD`），并在 `BUILD.md` 中明确"必须替换为你自己的 DCloud appid"。
- Android 平台：**`usesCleartextTraffic` 设为 `true`**——局域网测试走的是明文 HTTP，不设置的话真机上所有请求都会失败，而错误信息不会提示这一点。
- 声明通知权限（`POST_NOTIFICATIONS`，Android 13+ 必需）。
- 鸿蒙配置目录 `harmony-configs` 先不建（无 DevEco Studio，spec 第 14 节）。

- [ ] **Step 2: 写 `apps/mobile/BUILD.md`**

必须写清：

1. **为什么需要 HBuilderX**：命令行只能产出 app 打包资源（`build:app-plus`），签名 APK 必须由 HBuilderX 发行（spec 第 0、14 节）。
2. Android 步骤：装 HBuilderX → 把 `apps/mobile` 目录拖入 → 在 `manifest.json` 里填**自己的** DCloud appid → 运行 → 运行到手机或模拟器（先确认手机开 USB 调试）→ 发行 → 原生 App-云打包。
3. **API 地址必须改**：真机不能用 `localhost`，把 `.env.production` 的 `VITE_API_BASE_URL` 改成开发机局域网 IP，且手机与电脑同一 WiFi。
4. iOS 步骤：需苹果开发者账号，云打包。
5. 鸿蒙步骤：需 DevEco Studio 5.1.0.849+ 与鸿蒙开发者账号；列出 spec 第 14 节的坑（路径长度、权限手写、不支持 `plus`）。
6. **验收标准定在 Android**（spec 第 14 节：iOS/鸿蒙为兼容性目标）。

- [ ] **Step 3: 验证 H5 生产构建产物可用于回归**

Run: `pnpm --filter @moonbud/mobile build:h5`
Expected: `dist/build/h5` 生成，用静态服务器打开后游客流程可用（**这是我在无 HBuilderX 环境下能提供的最终验证**）

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/BUILD.md apps/mobile/src/manifest.json README.md
git commit -m "docs(mobile): add android-first build handoff and manifest config"
```

---

## Self-Review

**1. Spec coverage（逐节对照）：**

| spec 节 | 覆盖任务 |
|---|---|
| 第 7 节 主题系统（4 套预设、语义变量、跟随系统、本地存储、即时生效） | Task 1、4、8 |
| 第 7 节 禁止写死颜色 | Task 8 Step 6 的 grep 验证 |
| 第 9 节 底部 4 格 + 第 5 格占位注释 | Task 4 Step 6 |
| 第 9 节 页面清单 | Task 4（welcome/preview）、5（login/forgot/change-password）、6（event-list/event-form）、7（home/family-select/child-form）、8（reminder/notification/profile/family-settings/member-list/invite-qrcode/theme-settings）。**`join` 落地页未覆盖——见下方缺口** |
| 第 9 节 3 步内完成记录 | Task 6 Step 5 |
| 第 9 节 防重复照护 | Task 6（`shouldWarnDuplicate` + 表单提示） |
| 第 9.5 节 游客只读预览、主题真交互、不强制弹注册、注册 ≤3 步 | Task 4、5 |
| 第 3 节 当前孩子按家庭存 | Task 3 |
| 第 5 节 修改密码、临时密码强制改密 | Task 5 |
| 第 4 节 家庭永不硬删除（UI 无删除入口） | Task 3（endpoints 无 remove）、8（family-settings 只有归档/退出/转让） |
| 第 6 节 站内提醒为主、本地通知限 APP 平台 | Task 8 |
| 第 14 节 平台差异用条件编译 | Task 8（`local-notify.ts`） |
| 第 17 节 baseURL 走配置 | Task 2 |

**发现一个缺口：** spec 第 9 节页面清单里的 `join`（邀请落地页，H5）**没有对应任务**。这是一个独立的小交付物（一个静态/轻量 H5 页，读 `?code=` 并引导唤起 APP）。**不在此计划内补任务**，因为它属于独立子系统（H5 落地页而非 APP），应单独成计划；在此登记，避免被遗忘。

**2. Step scan：** 每个 step 单一动作、可校验。Task 1 Step 5 与 Task 6 Step 5 给出了算法级说明（跨端 CSS 变量注入、步骤计数约束），因为签名与测试无法唯一决定。

**3. Type consistency：** `ThemeTokens`（Task 1）在 Task 6 的 `EVENT_TYPE_META.primaryColorToken` 中作为键类型引用；`EventDto.createdByNickname`（Task 6 与后端计划 Task 12 一致）；`relativeTime`（Task 6 定义，Task 7 消费）；`shouldWarnDuplicate` 的 `latest` 参数类型 `EventDto | null` 与 Task 6 实现一致；`childrenByFamily`/`currentChildIdByFamily`（Task 3）在 Task 7 的切换组件中消费；`buildRruleFromUi` 产出直接作为 `remindersApi.create` 的 `rrule` 字段（与后端计划 Task 9 的 `computeDueAt` 输入格式一致：`FREQ=...;BYHOUR=..;BYMINUTE=..`）。

**4. Review Focus：** 5 条全部有测试——baseURL 配置化（Task 2 Step 1 `buildUrl` + `env.ts` 缺配置抛错）、换家庭不串台（Task 3 Step 1 第 1、4 条 + Task 7 Step 5 的手工验证）、网络失败不白屏（Task 2 Step 1 `normalizeError` 四类输入 + Task 6 Step 5 的"提示失败不阻塞表单"）、写死颜色（Task 8 Step 6 的 grep 门禁）、必填项 ≤2（Task 6 Step 1 第 2 条）。

**5. Proportion：** 本计划约 700 行，对应实现约 2500–3500 行（含页面）。页面用"内容清单 + 要点"描述而非逐行代码，符合"计划不是程序转录"。

**已知的计划内风险：**

- Task 1 Step 5 的跨端 CSS 变量方案（H5 用 `document`、其余端用根 `view` 绑定）是本计划技术风险最高的一处。若小程序/APP 端发现 uView Pro 的主题机制与之冲突，应改用 uView Pro 的 `u-config-provider` 官方主题通道，并同步修改 Task 1 的 `applyTheme` 与其测试——**不要两套机制并存**。
- Task 8 的二维码渲染需要在任务开始时选定一个 uni-app 二维码组件（优先选 `uni_modules` 中的纯 JS 实现，避免引入原生插件，因为原生插件会阻塞 H5 预览）。
- 移动端全部验证止于浏览器（H5）。**真机行为（本地通知、二维码扫描、明文 HTTP）只有在用户用 HBuilderX 出包后才能确认**——这一条必须如实告知用户，不能把 H5 通过表述为"APP 可用"。
