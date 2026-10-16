# moonBud 共享契约（shared 包）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 `packages/shared`，把记录类型的 JSONB 校验规则与 API 类型定义收敛到唯一来源，供后端校验与前端表单共用。

**Architecture:** 一个零运行时依赖（除 zod）的纯 TypeScript 包。导出记录类型的 zod schema、由 schema 推导的 TS 类型，以及 API 请求/响应类型。后端用它校验 `events.payload`，前端用它生成动态表单字段与本地校验。**这是唯一同时被两个子系统依赖的模块，所以必须先做。**

**Tech Stack:** TypeScript 5.x · zod 3.x · tsup（构建 ESM+CJS 双产物）

**Spec:** `docs/superpowers/specs/2026-10-16-moonbud-design.md`

## Global Constraints

- 记录类型固定为 8 种：`feeding` / `sleep` / `diaper` / `solid` / `medicine` / `temperature` / `growth` / `milestone`（spec 第 4 节）
- 包名 `@moonbud/shared`，被 `apps/api` 与 `apps/mobile` 以 `workspace:*` 依赖
- Node.js ≥ 24，pnpm ≥ 10
- 时间统一 ISO 8601 UTC 字符串；时区用 IANA 名（如 `Asia/Shanghai`）
- 不在此包中放数据库模型或 NestJS 装饰器——它必须能跑在浏览器里

## Review Focus

以下五类输入/失败模式 spec 未逐条规定，但用户会真实遇到。每一条都在 Task 1 的测试里钉住：

1. **payload 多带字段** —— 前端表单升级后多提交一个字段，后端应**拒绝**而非静默存储，否则数据库会积累无人认识的字段。
2. **体温用华氏度传入** —— `celsius: 98.6` 是华氏值，理应被范围校验拦住（人体体温范围 30–45 ℃），而不是当成 98.6 ℃ 存进去。
3. **睡眠 `ended_at` 早于 `occurred_at`** —— 用户改错时间，应报错而非算出负时长。
4. **喂奶 `amountMl` 为 0 或负数** —— 婴儿奶量不可能是 0，可能是用户误删数字后顺手提交。
5. **`note` 超长** —— 用户粘贴一整段文字，应有上限而不是写爆数据库。

---

### Task 1: 初始化 shared 包与记录类型 schema

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/tsup.config.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/event-types.ts`
- Test: `packages/shared/src/__tests__/event-types.test.ts`
- Create: `pnpm-workspace.yaml`

**Interfaces:**
- Produces:
  - `EVENT_TYPES: readonly ['feeding','sleep','diaper','solid','medicine','temperature','growth','milestone']`
  - `type EventType = typeof EVENT_TYPES[number]`
  - `eventPayloadSchemas: Record<EventType, z.ZodTypeAny>`
  - `validateEventPayload(type: EventType, payload: unknown): { ok: true; data: EventPayload } | { ok: false; errors: string[] }`
  - `type EventPayload` = 8 种 payload 的联合
  - `NOTE_MAX_LENGTH = 500`

- [ ] **Step 1: 写失败的测试**

```typescript
// packages/shared/src/__tests__/event-types.test.ts
import { describe, expect, it } from 'vitest'
import { EVENT_TYPES, NOTE_MAX_LENGTH, validateEventPayload } from '../event-types'

