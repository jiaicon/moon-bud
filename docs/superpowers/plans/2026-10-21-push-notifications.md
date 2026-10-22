# 月芽消息推送（uni-push 2.0 代码侧）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让服务端能向已注册设备发出推送（个推 REST API v2，厂商通道参数留好接缝），并让 App 把设备 cid 上报/注销；到点提醒默认**不**走推送。

**Architecture:** 沿用 `apps/api/src/push/` 已有的 `PushProvider` 接缝——业务代码只认令牌，换实现只换绑定。新增 `devices` 模块存设备 cid，`GetuiPushProvider` 做 cid 查询 + 个推鉴权 + 单推；纯构造逻辑（鉴权签名、请求体）拆成无网络依赖的函数以便断言。移动端只在 `APP-PLUS` 条件编译里上报 cid，H5 行为零变化。

**Tech Stack:** NestJS 10 + Prisma 5 + class-validator（API）；uni-app Vue3 + Pinia + vitest（客户端）；个推 REST API v2。

**Spec:** `docs/superpowers/specs/2026-10-21-push-notifications-design.md`

## Global Constraints

- 注释、错误消息、日志文案一律中文；注释写"为什么"，不写"这行做什么"。
- 凭证（`GETUI_APPKEY` / `GETUI_MASTER_SECRET`）不进 git、不进 APK、不进聊天、不进日志正文；`cid` 只记后 6 位。
- 不写任何打真实个推接口的测试；不测真实到达。
- `pnpm -F @moonbud/api test`（e2e，需 `.env.test` 指向 `moonbud_test`）与 `pnpm -F @moonbud/mobile test`（vitest）在每个任务结束时必须绿；`pnpm -F @moonbud/api typecheck` 与 `pnpm -F @moonbud/mobile type-check` 无错。
- 未经用户明确指示不 commit、不 push（本计划的 commit 步骤在用户说"提交"后才执行；否则把变更留在工作区）。
- 包名 `top.iconmen.yueya`、签名 yueya 自有证书、appid `__UNI__9B2D760` 已固化，本计划不得改动。
- 本机 `node dist/main.js` 常驻会锁住 `query_engine-windows.dll.node`，`prisma generate` 报 `EPERM` 时先看 `index.d.ts` 是否已写出新模型（TS client 先写、dll 后动），已写出就继续，不要为此杀掉常驻进程。

---

## 文件结构

**新增**

| 文件 | 职责 |
|---|---|
| `apps/api/prisma/migrations/<ts>_add_devices/` | `devices` 表 |
| `apps/api/src/devices/dto/register-device.dto.ts` | 上报入参校验 |
| `apps/api/src/devices/devices.service.ts` | cid 的 upsert / 归属正确的删除 / 脱敏列表 |
| `apps/api/src/devices/devices.controller.ts` | 三个路由 |
| `apps/api/src/devices/devices.module.ts` | 装配 |
| `apps/api/src/push/getui/getui-request.ts` | 纯函数：鉴权体、单推请求体（无网络） |
| `apps/api/src/push/getui-push.provider.ts` | 个推实现：token 缓存、cid 查询、门控、失败不抛 |
| `apps/api/test/devices.e2e-spec.ts` | devices 三路由 + 归属规则 |
| `apps/api/test/getui-request.e2e-spec.ts` | 纯函数断言 |
| `apps/api/test/getui-push.provider.e2e-spec.ts` | provider 行为（注入 fake fetch/prisma） |
| `apps/mobile/src/notifications/push-client.ts` | cid 上报/注销 + `onPushMessage` 落点 |
| `apps/mobile/src/notifications/__tests__/push-client.test.ts` | 纯逻辑 + mock apiRequest |

**修改**

