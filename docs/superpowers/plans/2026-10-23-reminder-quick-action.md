# 提醒固定动作 + 到点「记一笔」（智能助手第一期）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提醒可以携带一个固定动作（一种记录类型 + 一份合法的预填值），到点时弹框与通知中心各给一个「记一笔」按钮，点一下按当前时刻直接落库；预填不完整就退化成「去记一笔」跳表单。

**Architecture:** 三处新数据都挂在已有的东西上，不新增表：`reminders` 加 `eventType`/`actionPayload`，`events` 加 `fromReminderId`，通知列表按 `occurrence → reminder` **读时** join 出一个嵌套的 `action`（不在 `notifications` 上存冗余，也不让客户端为每一行再发一次请求）。判「能不能直接记」只用一个权威：`actionPayload` 要么为 null（只带类型，到点跳表单），要么**已经过该类型的完整 `validateEventPayload`**（服务端写入时就拦住）——所以客户端不需要 partial 校验、不需要类型白名单，生长发育那种"必填为空但 refine 要求至少一项"的情况自动落到跳表单那一侧。写库一律走已有的出箱（`outboxStore.submitCreate`），断网就进待同步。

**Tech Stack:** NestJS 10 + Prisma 5 + class-validator + zod（shared）；uni-app Vue3 + Pinia + vitest；jest e2e（真实数据库）。

**Spec:** `docs/superpowers/specs/2026-10-23-smart-assistant-design.md`（第一期那一节 + 上面的裁定记录）

## Global Constraints

- 注释、错误消息、界面文案一律中文；注释写"为什么"，不写"这行做什么"。
- 本任务**不碰 DeepSeek、不碰 `POST /assistant/parse`**：那是第二期，接口形状由本任务定下的 `eventType`/`actionPayload` 决定。
- 「记一笔」点下去不许问任何问题（spec 反目标）。需要人补字段的唯一表达方式是跳到已有的表单页。
- 不给健康记录的数字（体温/奶量/剂量/身高体重）设任何默认值。预填值只能是人建提醒时自己填过的那一份。
- 游客态：本任务新增的两个入口（提醒表单的动作格、到点「记一笔」）都在登录才能到达的页面上，不新增游客门控。
- `pnpm -F @moonbud/shared build` 要在 api/mobile 的类型检查之前跑（两端从 dist 读类型）。
- `pnpm -F @moonbud/api test`（e2e，需 `.env.test` 指向 `moonbud_test`，**必须 `--runInBand`**：本机并行全量会成波假红）与 `pnpm -F @moonbud/mobile test` 在每个任务结束时必须绿；`pnpm -F @moonbud/api typecheck` 与 `pnpm -F @moonbud/mobile type-check` 无错。
- 页面接线按本仓库既有做法用**源码扫描测试**断言（`apps/mobile/src/pages/__tests__/*.test.ts` 里 `readFileSync` + `toMatch`），纯逻辑放模块里用普通 vitest 断言。
- 未经用户明确指示不 commit、不 push（本计划的 commit 步骤在用户说"提交"后才执行；否则把变更留在工作区）。
- 本机 `node dist/main.js` 常驻会锁住 `query_engine-windows.dll.node`：`prisma generate` 报 `EPERM` 时先看 `index.d.ts` 里新字段是否已写出，已写出就继续，不要杀掉常驻进程。
- 每次真机验证要等一轮云打包：能在服务端算清楚的（动作合法性、通知 join）都不要留到客户端判。

## Review Focus

规范 implied 但没有哪个任务会自然去测、最可能在使用中咬人的五处。每一行都在指定任务里有对应的测试步骤：

1. **选了动作却没选孩子**（家庭级提醒）—— 期望建提醒表单当场拦住（"带动作的提醒要先选孩子"），而不是保存成功、到点那条动作永远记不进去。（T6）
2. **改了动作类型没清旧预填** —— 期望落库的是新类型下的合法 payload 或 null，绝不出现 `eventType=temperature` 配 `payload={name:'维D'}`。（T2）
3. **多条同时到点** —— 期望弹框仍是单个「知道了」，一个「记一笔」都不出现；把两条混成一框再让人挑，正是反目标。（T7）
4. **断网点「记一笔」** —— 期望这一次点击算成功（标已读、不报错），那条记录以"待同步"的样子出现在记录页；恢复网络后重放要带着 `fromReminderId` 落进同一条、不重复。（T5 + T4）
5. **通知对应的那个孩子已经归档** —— 期望那一行/那一个框显示「去记一笔」而不是「记一笔」，因为服务端对归档孩子是 400，而 400 在出箱里要重试 8 次才放弃（那段时间看起来像没反应）。（T5 + T8）

## 本计划明确不做