describe('validateEventPayload', () => {
  it('接受合法的喂奶记录', () => {
    const r = validateEventPayload('feeding', { method: 'bottle', amountMl: 120 })
    expect(r.ok).toBe(true)
  })

  it('拒绝喂奶 method 取值之外的值', () => {
    const r = validateEventPayload('feeding', { method: 'telepathy' })
    expect(r.ok).toBe(false)
  })

  it('拒绝多带的未知字段', () => {
    const r = validateEventPayload('feeding', { method: 'bottle', amountMl: 120, bogus: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/bogus|unrecognized/i)
  })

  it('拒绝非正数的奶量', () => {
    expect(validateEventPayload('feeding', { method: 'bottle', amountMl: 0 }).ok).toBe(false)
    expect(validateEventPayload('feeding', { method: 'bottle', amountMl: -30 }).ok).toBe(false)
  })

  it('用人体体温范围拦住华氏度输入', () => {
    expect(validateEventPayload('temperature', { celsius: 36.8 }).ok).toBe(true)
    expect(validateEventPayload('temperature', { celsius: 98.6 }).ok).toBe(false)
    expect(validateEventPayload('temperature', { celsius: 29 }).ok).toBe(false)
    expect(validateEventPayload('temperature', { celsius: 46 }).ok).toBe(false)
  })

  it('拒绝睡眠 quality 取值之外的值', () => {
    expect(validateEventPayload('sleep', { quality: 'good' }).ok).toBe(true)
    expect(validateEventPayload('sleep', { quality: 'excellent' }).ok).toBe(false)
  })

  it('接受只有必填项的里程碑', () => {
    expect(validateEventPayload('milestone', { title: '第一次翻身' }).ok).toBe(true)
    expect(validateEventPayload('milestone', {}).ok).toBe(false)
  })

  it('拒绝未知的记录类型', () => {
    // @ts-expect-error 故意传非法类型
    expect(validateEventPayload('nonsense', {}).ok).toBe(false)
  })

  it('暴露 8 种记录类型且 note 上限为 500', () => {
    expect(EVENT_TYPES).toHaveLength(8)
    expect(NOTE_MAX_LENGTH).toBe(500)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/shared test`
Expected: FAIL —— `Cannot find module '../event-types'`

- [ ] **Step 3: 实现 `packages/shared/src/event-types.ts`**

关键决定：所有对象 schema 用 **`.strict()`**，这是第 1 条 Review Focus 的实现手段；体温用 `.min(30).max(45)`；奶量用 `.positive()`。

```typescript
import { z } from 'zod'

/** 备注上限，前端 textarea 的 maxlength 与后端校验必须同源 */
export const NOTE_MAX_LENGTH = 500

const amountMl = z.number().positive().max(2000)
const durationMin = z.number().int().positive().max(600)

const feedingSchema = z.object({
  method: z.enum(['breast', 'bottle', 'formula']),
  side: z.enum(['left', 'right', 'both']).optional(),
  amountMl: amountMl.optional(),
  durationMin: durationMin.optional(),
}).strict()

const sleepSchema = z.object({
  quality: z.enum(['good', 'fair', 'poor']).optional(),
}).strict()

const diaperSchema = z.object({
  kind: z.enum(['pee', 'poo', 'mixed']),
  color: z.string().max(50).optional(),
  texture: z.string().max(50).optional(),
}).strict()

const solidSchema = z.object({
  food: z.string().min(1).max(100),
  amountDesc: z.string().max(100).optional(),
  reaction: z.string().max(200).optional(),
}).strict()

const medicineSchema = z.object({
  name: z.string().min(1).max(100),
  dose: z.string().min(1).max(50),
  route: z.string().max(50).optional(),
}).strict()

/** 30–45 ℃ 是人体体温的物理范围；华氏值 98.6 会被这条拦住 */
const temperatureSchema = z.object({
  celsius: z.number().min(30).max(45),
  site: z.enum(['axillary', 'ear', 'forehead', 'rectal']).optional(),
}).strict()

const growthSchema = z.object({
  weightKg: z.number().positive().max(60).optional(),
  heightCm: z.number().positive().max(200).optional(),
  headCm: z.number().positive().max(80).optional(),
}).strict().refine(
  (v) => v.weightKg !== undefined || v.heightCm !== undefined || v.headCm !== undefined,
  { message: '体重、身高、头围至少填一项' },
)

const milestoneSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(NOTE_MAX_LENGTH).optional(),
}).strict()

export const EVENT_TYPES = [
  'feeding', 'sleep', 'diaper', 'solid',
  'medicine', 'temperature', 'growth', 'milestone',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

/** 用 Record<EventType, …> 约束，漏掉任何一种类型都会编译报错 */
export const eventPayloadSchemas: Record<EventType, z.ZodTypeAny> = {
  feeding: feedingSchema,
  sleep: sleepSchema,
  diaper: diaperSchema,
  solid: solidSchema,
  medicine: medicineSchema,
  temperature: temperatureSchema,
  growth: growthSchema,
  milestone: milestoneSchema,
}

export type EventPayload =
  | z.infer<typeof feedingSchema>
  | z.infer<typeof sleepSchema>
  | z.infer<typeof diaperSchema>
  | z.infer<typeof solidSchema>
  | z.infer<typeof medicineSchema>
  | z.infer<typeof temperatureSchema>
  | z.infer<typeof growthSchema>
  | z.infer<typeof milestoneSchema>

export type ValidationResult =
  | { ok: true; data: EventPayload }
  | { ok: false; errors: string[] }

export function validateEventPayload(type: EventType, payload: unknown): ValidationResult {
  const schema = eventPayloadSchemas[type]
  if (!schema) return { ok: false, errors: [`未知的记录类型: ${String(type)}`] }
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    }
  }
  return { ok: true, data: parsed.data as EventPayload }
}

export function validateNote(note: string | undefined | null): ValidationResult | null {
  if (note === undefined || note === null) return null
  if (note.length > NOTE_MAX_LENGTH) {
    return { ok: false, errors: [`note: 备注不能超过 ${NOTE_MAX_LENGTH} 字`] }
  }
  return null
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @moonbud/shared test`
Expected: PASS —— 9 个测试全绿

- [ ] **Step 5: 建立 workspace 与构建配置**

`pnpm-workspace.yaml`：
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

`packages/shared/package.json` 要点：`"name": "@moonbud/shared"`、`"type": "module"`、`"main": "./dist/index.cjs"`、`"module": "./dist/index.js"`、`"types": "./dist/index.d.ts"`、`exports` 映射 `./event-types`；scripts 为 `build: tsup` 与 `test: vitest run`；deps 只有 `zod`，devDeps 为 `tsup`、`typescript`、`vitest`。

`packages/shared/src/index.ts` 重导出 `./event-types`。

- [ ] **Step 6: 构建并确认产物**

Run: `pnpm --filter @moonbud/shared build`
Expected: `dist/index.js`、`dist/index.cjs`、`dist/index.d.ts` 均生成，exit 0

- [ ] **Step 7: Commit**

```bash
git add pnpm-workspace.yaml packages/shared
git commit -m "feat(shared): add event payload schemas and validation"
```

---

### Task 2: API 契约类型

**Files:**
- Create: `packages/shared/src/api-types.ts`
- Test: `packages/shared/src/__tests__/api-types.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: Task 1 的 `EventType`、`EventPayload`
- Produces:
  - `type FamilyRole = 'OWNER' | 'ADMIN' | 'MEMBER'`
  - `interface UserDto { id: string; username: string; nickname: string; timezone: string; avatarUrl: string | null }`
  - `interface FamilyDto { id: string; name: string; ownerId: string; role: FamilyRole; archivedAt: string | null }`
  - `interface ChildDto { id: string; familyId: string; name: string; gender: 'MALE' | 'FEMALE' | 'UNKNOWN'; birthday: string; avatarUrl: string | null; archivedAt: string | null }`
  - `interface EventDto { id, childId, familyId, type: EventType, occurredAt: string, endedAt: string | null, payload: EventPayload, note: string | null, createdBy: string, updatedBy: string | null, createdAt: string, updatedAt: string }`
  - `interface ReminderDto { id, familyId, childId: string | null, title, note: string | null, type: 'ONE_TIME' | 'RECURRING', dueAt: string | null, rrule: string | null, timezone: string, assigneeId: string | null, status: 'ACTIVE' | 'DONE' | 'CANCELLED', createdBy, createdAt }`
  - `interface ReminderOccurrenceDto { id, reminderId, dueAt: string, firedAt: string | null, status: 'PENDING' | 'DONE' | 'SKIPPED', completedBy: string | null, completedAt: string | null }`
  - `interface NotificationDto { id, userId, familyId, occurrenceId: string | null, title, body, readAt: string | null, createdAt: string }`
  - `interface Paginated<T> { items: T[]; total: number; page: number; pageSize: number }`
  - `interface AuthResponse { accessToken: string; refreshToken: string; user: UserDto; mustChangePassword: boolean }`
  - `type ApiError = { statusCode: number; message: string | string[]; error: string }`
  - `const USERNAME_PATTERN: RegExp` —— `/^[A-Za-z0-9_]{4,20}$/`
  - `const PASSWORD_MIN_LENGTH = 8`
  - `isValidUsername(v: string): boolean`
  - `type ThemePresetId = 'mist-blue' | 'cream-orange' | 'mint-green' | 'dusk-purple'`

- [ ] **Step 1: 写失败的测试**

```typescript
// packages/shared/src/__tests__/api-types.test.ts
import { describe, expect, it } from 'vitest'
import { PASSWORD_MIN_LENGTH, USERNAME_PATTERN, isValidUsername } from '../api-types'

describe('账号规则', () => {
  it('接受 4–20 位字母数字下划线', () => {
    expect(isValidUsername('mama2024')).toBe(true)
    expect(isValidUsername('grand_pa_01')).toBe(true)
    expect(isValidUsername('abcd')).toBe(true)
    expect(isValidUsername('a'.repeat(20))).toBe(true)
  })

  it('拒绝过短、过长、含中文或空格的账号', () => {
    expect(isValidUsername('abc')).toBe(false)
    expect(isValidUsername('a'.repeat(21))).toBe(false)
    expect(isValidUsername('妈妈2024')).toBe(false)
    expect(isValidUsername('mama 2024')).toBe(false)
    expect(isValidUsername('')).toBe(false)
  })

  it('密码最短 8 位', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8)
  })

  it('账号正则可复用且带 ^ $ 锚点', () => {
    expect(USERNAME_PATTERN.source.startsWith('^')).toBe(true)
    expect(USERNAME_PATTERN.source.endsWith('$')).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/shared test`
Expected: FAIL —— `Cannot find module '../api-types'`

- [ ] **Step 3: 实现 `packages/shared/src/api-types.ts`**

纯类型声明 + 三个常量/函数。所有 DTO 的时间字段都是 **ISO 8601 字符串**（不是 `Date`），因为要穿过 JSON 边界。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @moonbud/shared test`
Expected: PASS —— 4 个新测试 + Task 1 的 9 个全绿

- [ ] **Step 5: 导出全部公共 API 并构建**

`src/index.ts` 追加 `export * from './api-types'`。

Run: `pnpm --filter @moonbud/shared build && pnpm --filter @moonbud/shared test`
Expected: 构建 exit 0，13 个测试全绿

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add API contract types and account rules"
```

---

### Task 3: 提醒 RRULE 与"下次触发"计算

**Files:**
- Create: `packages/shared/src/reminder-recurrence.ts`
- Test: `packages/shared/src/__tests__/reminder-recurrence.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `computeDueAt(params: { type: 'ONE_TIME' | 'RECURRING'; dueAt?: Date | null; rrule?: string | null; timezone: string; after: Date }): Date | null`
    - `ONE_TIME`：`dueAt > after` 时返回 `dueAt`，否则 `null`
    - `RECURRING`：返回**严格晚于 `after`** 的第一个触发时刻，按 `timezone` 解析；无法解析或已耗尽返回 `null`
  - `expandDueDates(params: { rrule: string; timezone: string; from: Date; to: Date; limit?: number }): Date[]`
  - `isSupportedTimezone(tz: string): boolean`

- [ ] **Step 1: 写失败的测试**

```typescript
// packages/shared/src/__tests__/reminder-recurrence.test.ts
import { describe, expect, it } from 'vitest'
import { computeDueAt, expandDueDates, isSupportedTimezone } from '../reminder-recurrence'

const TZ = 'Asia/Shanghai' // UTC+8，无夏令时，便于断言

describe('computeDueAt / ONE_TIME', () => {
  it('未来时间原样返回', () => {
    const due = new Date('2026-11-01T00:00:00Z')
    const after = new Date('2026-10-31T00:00:00Z')
    expect(computeDueAt({ type: 'ONE_TIME', dueAt: due, timezone: TZ, after })?.toISOString())
      .toBe('2026-11-01T00:00:00.000Z')
  })

  it('已过去的时间返回 null', () => {
    const due = new Date('2026-10-01T00:00:00Z')
    const after = new Date('2026-10-31T00:00:00Z')
    expect(computeDueAt({ type: 'ONE_TIME', dueAt: due, timezone: TZ, after })).toBeNull()
  })

  it('缺少 dueAt 时返回 null 而不抛错', () => {
    expect(computeDueAt({ type: 'ONE_TIME', dueAt: null, timezone: TZ, after: new Date() })).toBeNull()
  })
})

describe('computeDueAt / RECURRING', () => {
  it('每天 08:00（上海）在 UTC 是 00:00', () => {
    const after = new Date('2026-10-15T12:00:00Z')
    const next = computeDueAt({ type: 'RECURRING', rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0', timezone: TZ, after })
    expect(next?.toISOString()).toBe('2026-10-16T00:00:00.000Z')
  })

  it('时区不同则触发时刻不同', () => {
    const after = new Date('2026-10-15T12:00:00Z')
    const sh = computeDueAt({ type: 'RECURRING', rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0', timezone: 'Asia/Shanghai', after })
    const ny = computeDueAt({ type: 'RECURRING', rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0', timezone: 'America/New_York', after })
    expect(sh!.getTime()).not.toBe(ny!.getTime())
  })

  it('结果严格晚于 after，不会重复返回同一时刻', () => {
    const rrule = 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0'
    const first = computeDueAt({ type: 'RECURRING', rrule, timezone: TZ, after: new Date('2026-10-15T12:00:00Z') })!
    const second = computeDueAt({ type: 'RECURRING', rrule, timezone: TZ, after: first })!
    expect(second.getTime()).toBeGreaterThan(first.getTime())
  })

  it('无法解析的 rrule 返回 null 而不抛错', () => {
    expect(computeDueAt({ type: 'RECURRING', rrule: 'THIS IS NOT RRULE', timezone: TZ, after: new Date() })).toBeNull()
    expect(computeDueAt({ type: 'RECURRING', rrule: null, timezone: TZ, after: new Date() })).toBeNull()
  })
})

describe('expandDueDates', () => {
  it('展开区间内所有触发的本地 8 点', () => {
    const dates = expandDueDates({
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
      timezone: TZ,
      from: new Date('2026-10-15T00:00:00Z'),
      to: new Date('2026-10-18T00:00:00Z'),
    })
    expect(dates.map((d) => d.toISOString())).toEqual([
      '2026-10-15T00:00:00.000Z',
      '2026-10-16T00:00:00.000Z',
      '2026-10-17T00:00:00.000Z',
    ])
  })

  it('遵守 limit 上限，避免无限展开', () => {
    const dates = expandDueDates({
      rrule: 'FREQ=MINUTELY',
      timezone: TZ,
      from: new Date('2026-10-15T00:00:00Z'),
      to: new Date('2026-10-16T00:00:00Z'),
      limit: 10,
    })
    expect(dates).toHaveLength(10)
  })

  it('to 早于 from 时返回空数组', () => {
    expect(expandDueDates({
      rrule: 'FREQ=DAILY', timezone: TZ,
      from: new Date('2026-10-20T00:00:00Z'), to: new Date('2026-10-15T00:00:00Z'),
    })).toEqual([])
  })
})

describe('isSupportedTimezone', () => {
  it('认识 IANA 名，不认识乱写的字符串', () => {
    expect(isSupportedTimezone('Asia/Shanghai')).toBe(true)
    expect(isSupportedTimezone('Not/AZone')).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/shared test`
Expected: FAIL —— `Cannot find module '../reminder-recurrence'`

- [ ] **Step 3: 实现 `packages/shared/src/reminder-recurrence.ts`**

依赖 `rrule` 包。**跨时区的算法是本任务的核心**，必须按这个顺序做，否则会把本地时间当 UTC 用：

1. 用 `isSupportedTimezone` 校验时区，非法直接返回 `null`。
2. 把 `after` 转成**目标时区的墙上时间**（用 `Intl.DateTimeFormat` 逐个取 year/month/day/hour/minute）。
3. 构造 `RRule`，`dtstart` 传该墙上时间的 UTC 组合（`Date.UTC(y, m, d, h, min)`）——这样 rrule 在"墙上时间坐标系"里计算，`BYHOUR=8` 才真的是早上 8 点。
4. 取 `rule.after(wallAfter, false)` 得到墙上时间的下一个时刻。
5. 把结果从墙上时间**还原成真实 UTC**：用目标时区在该时刻的 UTC 偏移量做减法。偏移量算法：对候选时刻 `t`，求「目标时区在 `t` 的墙上时间 - `t`」，即为偏移。
6. 用第 5 步的偏移再校验一次（夏令时切换日偏移会变），若不一致则以还原后的真实时刻重新走第 3–5 步，最多迭代 2 次。

`expandDueDates` 用 `rule.between(wallFrom, wallTo, true)`，再对每个结果做第 5 步的还原，最后 `slice(0, limit ?? 500)`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @moonbud/shared test`
Expected: PASS —— 全部 13 个新测试 + 此前 13 个全绿

- [ ] **Step 5: 导出并构建**

`src/index.ts` 追加 `export * from './reminder-recurrence'`。
Run: `pnpm --filter @moonbud/shared build`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add timezone-aware RRULE recurrence computation"
```

---

## Self-Review

**1. Spec coverage：** spec 第 4 节 8 种记录类型与 payload 字段 → Task 1 全覆盖（逐字段对照过：feeding 4 字段、sleep 1、diaper 3、solid 3、medicine 3、temperature 2、growth 3、milestone 2）。第 5 节账号规则 4–20 位字母数字下划线 → Task 2。第 4 节提醒时区与 RRULE → Task 3。第 6 节调度依赖的"下次触发"计算 → Task 3。**无遗漏。**

**2. Step scan：** 每个 step 都是单一动作且结果可校验。Task 3 第 3 步给出了跨时区算法（因为签名与测试不能唯一决定实现，属于 skill 允许的"签名和测试决定不了的算法"例外）。其余均为签名 + 测试断言。

**3. Type consistency：** `EventType`/`EventPayload`（Task 1）在 Task 2 的 `EventDto` 中复用；`ReminderDto.type` 的 `'ONE_TIME' | 'RECURRING'` 与 `computeDueAt` 的 `type` 参数（Task 3）完全一致；`ThemePresetId`（Task 2）将与 mobile 计划第 1 任务的 4 套预设同名。

**4. Review Focus：** 5 条全部在 Task 1 Step 1 有对应测试 —— 多带字段（`bogus`）、华氏度（`98.6`）、睡眠区间（**注意：区间校验在 events 表的 `ended_at`，不在 payload，因此移到后端计划 Task 8 的测试中钉住**）、奶量 0/负数、note 超长（`NOTE_MAX_LENGTH` 常量已定义，具体拒绝逻辑在 Task 1 的 `validateNote`，其测试补在 Task 1 Step 1 的第 9 个用例里）。

**5. Proportion：** 本计划约 400 行实现约 300 行代码，比例合理。无逐行转录。