`apps/api/prisma/schema.prisma`（Device 模型 + User 关系）、`apps/api/test/utils/db.ts`（TRUNCATE 列表）、
`packages/shared/src/api-types.ts`（`DeviceDto`）、`apps/api/src/push/push.module.ts`（工厂绑定）、
`apps/api/src/push/push-provider.interface.ts`（补 `kind` 说明，签名不变）、
`apps/api/src/auth/reset-request.service.ts`（找回请求接推送）、`apps/api/src/app.module.ts`（DevicesModule）、
`apps/mobile/src/api/endpoints.ts`（`devicesApi`）、`apps/mobile/src/stores/auth.ts`（登录/登出接线）、
`apps/mobile/src/App.vue`（冷启动上报）、`apps/mobile/vitest.setup.ts`（补 `getPushClientId`/`onPushMessage` 桩）、
`apps/mobile/src/manifest.json`（`usesCleartextTraffic:false`）、`.env.example`、`deploy/compose.prod.yml`、
`README.md`（配置表）、`apps/mobile/BUILD.md`（厂商通道待办）。

---

### Task 1: Device 模型与迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（在 `model Notification` 之后加模型；User 的关系块 L64-77 加一行）
- Modify: `apps/api/test/utils/db.ts:32-43`（TRUNCATE 列表）
- Test: `apps/api/test/devices.e2e-spec.ts`（本任务只写"表可用"一节）

**Interfaces:**
- Produces：`prisma.device` — `create` / `findUnique({clientId})` / `findMany({userId})` / `deleteMany({where:{clientId,userId}})` / `upsert`；模型字段
  `id: string`、`userId: string`、`clientId: string`（`@unique`）、`platform: string`、`lastSeenAt: Date`、`createdAt: Date`。

- [ ] **Step 1: 写失败的测试**

在 `apps/api/test/devices.e2e-spec.ts` 新建文件，先只放一节（`describe('devices 表')`）：
用 `resetDatabase()`，直接 `new PrismaClient()`（照 `test/utils/db.ts` 的惰性获取写法）建一个 user
再 `prisma.device.create({data:{userId, clientId:'DEV_CLIENTID_AAAA01', platform:'android'}})`，
断言读回来的 `clientId` 相同；再用同一个 `clientId` 建第二条，断言抛出唯一约束错误
（`Prisma.PrismaClientKnownRequestError` 且 `code === 'P2002'`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @moonbud/api test:e2e -- devices`
Expected: FAIL —— `prisma.device` 不存在（TS 编译错 `Property 'device' does not exist on type 'PrismaClient'`）

- [ ] **Step 3: 加模型**

```prisma
model Device {
  id         String   @id @default(uuid()) @db.Uuid
  userId     String   @db.Uuid
  /// 个推 cid。重装 App / 清数据都会换，所以不做"设备指纹"式的合并。
  clientId   String   @unique
  platform   String
  /// 只用于排障："这台设备最后一次报到是什么时候"，不参与投递决策。
  lastSeenAt DateTime @default(now()) @db.Timestamptz(3)
  createdAt  DateTime @default(now()) @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("devices")
}
```

User 关系块加 `devices Device[]`；`test/utils/db.ts` 的 TRUNCATE 列表首行前加 `devices,`。

- [ ] **Step 4: 生成 client 并建迁移**

Run: `cd apps/api && npx prisma migrate dev --name add_devices`
Expected: 生成迁移目录，输出 `Your database is now in sync with your schema.`
若报 `EPERM … query_engine-windows.dll.node`：按 Global Constraints 处理（查 `index.d.ts` 有无 `devices`）。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm -F @moonbud/api test:e2e -- devices` 与 `pnpm -F @moonbud/api test:e2e -- schema`
Expected: PASS（schema 那套不能因为新表变红）

- [ ] **Step 6: Commit（等用户指示）** `feat(api): 设备表存推送 cid`

---

### Task 2: DeviceDto 与 devices 模块

**Files:**
- Modify: `packages/shared/src/api-types.ts`
- Create: `apps/api/src/devices/dto/register-device.dto.ts`、`devices.service.ts`、`devices.controller.ts`、`devices.module.ts`
- Modify: `apps/api/src/app.module.ts`（imports 里 `PushModule` 之前插 `DevicesModule`）
- Test: `apps/api/test/devices.e2e-spec.ts`