- **「排队后才撞上归档」的立即 drop。** 设计文档里那条（"恢复网络后才发现不可写要立即放弃并说明"）不做：判据只能是 HTTP 400 的状态码，而 400 里也藏着真正的数据错误，据它丢弃会把人记下的东西吃掉；现有行为（重试后放弃 + 一句提示）不是新造的缺陷。客户端在**点之前**拦（T5/T6/T8）已覆盖这条路径的绝大多数，剩下的竞态是"离线期间家长把孩子归档了"，代价是一条待同步被放弃并说明。**若以后要真解决，正确做法是让服务端为归档返回可区分的状态码，不是在客户端猜 400。**
- 通知中心/弹框之外的第三个入口（提醒列表卡片上的动作）。
- 本地排期（`plus.push` 那条兜底路径）带动作：它只在完全没有 cid 时武装，且系统通知栏里点出「记一笔」需要自建通知，超出第一期。
- 记录列表上标"这条来自提醒"。`fromReminderId` 只落库不展示（统计是后话）。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `apps/api/prisma/migrations/20261023090000_add_reminder_action/` | 两条新列 + `fromReminderId`（T1） |
| `packages/shared/src/api-types.ts`（改） | `ReminderDto` 两字段、`EventDto.fromReminderId`、`NotificationQuickActionDto`、`NotificationDto.action` |
| `apps/api/src/reminders/dto/{create,update}-reminder.dto.ts`（改） | 入参形状（枚举、可选对象） |
| `apps/api/src/reminders/reminders.service.ts`（改） | 动作的**规则**：孩子必填、payload 完整校验、改类型清 payload |
| `apps/api/src/events/dto/create-event.dto.ts`、`events.service.ts`（改） | `fromReminderId` 的写入与回读 |
| `apps/api/src/notifications/notifications.service.ts`（改） | 读时 join 出 `action`（列表与标记已读同一套） |
| `apps/mobile/src/notifications/quick-record.ts` | 唯一判定点：这条通知能不能一键记、按钮叫什么、写库那一下 |
| `apps/mobile/src/pages/reminder-form/index.vue`（改） | 「到点顺手记」一格：类型芯片 + 必填项内联 + 说实话的提示语 |
| `apps/mobile/src/notifications/due-watch.ts`（改） | 弹框三态（单按钮 / 记一笔 / 去记一笔） |
| `apps/mobile/src/pages/notification-center/index.vue`（改） | 每行的动作入口 |
| `apps/api/test/{schema,reminder-action,notifications,events}.e2e-spec.ts` | 服务端 |
| `apps/mobile/src/notifications/__tests__/quick-record.test.ts`、`pages/__tests__/{reminder-action-grid,notification-action}.test.ts` | 客户端 |

任务顺序即依赖顺序：T1 是列与契约，T2/T3/T4 都在它上面，T5 是客户端唯一判断口，T6/T7/T8 只是三处接线。

---

### Task 1: 库与共享契约

**Files:**
- Create: `apps/api/prisma/migrations/20261023090000_add_reminder_action/migration.sql`
- Modify: `apps/api/prisma/schema.prisma:176-239`（`model Event`、`model Reminder`）
- Modify: `packages/shared/src/api-types.ts`
- Modify: `apps/api/src/reminders/reminders.service.ts`（`toReminderDto`、`create`）
- Modify: `apps/api/src/events/events.service.ts`（`toEventDto`）
- Test: `apps/api/test/schema.e2e-spec.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - Prisma：`Reminder.eventType: String?`、`Reminder.actionPayload: Prisma.JsonValue`（可空 JSON）、`Event.fromReminderId: String? @db.Uuid`
  - `ReminderDto.eventType: EventType | null`、`ReminderDto.actionPayload: EventPayload | null`
  - `EventDto.fromReminderId: string | null`
  - `NotificationQuickActionDto { reminderId: string; childId: string; eventType: EventType; payload: EventPayload | null }` 与 `NotificationDto.action: NotificationQuickActionDto | null`（本任务只加类型与 `null`，join 在 T3）

- [ ] **Step 1: 写失败的测试**（加进 `apps/api/test/schema.e2e-spec.ts` 的 `describe` 里）

```ts
it('提醒可以存一个动作，记录可以记住它是从哪条提醒来的', async () => {
  const u = await prisma.user.create({
    data: { username: 'schema_act1', passwordHash: 'x', nickname: 'A', timezone: 'Asia/Shanghai' },
  })
  const f = await prisma.family.create({ data: { name: 'F', ownerId: u.id } })
  const c = await prisma.child.create({
    data: { familyId: f.id, name: '大宝', gender: 'UNKNOWN', birthday: '2025-01-01' },
  })
  const r = await prisma.reminder.create({
    data: {
      familyId: f.id, childId: c.id, title: '吃维D', type: 'ONE_TIME',
      dueAt: new Date(), timezone: 'Asia/Shanghai', createdBy: u.id,
      eventType: 'medicine', actionPayload: { name: '维D', dose: '400IU' },
    },
  })
  expect(r.eventType).toBe('medicine')
  expect(r.actionPayload).toEqual({ name: '维D', dose: '400IU' })

  const e = await prisma.event.create({
    data: {
      childId: c.id, familyId: f.id, type: 'medicine', occurredAt: new Date(),
      payload: { name: '维D', dose: '400IU' }, createdBy: u.id, fromReminderId: r.id,
    },
  })
  expect(e.fromReminderId).toBe(r.id)
})