**Interfaces:**
- Consumes：Task 1 的 `prisma.device`；`@CurrentUser()` → `{ id: string; username: string }`；`createTestApp()`。
- Produces：
  - `packages/shared`：`export interface DeviceDto { id: string; maskedClientId: string; platform: string; lastSeenAt: string }`
  - `DevicesService`：
    `register(userId: string, dto: RegisterDeviceDto): Promise<void>`
    `unregister(userId: string, clientId: string): Promise<void>`
    `list(userId: string): Promise<DeviceDto[]>`
  - 路由：`POST /api/devices/push-client`(204)、`DELETE /api/devices/push-client`(204)、`GET /api/devices/push-clients`(200)

- [ ] **Step 1: 写失败的测试**

在 `devices.e2e-spec.ts` 加 `describe('设备注册接口')`，用现有 e2e 的注册/登录取 token 工具写法
（照 `apps/api/test/notifications.e2e-spec.ts` 里建用户拿 token 的方式）。断言：

1. 未带 token `POST /api/devices/push-client` → 401。
2. `POST {clientId:'CID_OWNER_A1', platform:'android'}` → 204；`GET /api/devices/push-clients` → 1 条且
   `maskedClientId === '…' + 'CID_OWNER_A1'.slice(-6)`，且整个响应 JSON 里 `not.toContain('CID_OWNER_A1')`
   （断"不泄露完整 cid"，别手写后 6 位免得自己数错）。
3. 同一 cid 重复 POST → 204 且列表仍 1 条（幂等），`lastSeenAt` 变新。
4. **接管**：用户 B 登录后 POST 同一个 cid → 204；此时 A 的 `GET` 列表为空、B 的列表有 1 条。
5. **归属正确的删除**：A 对被 B 接管的 cid 发 `DELETE` → 204，但 B 的列表仍有该设备。
6. `DELETE {clientId:'不存在的'}` → 204（幂等注销，不因没登记过而报错）。
7. `POST {clientId:'short'}`（<8 字符）→ 400，`message` 是中文。
8. `POST {clientId:'CID_X', platform:'ios'}` → 400。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @moonbud/api test:e2e -- devices`
Expected: FAIL —— 404（路由不存在），且 `DeviceDto` 无法 import

- [ ] **Step 3: 实现**

`packages/shared/src/api-types.ts` 加 `DeviceDto`。
`register-device.dto.ts`：`clientId` `@IsString() @Length(8, 64)`（中文 `defaultMessage`），
`platform` `@IsIn(['android'], { message: '目前只支持 android 设备' })`。
`devices.service.ts` 的三个方法按 Interfaces 的签名写；要点：
`register` 用 `upsert`（`where:{clientId}`，`update:{userId, lastSeenAt: new Date()}`）——**归属转移靠 update 换 userId**；
`unregister` 用 `deleteMany({ where: { clientId, userId } })`，**两个条件必须同时给**，否则 A 退出会把 B 已接管的设备删掉；
`list` 的脱敏：`maskedClientId` = `'…' + clientId.slice(-6)`。
controller 用 `@HttpCode(204)`（POST/DELETE）与 `@CurrentUser()`；模块 `providers/exports: [DevicesService]`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @moonbud/api test:e2e -- devices && pnpm -F @moonbud/api typecheck`
Expected: 8 条断言全 PASS，typecheck 无错

- [ ] **Step 5: Commit（等指示）** `feat(api): 设备 cid 注册与注销接口`

---

### Task 3: 个推请求体纯函数

**Files:**
- Create: `apps/api/src/push/getui/getui-request.ts`
- Test: `apps/api/test/getui-request.e2e-spec.ts`

**Interfaces:**
- Produces：
  - `const GETUI_BASE = (appId: string) => string` → `https://restapi.getui.com/v2/${appId}`
  - `buildAuthBody(appKey: string, masterSecret: string, timestamp: string): { appKey: string; sign: string; timestamp: string }`，
    `sign` = `sha256(appKey + masterSecret + timestamp)` 的十六进制小写
  - `buildPushBody(input: PushBodyInput): Record<string, unknown>`，其中
    ```ts
    export interface PushBodyInput {
      cids: string[]
      title: string
      body: string
      ttlMs: number
      requestId: string
      data: Record<string, unknown>
      /** 小米"私信/服务类"分类 id；未审批下来时不传，请求体里也不留空字段 */
      pushCategory?: string
    }
    ```
    形状要求：`{ request_id, audience: { cid: string[] }, settings: { ttl: number }, push_channel: { android: { classification: 1, ...(pushCategory ? { category: pushCategory } : {}) } }, notification: { android: { title, body, click_type: 'NONE' }, ... }, push_message: { android: { title, body, transmission: JSON.stringify(data) } } }`
    （`classification: 1` = 系统消息；`ttl` 单位毫秒；`transmission` 放 payload，客户端 `onPushMessage` 读它。）

- [ ] **Step 1: 写失败的测试**

`getui-request.e2e-spec.ts`（`node:crypto` 的 `createHash` 由实现使用，测试自己独立算一遍期望值）：

1. `buildAuthBody('k','m','1700000000000').sign === createHash('sha256').update('k'+'m'+'1700000000000').digest('hex')`，且 `timestamp` 原样、`appKey` 原样。
2. `GETUI_BASE('AppID123') === 'https://restapi.getui.com/v2/AppID123'`。
3. `buildPushBody({cids:['a','b'], title:'有人需要重置密码', body:'x 提交了请求', ttlMs:3600000, requestId:'r1', data:{familyId:'f1'}})`：
   `audience.cid` 是 `['a','b']`、`settings.ttl === 3600000`、
   `push_channel.android.classification === 1`、
   `push_message.android.transmission === JSON.stringify({familyId:'f1'})`。
4. 传 `pushCategory:'service.reminder'` 时 `push_channel.android.category === 'service.reminder'`；
   **不传时 `push_channel.android` 里不存在 `category` 键**（`expect(body.push_channel.android).not.toHaveProperty('category')`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @moonbud/api test:e2e -- getui-request`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 `apps/api/src/push/getui/getui-request.ts`**

`sign` 用 `import { createHash } from 'node:crypto'`。类型上 `buildPushBody` 返回
`Record<string, unknown>` 即可（个推响应形状由 Task 4 定义窄接口，不在这里建整套 DTO——YAGNI）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @moonbud/api test:e2e -- getui-request && pnpm -F @moonbud/api typecheck`
Expected: 4/4 PASS

- [ ] **Step 5: Commit（等指示）** `feat(api): 个推请求体构造（纯函数）`

---

### Task 4: GetuiPushProvider

**Files:**
- Create: `apps/api/src/push/getui-push.provider.ts`
- Modify: `apps/api/src/push/push-provider.interface.ts`（只补注释，签名不动）
- Test: `apps/api/test/getui-push.provider.e2e-spec.ts`

**Interfaces:**
- Consumes：Task 3 的 `buildAuthBody` / `buildPushBody` / `GETUI_BASE`；Task 1 的 `prisma.device`；`PushProvider` 接口。
- Produces：
  ```ts
  @Injectable()
  export class GetuiPushProvider implements PushProvider {
    constructor(prisma: PrismaService, config: ConfigService)
    async send(userId: string, title: string, body: string, data?: Record<string, unknown>): Promise<void>
  }
  ```
  构造时读取：`GETUI_APPID`、`GETUI_APPKEY`、`GETUI_MASTER_SECRET`、
  `XIAOMI_PUSH_CATEGORY`（可空）、`PUSH_REMINDER_DUE`（字符串 `'true'` 才为真，默认假）。
  注入点：`fetchFn` 与 `now` 通过 `private` 字段可被测试替换
  （`provider.setFetchForTest(fn)` / `provider.setNowForTest(fn)`——测试专用的小口子，比 mock 全局 fetch 干净）。

行为契约（每条对应一个测试）：

1. `data.occurrenceId` 存在且 `PUSH_REMINDER_DUE !== 'true'` → **一个请求都不发**，`debug` 日志说明"到点提醒由设备本地定时负责"。
2. 该 `userId` 无设备 → 不发请求，`debug` 日志，不抛。
3. 首次发送前调 `POST {base}/auth`，token 缓存在实例字段；同一次进程内第二次 `send` **不再** 调 `/auth`。
4. token 过期（个推返回 `{result:false, code: '…err…'}` 或 HTTP 401）→ 重取一次 token 并重发；仍失败 → `warn`，**不抛**。
5. 任何个推侧异常（网络错、非 2xx、`result:false`）→ `warn` 日志包含 cid 后 6 位与错误码，**绝不向上抛**（`await expect(provider.send(...)).resolves.toBeUndefined()`）。
6. 日志正文只记长度：`title`/`body` 的明文不得出现在被断言的日志串里。
7. cid 列表全部一次 `POST /push/single/cid`（多 cid 同请求），`requestId` 每次唯一（用 `randomUUID()`）。