it('没有动作的提醒（老数据）读回来两者都是 null', async () => {
  const u = await prisma.user.create({
    data: { username: 'schema_act2', passwordHash: 'x', nickname: 'B', timezone: 'Asia/Shanghai' },
  })
  const f = await prisma.family.create({ data: { name: 'G', ownerId: u.id } })
  const r = await prisma.reminder.create({
    data: { familyId: f.id, title: '交疫苗本', type: 'ONE_TIME', dueAt: new Date(), timezone: 'Asia/Shanghai', createdBy: u.id },
  })
  expect(r.eventType).toBeNull()
  expect(r.actionPayload).toBeNull()
})
```

- [ ] **Step 2: 跑它，确认失败**

Run: `pnpm -F @moonbud/api test:e2e -- schema.e2e-spec`
Expected: FAIL — Prisma 报 `Unknown argument 'eventType'` / TS 里 `fromReminderId` 不存在。

- [ ] **Step 3: 改 `schema.prisma` 并生成迁移**

`model Reminder` 加（放在 `assigneeId` 之后、`status` 之前）：

```prisma
/// 到点顺手记的记录类型；null = 这条提醒没有动作。取值受 @moonbud/shared 的 EVENT_TYPES 约束（库里不做枚举，改类型不必迁移）。
eventType     String?
/// 该动作的预填 payload。约定只有一种状态：要么 null，要么已经过该类型的完整 zod 校验（见 reminders.service.ts）。
actionPayload Json?
```

`model Event` 加一行 `fromReminderId String? @db.Uuid`（注释：一键生成的出处；**不加关系、不加级联**，提醒删了记录要留着）。

Run: `cd apps/api && npx prisma migrate dev --name add_reminder_action`
Expected: 生成 `20261023..._add_reminder_action`，开发库已应用，client 已重新生成。

- [ ] **Step 4: 把迁移应用到测试库**

Run: `cd apps/api && set -a && . ../../.env.test && set +a && npx prisma migrate deploy`
Expected: `Everything has been applied`（`.env.test` 指 `moonbud_test`；漏了这一步 e2e 会在旧表上跑）。

- [ ] **Step 5: 加共享契约字段**

`packages/shared/src/api-types.ts`：`ReminderDto` 补两个字段、`EventDto` 补 `fromReminderId: string | null`、新增 `NotificationQuickActionDto` 并在 `NotificationDto` 末尾加 `action: NotificationQuickActionDto | null`。每个字段都带一句中文注释说明"null 是什么"。然后 `pnpm -F @moonbud/shared build`。

- [ ] **Step 6: 映射读写**

`toReminderDto` 回 `eventType: reminder.eventType as EventType | null` 与 `actionPayload: (reminder.actionPayload as EventPayload | null) ?? null`；`create` 的 `data` 带上 `eventType: dto.eventType ?? null` 与 `actionPayload`（此时 T2 还没校验，**照原样存**）。`toEventDto` 回 `fromReminderId: event.fromReminderId`。`markRead`/`list`/`toNotificationDto` 先回 `action: null`，好让类型过编译——T3 才填它，别在这里留半成品注释。

Run: `pnpm -F @moonbud/api test:e2e -- schema.e2e-spec` 与 `pnpm -F @moonbud/api typecheck`
Expected: 两条测试 PASS；typecheck 无错。凡是手写 `ReminderDto` / `NotificationDto` / `EventDto` 字面量的地方（测试夹具与 `apps/mobile/src/preview/mock-data.ts` 都算）都要补齐 `eventType: null, actionPayload: null` / `action: null` / `fromReminderId: null`，一并改掉。

- [ ] **Step 7: 跑两端全量**

Run: `pnpm -F @moonbud/mobile test`
Expected: 全绿（夹具缺字段会当场红，补上即可）。

- [ ] **Step 8: Commit（等用户说提交）**

`git add apps/api/prisma packages/shared/src/api-types.ts apps/api/src apps/mobile/src && git commit -m "feat: 提醒可以携带固定动作，记录可以记住出处"`

---

### Task 2: 提醒动作的写入规则

**Files:**
- Modify: `apps/api/src/reminders/dto/create-reminder.dto.ts`
- Modify: `apps/api/src/reminders/dto/update-reminder.dto.ts`
- Modify: `apps/api/src/reminders/reminders.service.ts`
- Test: `apps/api/test/reminder-action.e2e-spec.ts`（新建，照 `reminders.e2e-spec.ts` 的 `register`/`post` helper 写法）

**Interfaces:**
- Consumes: T1 的列与 DTO
- Produces:
  - `CreateReminderDto.eventType?: EventType`、`CreateReminderDto.actionPayload?: Record<string, unknown>`
  - `UpdateReminderDto.eventType?: EventType | null`、`UpdateReminderDto.actionPayload?: Record<string, unknown> | null`
  - 服务端语义（客户端与第二期都要按它写）：**有 `eventType` 必须有 `childId`；`actionPayload` 非 null 必须过该类型完整校验；`eventType` 为 null 时 `actionPayload` 必为 null。**

- [ ] **Step 1: 写失败的测试**

```ts
const postReminder = (body: Record<string, unknown>) =>
  request(app.getHttpServer())
    .post(`/api/families/${familyId}/reminders`)
    .set('Authorization', `Bearer ${me.token}`)
    .send({ title: '吃维D', type: 'ONE_TIME', dueAt: isoPlusMinute(), childId, ...body })

it('合法的 actionPayload 原样回读', async () => {
  const res = await postReminder({ eventType: 'medicine', actionPayload: { name: '维D', dose: '400IU' } }).expect(201)
  expect(res.body.eventType).toBe('medicine')
  expect(res.body.actionPayload).toEqual({ name: '维D', dose: '400IU' })
})

it('只带类型、不带 payload：动作存在，预填为空', async () => {
  const res = await postReminder({ eventType: 'medicine' }).expect(201)
  expect(res.body.eventType).toBe('medicine')
  expect(res.body.actionPayload).toBeNull()
})

it('payload 过不了该类型的完整校验就 400，且说清缺什么', async () => {
  const res = await postReminder({ eventType: 'medicine', actionPayload: { name: '维D' } }).expect(400)
  expect(JSON.stringify(res.body.message)).toContain('dose')
})

it('生长发育的空 payload 判成不合法（必填项为空不等于"能直接记"）', async () => {
  await postReminder({ eventType: 'growth', actionPayload: {} }).expect(400)
})

it('带动作的提醒必须挂在某个孩子上', async () => {
  await postReminder({ childId: null, eventType: 'medicine' }).expect(400)
})

it('未知的记录类型 400', async () => {
  await postReminder({ eventType: 'nap' }).expect(400)
})

it('PATCH 改 eventType 会清掉旧 actionPayload，同一请求带上新 payload 则保留', async () => {
  const created = await postReminder({ eventType: 'medicine', actionPayload: { name: '维D', dose: '400IU' } }).expect(201)
  const patch = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).patch(`/api/families/${familyId}/reminders/${created.body.id}`)
      .set('Authorization', `Bearer ${me.token}`).send(body)
  const cleared = await patch({ eventType: 'temperature' }).expect(200)
  expect(cleared.body.actionPayload).toBeNull()
  const kept = await patch({ eventType: 'medicine', actionPayload: { name: '维D', dose: '400IU' } }).expect(200)
  expect(kept.body.actionPayload).toEqual({ name: '维D', dose: '400IU' })
})