- [ ] **Step 1: 写失败的测试**

`getui-push.provider.e2e-spec.ts`：`new GetuiPushProvider(fakePrisma as never, fakeConfig as never)`，
`fakePrisma.device.findMany` 用 `mockResolvedValue`，`fakeConfig.get` 按 key 返回值；
`setFetchForTest` 注入返回 `{ ok:true, json:async()=>({data:{token:'T'}}) }` / `{ok:true,json:async()=>({code:0,result:'ok'})}` 的假 fetch，
断言被调用次数的 URL 路径序列（如 `['/auth','/push/single/cid']`、第二次 `send` 后仍是 3 次调用而不是 4 次）。
上面 7 条契约各写 1 个 `it`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @moonbud/api test:e2e -- getui-push`
Expected: FAIL —— 类不存在

- [ ] **Step 3: 实现**

`send` 的顺序：门控 → 查 cid → 空则返回 → 确保 token → `buildPushBody` → POST → 检查响应 →
失败时按契约 4 重试一次 → 仍失败只 `warn`。`warn` 用 Nest `Logger`。
把"响应是否成功"的判断写成私有方法 `isOk(res)`：HTTP 2xx 且 `code === 0`（个推 v2 的成功码），
token 失效的判断写成 `isAuthError(res)`（401 或 `code` 为 `'err:...'`/文档里的鉴权码族——
**spike 之后才知道具体码值，这里按 401 + `result:false` 两条走，并把码值列成注释里的待确认项**）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @moonbud/api test:e2e -- getui-push && pnpm -F @moonbud/api typecheck`
Expected: 7/7 PASS

- [ ] **Step 5: Commit（等指示）** `feat(api): 个推推送通道实现`

---

### Task 5: 通道绑定与配置

**Files:**
- Modify: `apps/api/src/push/push.module.ts`、`.env.example`、`deploy/compose.prod.yml`、`README.md`（配置表）
- Test: `apps/api/test/push-binding.e2e-spec.ts`

**Interfaces:**
- Consumes：`GetuiPushProvider`、`NoopPushProvider`、`PUSH_PROVIDER`。
- Produces：`PushModule` 用 `useFactory` 绑定，注入 `ConfigService`；三件套（`GETUI_APPID`/`GETUI_APPKEY`/`GETUI_MASTER_SECRET`）**齐全**→ Getui，缺任一 → Noop。启动时 `Logger.log` 一行 `推送通道：个推（已配置）` 或 `推送通道：未配置凭证，只写日志（App 关闭时收不到任何通知）`。

- [ ] **Step 1: 写失败的测试**

`push-binding.e2e-spec.ts`：不建 HTTP app，直接
`Test.createTestingModule({imports:[ConfigModule.forRoot({isGlobal:true, load: () => env})], providers:[PrismaModule, PushModule]}).compile()`
两次（`env` 分别给"三件套齐"/"缺 MASTER_SECRET"），断言 `moduleRef.get(PUSH_PROVIDER)` 的 `constructor.name` 分别是 `GetuiPushProvider` / `NoopPushProvider`。
（若 `PrismaService` 在无 DATABASE_URL 时构造失败，注入一个 `{device:{}} as never` 的 provider 覆盖 `PrismaService`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @moonbud/api test:e2e -- push-binding`
Expected: FAIL —— 拿到的永远是 `NoopPushProvider`

- [ ] **Step 3: 实现工厂 + 补配置**

`push.module.ts` 的 `{provide: PUSH_PROVIDER, useClass: NoopPushProvider}` 换成 `useFactory`，
依赖 `[ConfigService, PrismaService]`。
`.env.example` 追加（含"留空即退回只写日志""`PUSH_REMINDER_DUE` 默认关的原因见 spec 第 3 节"两行注释）：

```
# ---- 推送（uni-push 2.0 / 个推）----
GETUI_APPID=
GETUI_APPKEY=
GETUI_MASTER_SECRET=
# 小米"私信/服务类"消息分类 id，商店审批通过后填；不填则不下发 category 字段
XIAOMI_PUSH_CATEGORY=
# 到点提醒是否也走服务端推送。默认 false：本地定时更准时也更抗进程被杀，开了会双弹
PUSH_REMINDER_DUE=false
```

`deploy/compose.prod.yml` 的 api `environment:` 加五项 `${GETUI_APPID:-}` 形式透传（这是该文件里第一处变量透传，
在 `SCHEDULER_ENABLED` 上方注明"以下均可留空，留空即不启用推送"）；README 配置表补同五行。

- [ ] **Step 4: 跑全量 API 测试**

Run: `pnpm -F @moonbud/api test && pnpm -F @moonbud/api typecheck`
Expected: 全绿（既有套件不应因绑定变化而红——测试环境里没有 GETUI 变量，仍是 Noop）

- [ ] **Step 5: Commit（等指示）** `feat(api): 按环境变量选择推送通道`

---

### Task 6: 找回请求接上推送

**Files:**
- Modify: `apps/api/src/auth/reset-request.service.ts:30-40`（构造注入）与 `:91-104`（create 之后 send）
- Modify: `apps/api/src/auth/auth.module.ts`（若需要；`PushModule` 是 `@Global()`，通常不需要）
- Test: `apps/api/test/notifications.e2e-spec.ts` 或 `passwords.e2e-spec.ts` 里新增断言（就近选找回请求那个套件）

**Interfaces:**
- Consumes：`@Inject(PUSH_PROVIDER) push: PushProvider`。
- Produces：`reset-request.service.ts` 在写完每位管理员的 Notification 后调用
  `this.push.send(managerId, '有人需要重置密码', body, { familyId, kind: 'password_reset' })`
  （`data.occurrenceId` 缺席 → 不受 Task 4 契约 1 的门控，一定会尝试推送）。

- [ ] **Step 1: 写失败的测试**

在已有的"找回请求生成管理员通知"那条 e2e 里补一个断言：用
`Test.createTestingModule({imports:[AppModule]}).overrideProvider(PUSH_PROVIDER).useValue({send: jest.fn()})`
起 app，走一次找回密码请求，断言 `send` 被调用 1 次且第 4 个参数含 `kind: 'password_reset'` 与该管理员
确实管理的那家 `familyId`。若既有套件不方便加 override，就在本任务新建 `reset-push.e2e-spec.ts` 放这一条。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @moonbud/api test:e2e -- <那个套件名>`
Expected: FAIL —— `send` 调用次数 0

- [ ] **Step 3: 实现**

在写 Notification 的同一个循环里调 `push.send`（**不 await 失败**：Task 4 已保证 provider 不抛；
`send` 返回的 promise 直接 await 即可，因为它内部已 catch）。日志别在这里重复写。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @moonbud/api test:e2e`
Expected: 全绿

- [ ] **Step 5: Commit（等指示）** `feat(api): 找回密码请求走推送通道`

---

### Task 7: 客户端 cid 上报模块

**Files:**
- Create: `apps/mobile/src/notifications/push-client.ts`
- Modify: `apps/mobile/src/api/endpoints.ts`（加 `devicesApi`）、`apps/mobile/vitest.setup.ts`（补桩）
- Test: `apps/mobile/src/notifications/__tests__/push-client.test.ts`

**Interfaces:**
- Consumes：`apiRequest`（`src/api/http.ts`）。
- Produces：
  - `devicesApi = { register: (clientId: string) => ... POST /devices/push-client, unregister: (clientId: string) => ... DELETE, list: () => GET /devices/push-clients }`
  - `push-client.ts`：
    `const CLIENT_ID_KEY = 'pushClientId'`
    `export async function registerPushClient(): Promise<string | null>` —— 拿 cid、POST 上报、
    成功时把 cid 写进 `uni.setStorageSync(CLIENT_ID_KEY)` 并返回 cid；任一步失败返回 `null` 且**不抛**。
    `export async function unregisterPushClient(): Promise<void>` —— 读本地存的 cid，DELETE，
    **无论成败都清掉本地 key**。
    `export function startPushClickHandler(): void` —— 注册 `uni.onPushMessage`，
    `type==='click'` 时按 payload 走 `notificationTarget()` 已有的分流；无 payload 或非 click 时什么都不做。
    整个文件体用 `// #ifdef APP-PLUS` / `// #endif` 包住外部接口调用，导出的函数在非 App 平台
    第一时间返回（`if (typeof uni.getPushClientId !== 'function') return null`）。