it('PATCH 把 eventType 置 null 会连 payload 一起清掉', async () => {
  // 建一条带动作的，PATCH { eventType: null } → 回读两者都是 null。
})

it('PATCH 只改标题不动 eventType 时，动作原样留着', async () => {
  // 建一条带动作的，PATCH { title: '改个名' } → eventType/actionPayload 都没变。
})
```

- [ ] **Step 2: 跑它，确认失败**

Run: `pnpm -F @moonbud/api test:e2e -- reminder-action`
Expected: FAIL — 现在 `eventType` 被 whitelist 丢掉（回读 null），400 的用例反而 201。

- [ ] **Step 3: 加 DTO 字段**

两个 DTO 各加 `eventType`（`@IsOptional()` + `@IsIn(EVENT_TYPES as unknown as string[], { message: '未知的记录类型' })`，update 那份再加 `@ValidateIf` 允许显式 null，理由照 `update-reminder.dto.ts` 里 `dueAt` 那条注释：`@IsOptional` 对 null 是跳过校验）与 `actionPayload`（`@IsOptional()` + `@IsObject()`）。

- [ ] **Step 4: 把规则写成一个函数**

在 `reminders.service.ts` 里加模块级 `function resolveAction(eventType, actionPayload, childId, current): { eventType: string | null; actionPayload: Prisma.InputJsonValue | typeof Prisma.DbNull }`——`current` 是库里已有的那条（PATCH 要用）。四条规则按上面的 Produces 原文实现，报错消息中文，`validateEventPayload` 的 `errors` 用 `'；'` 拼进消息。注意：
- PATCH 时"生效的 childId"是 `dto.childId === undefined ? current.childId : dto.childId`（`null` 表示显式清空，也算没孩子）。
- `actionPayload` 为 null 一律写 `Prisma.DbNull`。

然后在 `create` 与 `update` 的 `data` 里用它，`update` 的规则是"`eventType` 变了 → 没在同一请求里带新 payload 就清空"。

- [ ] **Step 5: 跑它，确认通过**

Run: `pnpm -F @moonbud/api test:e2e -- reminder-action` 然后 `pnpm -F @moonbud/api test`
Expected: 本任务 9 条 PASS；全量绿（`reminders.e2e-spec.ts` 没带这两个字段的旧用例不受影响，因为都可空）。

- [ ] **Step 6: Commit（等用户说提交）**

`git commit -am "feat(api): 提醒动作的入参校验与改类型清 payload"`

---

### Task 3: 通知列表读时 join 出动作

**Files:**
- Modify: `apps/api/src/notifications/notifications.service.ts`
- Test: `apps/api/test/notifications.e2e-spec.ts`

**Interfaces:**
- Consumes: T1 的 `NotificationQuickActionDto`、T2 保证的"payload 要么 null 要么合法"
- Produces: `GET /api/notifications` 与 `POST /api/notifications/:id/read` 的 `NotificationDto.action`：到点通知且该提醒带动作 → `{ reminderId, childId, eventType, payload }`；其余一律 `null`

- [ ] **Step 1: 写失败的测试**（在既有 `describe` 内，复用文件里的 `seedOccurrence`；给它加一个可选的动作参数，或直接在 `prisma.reminder.create` 之后 `prisma.reminder.update` 补上 `eventType`/`actionPayload`）

```ts
it('到点通知带出这条提醒的动作', async () => {
  // seed 一条带 eventType:'medicine' + actionPayload:{name:'维D',dose:'400IU'} 的提醒 → createForOccurrence → list
  const res = await list(me.token, '?unreadOnly=true').expect(200)
  expect(res.body.items[0].action).toEqual({
    reminderId, childId, eventType: 'medicine', payload: { name: '维D', dose: '400IU' },
  })
})

it('没有动作的到点通知 action 为 null', async () => { ... })
it('payload 为空的带动作提醒，action.payload 是 null（到点要跳表单）', async () => { ... })
it('家庭级提醒（childId 为 null 的老数据）不产生 action', async () => {
  // 直接绕过 T2 用 prisma 造一条 eventType 非 null、childId 为 null 的行：
  // 库里可能存在这种历史脏行，读的时候要说"没动作"，不能回一个 childId 为 null 的 action 让客户端去写库。
})
it('找回密码请求的通知 action 为 null', async () => { ... })
it('markRead 的返回同样带 action', async () => { ... })
```

- [ ] **Step 2: 跑它，确认失败**

Run: `pnpm -F @moonbud/api test:e2e -- notifications`
Expected: FAIL — `action` 恒为 null（T1 的占位）。

- [ ] **Step 3: 实现 join**

`list` 的 `findMany` 加 `include: { occurrence: { include: { reminder: { select: { id: true, childId: true, eventType: true, actionPayload: true } } } } }`；模块级加 `function buildAction(row): NotificationQuickActionDto | null`，四个条件全真才回对象：`row.occurrenceId` 非空、`occurrence.reminder.eventType` 非空、`childId` 非空、`isEventType(eventType)`（用 shared 的 `isEventType`：库里是裸 String，脏值不能往外发）。`markRead` 的 `findUnique` 加同一个 include，`toNotificationDto` 收第二个参数 `action`。`readAll` 不回 DTO，不动。

- [ ] **Step 4: 跑它，确认通过 + 全量**

Run: `pnpm -F @moonbud/api test:e2e -- notifications` 然后 `pnpm -F @moonbud/api test`
Expected: 全绿。

- [ ] **Step 5: Commit（等用户说提交）**

`git commit -am "feat(api): 到点通知读时带出提醒的固定动作"`

---

### Task 4: 记录落库时记住出处

**Files:**
- Modify: `apps/api/src/events/dto/create-event.dto.ts`
- Modify: `apps/api/src/events/events.service.ts:42-77`
- Modify: `apps/mobile/src/api/endpoints.ts`（`EventCreateInput`）
- Test: `apps/api/test/events.e2e-spec.ts`、`apps/mobile/src/stores/__tests__/outbox.test.ts`

**Interfaces:**
- Consumes: T1 的 `Event.fromReminderId`
- Produces: `CreateEventDto.fromReminderId?: string`（UUID，可选）；`EventCreateInput.fromReminderId?: string`

- [ ] **Step 1: 写服务端失败的测试**

```ts
it('带 fromReminderId 创建会存下来并回读', async () => {
  const res = await post({ childId, type: 'medicine', occurredAt: iso, payload: { name: '维D', dose: '400IU' }, fromReminderId: reminderId }).expect(201)
  expect(res.body.fromReminderId).toBe(reminderId)
})
it('fromReminderId 不是合法 UUID 就 400', async () => { await post({ ...base, fromReminderId: '提醒-1' }).expect(400) })
it('PATCH 不收 fromReminderId：改了类型也不会把出处丢掉', async () => {
  // 先带出处建一条，PATCH { type: 'temperature', ... } 里塞 fromReminderId: 别的 id，
  // 回读出处仍是原来那条 —— UpdateEventDto 没这个字段，whitelist 会静默丢掉，
  // 这条测试是钉住"静默丢掉"在这里恰好是我们想要的设计。
})
```

- [ ] **Step 2: 跑它，确认失败**

Run: `pnpm -F @moonbud/api test:e2e -- events.e2e-spec`
Expected: FAIL — `fromReminderId` 被 whitelist 丢掉，回读 null。

- [ ] **Step 3: 实现**

`CreateEventDto` 加 `@IsOptional() @IsUUID() fromReminderId?: string`；`create` 的 `data` 里 `...(dto.fromReminderId ? { fromReminderId: dto.fromReminderId } : {})`。`UpdateEventDto` **不加**（出处不是可编辑属性）。`toEventDto` 在 T1 已改，这里不用动。

- [ ] **Step 4: 写客户端失败的测试**（`apps/mobile/src/stores/__tests__/outbox.test.ts`，沿用文件里的 `baseInput` 与既有 mock 风格）

```ts
it('断网排队的那条带着出处，重放后出处不丢', async () => {
  // 让 eventsApi.create 抛网络错 → submitCreate('f1', { ...baseInput, fromReminderId: 'r-1' })
  // → 断言入队条目的 body.fromReminderId === 'r-1'
})
```

Run: `pnpm -F @moonbud/mobile test -- outbox`
Expected: FAIL —— 先给 `EventCreateInput` 加 `fromReminderId?: string` 让类型过（这一路的 RED 就是 `vue-tsc` / vitest 报的那个未知属性）；若加完类型就绿，说明入队 body 是原样透传的，这条测试留作回归锁，仍然要跑并读到输出。

- [ ] **Step 5: 跑两端全量**

Run: `pnpm -F @moonbud/api test` 与 `pnpm -F @moonbud/mobile test`
Expected: 全绿。

- [ ] **Step 6: Commit（等用户说提交）**

`git commit -am "feat: 一键生成的记录带上出处（fromReminderId）"`

---

### Task 5: 客户端唯一判定点 `quick-record.ts`

**Files:**
- Create: `apps/mobile/src/notifications/quick-record.ts`
- Test: `apps/mobile/src/notifications/__tests__/quick-record.test.ts`

**Interfaces:**
- Consumes: T1 的 `NotificationDto.action`、T3 服务端真正回传、T4 的 `EventCreateInput.fromReminderId`、`useOutboxStore().submitCreate`、`notificationsApi.markRead`、`refreshUnreadTabBadge`
- Produces（弹框与通知中心都只认这三个出口）:
  - `type QuickRecordPlan = { kind: 'none' } | { kind: 'record'; label: '记一笔'; familyId: string; input: EventCreateInput } | { kind: 'form'; label: '去记一笔'; url: string }`
    （`familyId` 在 `record` 分支上而不是在 `input` 里，因为 `submitCreate(familyId, input)` 就是分开的两个参数，`EventCreateInput` 里没有 `familyId` 这个字段）
  - `function quickRecordPlan(item: NotificationDto, now: Date, childArchived: boolean): QuickRecordPlan`
  - `function childArchivedFor(item: NotificationDto): boolean`（读 `useChildStore`：本地缓存里查不到这个孩子时回 `false` —— 不能因为缓存没这一条就拒绝人记）
  - `async function submitQuickRecord(plan: Extract<QuickRecordPlan, { kind: 'record' }>, notificationId: string): Promise<'saved' | 'queued'>`（`familyId`、`input` 都从 plan 里拿，调用方什么都不拼）

- [ ] **Step 1: 写失败的测试**

```ts
function notice(action: NotificationDto['action']): NotificationDto {
  return { id: 'n-1', userId: 'u-1', familyId: 'f-1', occurrenceId: 'o-1', title: '吃维D', body: '', readAt: null, createdAt: '2026-10-23T00:00:00.000Z', action }
}
const action = { reminderId: 'r-1', childId: 'c-1', eventType: 'medicine' as const, payload: { name: '维D', dose: '400IU' } }

it('没有动作的通知不给动作入口', () => {
  expect(quickRecordPlan(notice(null), NOW, false)).toEqual({ kind: 'none' })
})

it('预填合法：按钮叫"记一笔"，写库入参用当前时刻和这条提醒的出处', () => {
  const plan = quickRecordPlan(notice(action), NOW, false)
  expect(plan.kind).toBe('record')
  expect((plan as any).label).toBe('记一笔')
  expect((plan as any).familyId).toBe('f-1')
  expect((plan as any).input).toEqual({
    childId: 'c-1', type: 'medicine', occurredAt: NOW.toISOString(),
    payload: { name: '维D', dose: '400IU' }, fromReminderId: 'r-1', note: null,
  })
})