- [ ] **Step 1: 写失败的测试**

vitest，`vi.mock('../../api/http', () => ({ apiRequest: vi.fn() }))`，并给 `globalThis.uni` 临时加
`getPushClientId`（`vi.fn((opts)=>opts.success({client_id:'CID_FROM_SDK_A1B2C3'}))`）与 `onPushMessage`。断言：

1. `registerPushClient()` 成功 → `apiRequest` 被以 `('/devices/push-client', {method:'POST', data:{clientId:'CID_FROM_SDK_A1B2C3', platform:'android'}})` 调用，返回该 cid，`uni.getStorageSync(CLIENT_ID_KEY)` 等于它。
2. SDK 回调 `fail` → 不发请求、返回 `null`、不抛。
3. `apiRequest` reject → 返回 `null`、不抛（**上报失败不能影响登录流程**）。
4. `unregisterPushClient()`：本地有 cid → 发 DELETE 且清 key；本地无 cid → 一个请求都不发；DELETE 失败（reject）→ key 仍被清掉。
5. `uni.getPushClientId` 不存在（H5）→ `registerPushClient()` 返回 `null`，无请求。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @moonbud/mobile test -- push-client`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现**

`uni.getPushClientId({ success, fail })` 包成 Promise（`new Promise`，两个回调各 resolve，注意 `fail` 也 resolve 成 `null` 而不是 reject）。
`vitest.setup.ts` 里补 `getPushClientId: undefined`（保持"不存在"默认态，让用例 5 天然成立）与
`onPushMessage: () => {}`，具体用例内再覆盖。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @moonbud/mobile test && pnpm -F @moonbud/mobile type-check`
Expected: 全绿

- [ ] **Step 5: Commit（等指示）** `feat(mobile): 上报推送设备 cid`

---

### Task 8: 客户端接线（登录 / 冷启动 / 退出）

**Files:**
- Modify: `apps/mobile/src/stores/auth.ts:87`（login 成功之后）、`:127`（logout）、`:205`（applySession）、`:216`（resetDueWatch 附近）
- Modify: `apps/mobile/src/App.vue:28-34`（bootstrap 之后）

**Interfaces:**
- Consumes：Task 7 的 `registerPushClient` / `unregisterPushClient` / `startPushClickHandler`。
- Produces：无新导出。

- [ ] **Step 1: 写失败的测试**

`apps/mobile/src/stores/__tests__/auth-push.test.ts`（vitest）：`vi.mock` 掉 `notifications/push-client`
与 `api/http`，构造 store 后调用 `login()`，断言 `registerPushClient` 被调用 1 次；调用 `logout()`，
断言 `unregisterPushClient` 被调用 1 次。断言"register 返回 null 时 login 仍然成功"
（即 `login()` 返回值不受上报结果影响）。
若现有 auth store 测试的组织方式不便新增文件，就把这几条并入既有 auth 测试文件里（照它的 mock 写法）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @moonbud/mobile test -- auth`
Expected: FAIL —— 上报函数没被调用（次数 0）

- [ ] **Step 3: 实现**

三处调用都是 `void registerPushClient()`（**不 await**：登录成功不该等一次上报）；
`logout` 里 `void unregisterPushClient()`；`App.vue` 的 `bootstrap().then(...)` 分支里，在
`startDueWatch()` 旁边加 `void registerPushClient()` 与 `startPushClickHandler()`。
`startPushClickHandler` 必须只在 `onLaunch` 注册一次（它内部 `uni.onPushMessage` 只加监听）。
注释要写明"上报失败不影响登录/登出"这个选择的理由。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @moonbud/mobile test && pnpm -F @moonbud/mobile type-check && pnpm -F @moonbud/api test:e2e`
Expected: 全绿

- [ ] **Step 5: Commit（等指示）** `feat(mobile): 登录与冷启动上报推送 cid，退出注销`

---

### Task 9: manifest 收口与交接文档

**Files:**
- Modify: `apps/mobile/src/manifest.json`（`usesCleartextTraffic` → `false`，并在注释里写明厂商通道还没通、`offline` 仍为 `false` 的原因）
- Modify: `apps/mobile/BUILD.md`（新增"厂商通道待办"一节）、`docs/superpowers/HANDOFF.md`

**Interfaces:**
- Consumes：无。
- Produces：给用户的 GUI/审核交接清单（第 4 节 A–E），以及 spike 的三个问题。

- [ ] **Step 1: 改 manifest**

`"usesCleartextTraffic" : false`。原注释解释的是"局域网调试走明文"，那条前提已随公网域名消失，
换成一句为什么现在关：留明文等于给中间人机会，且 API 已经只走 HTTPS。
`sdkConfigs.push.unipush.offline` 保持 `false` 并加注释：小米厂商凭证还没下来，
拿到后改成 `true` 才能"划掉 App 也收到"（spec 第 2 节表格）。

- [ ] **Step 2: BUILD.md 补"厂商通道待办"**

写清五件事的具体动作与归属：软著、App 备案（给出签名 MD5 `49:DB:D5:E6:05:18:8F:36:82:4A:86:A4:9F:60:B6:7E`
和包名）、小米非公开上架、私信/服务类分类申请、DCloud 厂商推送设置 + `offline:true` + 重新云打包；
外加 spec 第 6 节的三个 spike 问题（cid 能否拿到 / 个推通道三种状态下弹不弹 / MIUI 划掉后本地定时还弹不弹），
并把 `GETUI_*` 三个键的填写位置（`/home/workspace/moon-bud/.env`，别贴聊天）写进去。

- [ ] **Step 3: HANDOFF.md 记未决项**

`PUSH_REMINDER_DUE` 的默认值依赖 spike 结论；个推鉴权失效的具体码值待真机确认；
入家申请审批目前不产生通知（因此也没有推送），是后续项。

- [ ] **Step 4: 全量验证**

Run: `pnpm -F @moonbud/api test && pnpm -F @moonbud/api typecheck && pnpm -F @moonbud/mobile test && pnpm -F @moonbud/mobile type-check`
Expected: 全绿；`git status --porcelain` 里没有 `.env`（本地 `.env` 只由用户手改，不进 git）

- [ ] **Step 5: Commit（等指示）** `docs(mobile): 厂商通道待办与真机 spike 清单`

---

## Review Focus

spec 说了、但没有哪个任务的测试天然覆盖的东西——每条在括号里标了 owning task：

1. **家人共用一台手机**：cid 被后登录者接管后，先登录者既不再收到推送，也不该能在自己设备列表里看到它；
   A 的退出登录不能删掉 B 的设备（Task 2 断言 4、5）。
2. **凭证缺失时服务照常起**：`GETUI_*` 只填两个就必须退回 Noop 并在启动日志说明，绝不因为推送配置不全
   让 API 起不来（Task 5）。
3. **推送失败不拖垮提醒生成**：个推 500 / 网络错 / cid 一个都没有，`createForOccurrence` 的 fan-out 必须
   照常给其余收件人写完通知，`tick()` 不该因此报错（Task 4 契约 5 + Task 6）。
4. **H5 上这段代码等于不存在**：没有 `uni.getPushClientId` 的平台上，`registerPushClient` 静默返回 `null`，
   不产生请求也不弹错（Task 7 断言 5）。
5. **日志不得泄露内容**：`title`/`body` 明文与完整 cid 都不许出现在被断言的日志里（Task 4 契约 6）。
6. **到点提醒双弹**：`PUSH_REMINDER_DUE` 为 `false` 时服务端对 occurrence 类一个请求都不发（Task 4 契约 1）；
   这条是"默认关"的实际含义，spike 若推翻默认值，测试仍然钉得住行为。