it('occurredAt 是当前时刻，不是通知的 createdAt', () => {
  // createdAt 故意设成与 NOW 差三小时的一条，断言 occurredAt === NOW.toISOString()
})

it('只带类型的动作跳表单，并把类型带过去', () => {
  const plan = quickRecordPlan(notice({ ...action, payload: null }), NOW, false)
  expect(plan).toEqual({ kind: 'form', label: '去记一笔', url: '/pages/event-form/index?type=medicine' })
})

it('孩子已归档时不直接写库，退成跳表单', () => {
  expect(quickRecordPlan(notice(action), NOW, true).kind).toBe('form')
})

it('familyId 用通知自己的，不用当前选中的家庭', () => {
  // notice 的 familyId 是 'f-1'，而 familyStore 当前选中的故意是另一家：
  // 断言 plan.familyId === 'f-1'，并且 quick-record.ts 里没有读 currentFamilyId（源码扫描：not.toMatch(/currentFamilyId/)）。
})
```

`submitQuickRecord` 的测试（`vi.mock` 两个依赖，照 `due-watch.test.ts` 的 hoisted mock 写法）：

```ts
it('在线写完就标已读并刷角标', async () => { ...expect(markRead).calledWith('n-1'); expect(refreshUnreadTabBadge).toHaveBeenCalled() })
it('断网排队也算这次点成功：同样标已读、同样刷角标', async () => { ... })
```

- [ ] **Step 2: 跑它，确认失败**

Run: `pnpm -F @moonbud/mobile test -- quick-record`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 `quick-record.ts`**

三个出口按 Produces 的签名写。要点：
- `kind` 的判定顺序：`item.action === null` → `none`；`childArchived || item.action.payload === null` → `form`；否则 `record`。**不重新跑 zod**：服务端已经保证 payload 合法，客户端再判一次只会出现"两处结论不一致"。
- 三个出口按 Produces 的签名写，`familyId` 只从 `item.familyId` 取，**绝不取当前选中的家庭**：通知说的是哪一家就记进哪一家，切家庭是另一件事。
- 已读标记不能挡路：`markRead` 失败只 `console.warn`（这条通知已经由本地 `seen` 记过一次，而"记一笔"这件事本身成功了；为一次标已读失败弹错误框是把重点搞反了）。角标刷新沿用 `notifications/tab-badge.ts` 的 `refreshUnreadTabBadge`。

- [ ] **Step 4: 跑它，确认通过 + 全量**

Run: `pnpm -F @moonbud/mobile test` 与 `pnpm -F @moonbud/mobile type-check`
Expected: 全绿、无类型错。

- [ ] **Step 5: Commit（等用户说提交）**

`git add apps/mobile/src/notifications && git commit -m "feat(mobile): 到点一键记录的判定与写入"`

---

### Task 6: 建提醒表单的「到点顺手记」

**Files:**
- Modify: `apps/mobile/src/pages/reminder-form/index.vue`
- Modify: `apps/mobile/src/api/endpoints.ts`（`ReminderCreateInput` / `ReminderUpdateInput`）
- Test: `apps/mobile/src/pages/__tests__/reminder-action-grid.test.ts`

**Interfaces:**
- Consumes: `EVENT_TYPE_META`、`fieldsFor`（`apps/mobile/src/events/event-fields.ts`）、`validateEventPayload`、T1 的 DTO 字段
- Produces: `ReminderCreateInput.eventType?: EventType | null`、`ReminderCreateInput.actionPayload?: Record<string, unknown> | null`

- [ ] **Step 1: 写源码扫描测试**（本仓库对页面接线的既有做法）

```ts
const source = readFileSync(join(srcDir, 'pages/reminder-form/index.vue'), 'utf8')

describe('提醒的「到点顺手记」', () => {
  it('动作类型走芯片行，且第一格是"不带动作"', () => {
    expect(source).toMatch(/actionType\s*=\s*ref\(''\)/)
    expect(source).toMatch(/@click="pickAction\(/)
    expect(source).toMatch(/v-for="t in EVENT_TYPES"/)
  })
  it('选了动作却没选孩子时当场拦住，不让它变成一条到点记不进去的提醒', () => {
    expect(source).toMatch(/pickAction[\s\S]{0,240}?showToast/)
    expect(source).toMatch(/if \(actionType\.value && !childId\.value\)/)
  })
  it('提示语说实话：填齐才说"直接记"，没填齐说"打开记一笔"', () => {
    expect(source).toMatch(/到点直接记/)
    expect(source).toMatch(/到点打开记一笔/)
    expect(source).toMatch(/actionReady/)
  })
  it('没填齐的预填不发出去（服务端只认完整 payload，半份会 400）', () => {
    expect(source).toMatch(/actionPayload: actionReady\.value \? buildActionPayload\(\) : null/)
  })
  it('编辑时回显动作', () => {
    expect(source).toMatch(/actionType\.value = reminder\.eventType \?\? ''/)
  })
})
```

- [ ] **Step 2: 跑它，确认失败**

Run: `pnpm -F @moonbud/mobile test -- reminder-action-grid`
Expected: FAIL — 全部断言都不在源文件里。

- [ ] **Step 3: 加状态与计算**

`actionType = ref('')`、`actionValues = reactive<Record<string, string>>({})`。
- `actionFields = computed(() => (actionType.value ? fieldsFor(actionType.value).filter((f) => f.required) : []))` —— 只列必填项（规范原话）。
- `buildActionPayload(): Record<string, unknown>`：照 `event-form/index.vue` 的 `buildPayload` 同一套规则（空值跳过；`kind === 'number'` 非数字要报错，不能当成"没填"存下去）。这里只需处理 `select` 与 `text`/`number` 三种 kind，其余 kind 现在没有必填项。
- `actionReady = computed(() => !!actionType.value && actionFields.value.every((f) => (actionValues[f.name] ?? '').trim() !== '') && validateEventPayload(actionType.value, buildActionPayload()).ok)`。**这一条是提示语和提交分支的唯一依据**，与 T5 的判读方式一致（服务端只做完整校验，所以"合法"与"齐"在这里是同一件事）。

- [ ] **Step 4: 写 UI 与提交**

在「备注」之前插一个 `.field`：
- 芯片行：第一格是"不带动作"（`pickAction('')`），其余 `v-for="t in EVENT_TYPES"` 显示 `EVENT_TYPE_META[t].icon + label`。
- `pickAction(t)`：`t` 非空且 `childId.value === ''` 时 `uni.showToast({ title: '带动作的提醒要先选关联的孩子', icon: 'none' })` 并**不改状态**（与 `pickType` 同一套"当场说清楚"的处理）。
- 选了类型后内联渲染 `actionFields`（select → 芯片行，其余 → `field__input`，`number` 用 `type="digit"`）。
- `<text class="field__hint">`：`actionReady` 为真 → 「到点直接记」；为假且已选类型 → 「到点打开记一笔（必填项还没填全）」。
- `onSubmit` 的 `shared` 里带 `eventType: actionType.value || null` 与 `actionPayload: actionReady.value ? buildActionPayload() : null`；`validate()` 里加 `if (actionType.value && !childId.value) errors.action = '带动作的提醒要先选关联的孩子'`（这一条同时兜住"孩子先选上又被清成不挂孩子"的路径）。
- `onLoad` 编辑回显：`actionType.value = reminder.eventType ?? ''`，`reminder.actionPayload` 非 null 时把每个键 `String(value)` 灌进 `actionValues`。

- [ ] **Step 5: 跑它，确认通过 + 全量 + 手验**

Run: `pnpm -F @moonbud/mobile test` 与 `pnpm -F @moonbud/mobile type-check`
Expected: 全绿。
手验（H5 已在 5173 跑着，`pnpm dev:h5` 只此一个，不要再起第二个）：新建一条一次性提醒，选"用药"，只填药名 → 提示应说「到点打开记一笔」；补齐剂量 → 变「到点直接记」；保存后重新编辑，预填应回显。

- [ ] **Step 6: Commit（等用户说提交）**

`git commit -am "feat(mobile): 建提醒时可以指定到点顺手记什么"`

---

### Task 7: 到点弹框的三个样子

**Files:**
- Modify: `apps/mobile/src/notifications/due-watch.ts`
- Test: `apps/mobile/src/notifications/__tests__/due-watch.test.ts`（扩展既有文件，沿用它的 `modals`/`tapConfirm`）

**Interfaces:**
- Consumes: T5 的 `quickRecordPlan` / `childArchivedFor` / `submitQuickRecord`、`NotificationDto.action`
- Produces: `showDueAlert(items: NotificationDto[])` 的弹框形态由 `planDueWatch` 那一轮的 `surface` 决定；`dueWatchMessage` 与 `planDueWatch` 的既有语义不变

- [ ] **Step 1: 写失败的测试**

```ts
it('单条带动作的到点：确认按钮是"记一笔"，点它就写库', async () => {
  // 一条 action 合法的通知 → tick() → 断言最近一次 modal 的 confirmText === '记一笔'、showCancel === true
  // → tapConfirm() → 断言 submitQuickRecord 被调用一次
})
it('点"知道了"（取消）不写库、不标已读，弹框状态照常复位', async () => {
  // tapCancel() → submitQuickRecord 未被调用；再来一轮同样的通知仍能弹（alertOpen 复位了）
})
it('单条只带类型的到点：确认按钮是"去记一笔"，点了跳表单', async () => {
  // action.payload === null → confirmText '去记一笔' → tapConfirm → uni.navigateTo 带 '?type=medicine'
})
it('多条到点仍然只有一个"知道了"', async () => {
  // 两条都带动作 → showCancel === false、confirmText === '知道了'、submitQuickRecord 未被调用
})
it('无动作的单条保持今天的样子', async () => { /* showCancel:false + '知道了' */ })
it('孩子已归档时不出现"记一笔"', async () => { /* childArchivedFor → true，action 合法 → confirmText '去记一笔' */ })
```

- [ ] **Step 2: 跑它，确认失败**

Run: `pnpm -F @moonbud/mobile test -- due-watch`
Expected: FAIL — 现在的弹框永远 `showCancel: false`。

- [ ] **Step 3: 实现**

`showDueAlert` 里先算 `const plan = items.length === 1 ? quickRecordPlan(items[0], new Date(), childArchivedFor(items[0])) : { kind: 'none' }`（**多条一律 no action**，这是规范的裁定，注释要写清理由：一屏里让人挑一条来记，就是把"点一下"变成"想一下"）。
- `kind === 'record'` → `confirmText: '记一笔'`、`cancelText: '知道了'`、`success: (res) => { if (res.confirm) void submitQuickRecord(plan, items[0].id) }`。
- `kind === 'form'` → 同两个文案换成 `'去记一笔'`，确认走 `uni.navigateTo({ url: plan.url })`。
- `kind === 'none'` → 现有那段不变。
- `complete` 复位 `alertOpen` 那段**保持原样、继续覆盖三条分支**（这是既有测试钉过的：漏一次复位会把后面的提醒全哑掉）。

- [ ] **Step 4: 跑它，确认通过 + 全量**

Run: `pnpm -F @moonbud/mobile test` 与 `pnpm -F @moonbud/mobile type-check`
Expected: 全绿。既有那条"框没点掉时新到点的那条不进 seen"的用例必须仍绿。

- [ ] **Step 5: Commit（等用户说提交）**

`git commit -am "feat(mobile): 到点弹框可以顺手记一笔"`

---

### Task 8: 通知中心每一行的动作入口

**Files:**
- Modify: `apps/mobile/src/pages/notification-center/index.vue`
- Test: `apps/mobile/src/pages/__tests__/notification-action.test.ts`

**Interfaces:**
- Consumes: T5 的三个出口、既有的 `markRead`/`refreshUnreadTabBadge` 用法
- Produces: 卡片右侧的动作芯片；整行点击的落点行为不变（`notificationTarget` 不改）

- [ ] **Step 1: 写源码扫描测试**

```ts
describe('通知中心的一键记录入口', () => {
  it('到点通知右侧有动作芯片，且不冒泡成整行跳转', () => {
    expect(source).toMatch(/v-if="actionOf\(item\)"/)
    expect(source).toMatch(/@click\.stop="act\(item\)"/)
  })
  it('动作来自 quickRecordPlan，本页不自己判能不能记', () => {
    expect(source).toMatch(/quickRecordPlan\(/)
    expect(source).toMatch(/childArchivedFor\(/)
  })
  it('点完刷新列表：那条已经不红了', () => {
    expect(source).toMatch(/void load\(true\)/)
  })
  it('多条到点在弹框里没有动作，但在这一页逐条都有（这是弹框合框的补偿）', () => {
    // 断言本页不按 items.length 做任何开关：源码里 act/actionOf 都不接 index 或长度条件
    expect(source).not.toMatch(/actionOf\(item,[\s\S]*length/)
  })
})
```

- [ ] **Step 2: 跑它，确认失败**

Run: `pnpm -F @moonbud/mobile test -- notification-action`
Expected: FAIL。

- [ ] **Step 3: 实现**

本页加两个小函数：`const actionOf = (item: NotificationDto) => quickRecordPlan(item, new Date(), childArchivedFor(item))`；`async function act(item: NotificationDto)` 取 `actionOf(item)`，`record` → `await submitQuickRecord(plan, item.id)`，`form` → `uni.navigateTo({ url: plan.url })`，`none` → 直接 return。末尾 `void load(true)` 与 `void refreshUnreadTabBadge()`。
**不 toast**：规范的原话是"点完不再弹任何东西"，而这一页上那条通知变灰（已读）+ 记录页的"待同步"就是反馈；只有失败才需要说话。
模板里 `.card` 内、`.card__body` 之后加一个 `<view>`，样式复用本页已有的 `.link`（24rpx 主色文本），不新增类名。**`.stop` 是必须的**：不加就会先记一笔再连着整行跳到提醒页，而"点完不再弹任何东西"里包含不许换页。

- [ ] **Step 4: 跑它，确认通过 + 全量 + 手验**

Run: `pnpm -F @moonbud/mobile test` 与 `pnpm -F @moonbud/mobile type-check`
Expected: 全绿。
手验（H5 5173）：到点通知行右侧出现「记一笔」，点了之后该行变灰（已读）且跳到记录页看不到它、但记录列表里多了一条用药；只带类型的那行显示「去记一笔」，点了进表单且类型已选中。

- [ ] **Step 5: Commit（等用户说提交）**

`git commit -am "feat(mobile): 通知中心里也能顺手记一笔"`

---

### Task 9: 文档与交接收口

**Files:**
- Modify: `docs/superpowers/specs/2026-10-23-smart-assistant-design.md`
- Modify: `apps/mobile/BUILD.md`（第 8 节实测记录之后补一段）
- Modify: `docs/superpowers/HANDOFF.md`

**Interfaces:**
- Consumes: 前八个任务的实际落地形状
- Produces: 无代码接口

- [ ] **Step 1: 把三处与设计文档不一致的地方写回文档**（这是文档的活，不是偷偷改设计）
  1. 「通知列表暴露 `reminderId` + `eventType`」落实为嵌套的 `action`（含 `childId` 与 `payload`），理由：客户端每行再发一次 GET 提醒详情是不可接受的。
  2. 「`actionPayload` 用 partial 宽松校验入库」落实为「要么 null，要么过完整校验」，理由：`growth` 的 schema 是 `z.object().strict().refine(...)`，`eventPayloadSchemas[type]` 静态类型是 `ZodTypeAny`，通用 `.partial()` 对它运行时就不存在；而"完整才存"恰好就是弹框两态需要的东西。
  3. 「恢复网络后发现不可写就立即 drop」不做，理由见本计划"本计划明确不做"那节，原文抄过去。
- [ ] **Step 2: `BUILD.md` 补第一期真机验证清单**：一条带动作的一次性提醒 → 前台等它响 → 弹框应有「记一笔」→ 点了之后记录页应出现一条；断网重复一遍应进「待同步」。写清这些都要等**下一次云打包**（现在装机的那版没有这批代码）。
- [ ] **Step 3: `HANDOFF.md` 记两件事**：`reminders.action_payload` 是**可空 JSON 列**（Prisma 置空要用 `Prisma.DbNull`，`null` 会被拒）；第二期（`POST /assistant/parse`）的输入形状就是本期的 `eventType` + `actionPayload`，模型输出必须过同一个 `validateEventPayload` 才能进提醒表单的预填。
- [ ] **Step 4: 跑两端全量**

Run: `pnpm -F @moonbud/api test` 与 `pnpm -F @moonbud/mobile test` 与两端 typecheck
Expected: 全绿：api 20 套件（新增 `reminder-action`）；mobile 103 文件 / 724 + 本期新增数。

- [ ] **Step 5: Commit（等用户说提交）**

`git commit -am "docs: 第一期落地形状写回设计文档，真机验证清单进 BUILD"`
