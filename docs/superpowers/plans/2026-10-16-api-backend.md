# moonBud 后端 API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个 Docker 部署的 NestJS + PostgreSQL API，实现账号密码鉴权、家庭/成员/角色、孩子、记录（8 种类型 + JSONB 校验）、邀请码、提醒与站内通知。

**Architecture:** NestJS 模块化单体，Prisma 访问 PostgreSQL，全局 `JwtAuthGuard` + 按家庭的 `FamilyMemberGuard`（RBAC 唯一实现处），`@nestjs/schedule` 每分钟扫描提醒并按需物化 occurrence。鉴权用 access/refresh 双 token；家庭上下文走 URL 路径而非 token。

**Tech Stack:** Node.js 24 · NestJS 10 · TypeScript 5 · Prisma 5 · PostgreSQL 16 · @nestjs/schedule · @nestjs/jwt · bcrypt · zod（经 `@moonbud/shared`）· Jest + supertest · Docker Compose

**Spec:** `docs/superpowers/specs/2026-10-16-moonbud-design.md`
**Depends on:** `docs/superpowers/plans/2026-10-16-shared-contract.md`（必须先完成，本计划消费其 `@moonbud/shared`）

## Global Constraints

- 所有涉及家庭的接口**必须**经 `FamilyMemberGuard` 校验 `(familyId, userId)` 存在，禁止在 service 里手写权限判断（spec 第 5 节）
- 角色仅 3 种：`OWNER` / `ADMIN` / `MEMBER`；不变量：**家庭至少保留一个 OWNER**、**最后一名 OWNER 不能退出**（spec 第 3、4 节）
- **没有 `DELETE /api/families/:id`**。家庭只能归档 / 退出 / 转让（spec 第 4 节末）
- 记录**一律软删除**（`deleted_at`），所有查询默认带 `deleted_at IS NULL`
- 编辑/删除记录仅限**创建者本人或 ADMIN/OWNER**（spec 第 4 节）
- `reminder_occurrences` 幂等靠 `unique(reminder_id, due_at)`；**按需物化，不预生成**（spec 第 4 节）
- `password_hash` 用 bcrypt；**任何日志、响应、异常中都不得出现密码或密码哈希**
- 时间存 `timestamptz`，JSON 里是 ISO 8601 UTC 字符串；`reminders.timezone` 必须是合法 IANA 名
- 端口 `3000`；Postgres 服务名 `postgres`、库名 `moonbud`
- 测试跑在**真实 PostgreSQL** 上（Docker），不用 sqlite 替身——JSONB、`unique` 约束、`timestamptz` 行为必须真实

## Review Focus

spec 未逐条规定、但用户会真实踩到的五类问题。每一条都在下表中指定的任务里有测试：

1. **越权读别人家的数据** —— 用户 A 拿到家庭 B 的 `familyId` 后直接请求，必须返回 **403/404**，绝不能返回数据。这是产品失败级问题（spec 反目标）。测试在 Task 5。
2. **最后一名 OWNER 退出导致家庭无主** —— 应被拒绝，家庭不能进入无人可管理的状态。测试在 Task 6。
3. **cron 重跑导致重复通知** —— 同一分钟扫两次不能给用户发两条一样的提醒，也不能因 RRULE 死循环卡住进程。测试在 Task 11。
4. **睡眠 `ended_at` 早于 `occurred_at`** —— 用户改错时间，应 400 而非存下负时长区间。测试在 Task 8。
5. **归档家庭后成员仍能读写** —— 归档必须是硬边界，不能只是列表里隐藏。测试在 Task 6。

---

### Task 1: 仓库骨架、Docker Compose 与健康检查

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `package.json`（根）
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/nest-cli.json`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Test: `apps/api/test/health.e2e-spec.ts`
- Test: `apps/api/test/jest-e2e.json`
- Create: `apps/api/test/utils/db.ts`

**Interfaces:**
- Produces:
  - `GET /api/health` → `200 { status: 'ok', db: 'up' }`；数据库不可达时 `503 { status: 'error', db: 'down' }`
  - `createTestApp(): Promise<INestApplication>`（在 `test/utils/db.ts`），供后续所有 e2e 测试复用
  - `resetDatabase(): Promise<void>`（清空所有表，供 e2e 的 `beforeEach` 调用）
  - 根脚本：`pnpm docker:up`、`pnpm docker:down`、`pnpm dev:api`、`pnpm test:api`

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/api/test/health.e2e-spec.ts
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp } from './utils/db'

describe('GET /api/health', () => {
  let app: INestApplication

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })

  it('数据库可达时返回 ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200)
    expect(res.body).toEqual({ status: 'ok', db: 'up' })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm docker:up && pnpm --filter @moonbud/api test:e2e -- health`
Expected: FAIL —— 无法找到模块 `./utils/db`

- [ ] **Step 3: 写 Docker Compose 与根脚本**

`docker-compose.yml`：服务 `postgres`（`postgres:16-alpine`，env `POSTGRES_USER=moonbud` `POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-moonbud_dev}` `POSTGRES_DB=moonbud`，端口 `5432:5432`，卷 `pgdata:/var/lib/postgresql/data`，healthcheck `pg_isready -U moonbud` 间隔 5s、重试 10 次）。v1 的 `api` 服务先注释掉，等 Task 2 的 Dockerfile 就位再启用（服务名 `api`，`depends_on: postgres: condition: service_healthy`，端口 `3000:3000`）。

`.env.example` 列出 `DATABASE_URL`、`JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`、`JWT_ACCESS_TTL=2h`、`JWT_REFRESH_TTL=30d`、`POSTGRES_PASSWORD`。

`.gitignore` 必须含 `.env`、`node_modules`、`dist`、`coverage`。

根 `package.json` scripts：`docker:up` = `docker compose up -d postgres`、`docker:down` = `docker compose down`、`dev:api` = `pnpm --filter @moonbud/api start:dev`、`test:api` = `pnpm --filter @moonbud/api test:e2e`。

- [ ] **Step 4: 实现最小 NestJS 应用**

`main.ts`：`app.setGlobalPrefix('api')`、`app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))`、监听 `process.env.PORT ?? 3000`。

`app.module.ts`：`ConfigModule.forRoot({ isGlobal: true })` + `HealthModule`。

`health.controller.ts` 的 `GET /api/health`：用注入的 `PrismaService` 执行 `await this.prisma.$queryRaw\`SELECT 1\``；成功返回 `{ status: 'ok', db: 'up' }`，捕获异常时用 `HttpException` 抛 `503` 返回 `{ status: 'error', db: 'down' }`。

> `PrismaService` 在 Task 2 建立；本任务的健康检查可先直接 `new PrismaClient()`，Task 2 再替换为注入。若选择依赖 Task 2，则本任务的测试在 Task 2 完成前保持红——**不要这样做**，本任务必须独立可测。

- [ ] **Step 5: 写测试工具 `apps/api/test/utils/db.ts`**

导出 `createTestApp()`：用 `Test.createTestingModule({ imports: [AppModule] })` 编译并 `init()`，返回 app。

导出 `resetDatabase()`：`TRUNCATE TABLE notifications, reminder_occurrences, reminders, family_invites, events, children, password_reset_tokens, refresh_tokens, family_members, families, users RESTART IDENTITY CASCADE`。

`test/jest-e2e.json`：`rootDir: '.'`、`testRegex: '.e2e-spec.ts$'`、`transform` 用 `ts-jest`、`setupFiles: ['dotenv/config']`、`testTimeout: 30000`。

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm --filter @moonbud/api test:e2e -- health`
Expected: PASS —— 1 个测试绿

- [ ] **Step 7: Commit**

```bash
git add .gitignore .env.example docker-compose.yml package.json apps/api
git commit -m "feat(api): scaffold NestJS app with dockerized postgres and health check"
```

---

### Task 2: Prisma schema 与完整迁移

**Files:**
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/src/prisma/prisma.service.ts`
- Create: `apps/api/src/prisma/prisma.module.ts`
- Create: `apps/api/Dockerfile`
- Create: `apps/api/.dockerignore`
- Test: `apps/api/test/schema.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`、`apps/api/src/health/health.controller.ts`、`docker-compose.yml`

**Interfaces:**
- Produces:
  - `PrismaService extends PrismaClient implements OnModuleInit`（全局模块 `PrismaModule`）
  - Prisma 模型：`User` `RefreshToken` `PasswordResetToken` `Family` `FamilyMember` `Child` `Event` `Reminder` `ReminderOccurrence` `Notification` `FamilyInvite`
  - 枚举：`FamilyRole` `Gender` `ReminderType` `ReminderStatus` `OccurrenceStatus`

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/api/test/schema.e2e-spec.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
afterAll(async () => { await prisma.$disconnect() })

describe('数据库 schema', () => {
  it('users.username 唯一', async () => {
    await prisma.user.create({ data: { username: 'schema_u1', passwordHash: 'x', nickname: 'A', timezone: 'Asia/Shanghai' } })
    await expect(
      prisma.user.create({ data: { username: 'schema_u1', passwordHash: 'y', nickname: 'B', timezone: 'Asia/Shanghai' } }),
    ).rejects.toThrow()
  })

  it('同一家庭不能重复加入同一用户', async () => {
    const u = await prisma.user.create({ data: { username: 'schema_u2', passwordHash: 'x', nickname: 'A', timezone: 'Asia/Shanghai' } })
    const f = await prisma.family.create({ data: { name: 'F', ownerId: u.id } })
    const data = { familyId: f.id, userId: u.id, role: 'OWNER' as const }
    await prisma.familyMember.create({ data })
    await expect(prisma.familyMember.create({ data })).rejects.toThrow()
  })

  it('occurrence 的 (reminder_id, due_at) 唯一 —— 幂等的基础', async () => {
    const u = await prisma.user.create({ data: { username: 'schema_u3', passwordHash: 'x', nickname: 'A', timezone: 'Asia/Shanghai' } })
    const f = await prisma.family.create({ data: { name: 'F', ownerId: u.id } })
    const r = await prisma.reminder.create({
      data: { familyId: f.id, title: 'T', type: 'ONE_TIME', dueAt: new Date('2026-11-01T00:00:00Z'), timezone: 'Asia/Shanghai', createdBy: u.id },
    })
    const dueAt = new Date('2026-11-01T00:00:00Z')
    await prisma.reminderOccurrence.create({ data: { reminderId: r.id, dueAt } })
    await expect(prisma.reminderOccurrence.create({ data: { reminderId: r.id, dueAt } })).rejects.toThrow()
  })

  it('events.payload 为 jsonb 且支持嵌套查询', async () => {
    const u = await prisma.user.create({ data: { username: 'schema_u4', passwordHash: 'x', nickname: 'A', timezone: 'Asia/Shanghai' } })
    const f = await prisma.family.create({ data: { name: 'F', ownerId: u.id } })
    const c = await prisma.child.create({ data: { familyId: f.id, name: '宝宝', birthday: new Date('2026-01-01') } })
    await prisma.event.create({
      data: {
        childId: c.id, familyId: f.id, type: 'feeding',
        occurredAt: new Date('2026-10-16T02:00:00Z'),
        payload: { method: 'bottle', amountMl: 120 },
        createdBy: u.id,
      },
    })
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM events WHERE payload->>'amountMl' = '120'
    `
    expect(Number(rows[0].n)).toBe(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/api test:e2e -- schema`
Expected: FAIL —— `@prisma/client` 未生成 / 表不存在

- [ ] **Step 3: 写 `prisma/schema.prisma`**

按 spec 第 4 节逐表建立。关键点：

- `User`：`username String @unique`、`passwordHash String`、`nickname String`、`email String? @unique`、`phone String? @unique`、`avatarUrl String?`、`timezone String`、**`mustChangePassword Boolean @default(false)`**（临时密码首次登录强制改密）、`createdAt`/`updatedAt`
- `RefreshToken`：`tokenHash String @unique`、`userId`、`expiresAt`、`revokedAt DateTime?`
- `PasswordResetToken`：`userId`、`tokenHash`、`issuedBy`、`expiresAt`、`usedAt DateTime?`
- `Event`：`payload Json`、`occurredAt`、`endedAt DateTime?`、`note String?`、`createdBy`、`updatedBy String?`、`deletedAt DateTime?`；索引 `@@index([familyId, occurredAt(sort: Desc)])`、`@@index([childId, occurredAt(sort: Desc)])`、`@@index([childId, type, occurredAt(sort: Desc)])`
- `Reminder`：`type ReminderType`、`dueAt DateTime?`、`rrule String?`、`timezone String`、`assigneeId String?`、`status ReminderStatus @default(ACTIVE)`
- `ReminderOccurrence`：`dueAt`、`firedAt DateTime?`、`status OccurrenceStatus @default(PENDING)`、`completedBy String?`、`completedAt DateTime?`、**`@@unique([reminderId, dueAt])`**
- `Notification`：`userId`、`familyId`、`occurrenceId String?`、`title`、`body`、`readAt DateTime?`；`@@index([userId, readAt, createdAt(sort: Desc)])`
- `FamilyInvite`：`code String @unique`、`role FamilyRole`、`createdBy`、`expiresAt`、`maxUses Int @default(1)`、`usedCount Int @default(0)`、`revokedAt DateTime?`
- 所有时间列 `@db.Timestamptz(3)`
- 外键删除策略：`Family` → 成员/孩子/记录用 `onDelete: Cascade`；`User` 被引用处用 `onDelete: Restrict`（**不允许删掉用户造成家庭记录悬空**）

Run: `pnpm --filter @moonbud/api exec prisma migrate dev --name init`
Expected: 迁移文件生成，`prisma generate` 成功

- [ ] **Step 4: 实现 `PrismaModule` 并替换健康检查的临时客户端**

`prisma.service.ts`：`extends PrismaClient`，`onModuleInit` 里 `await this.$connect()`；`prisma.module.ts` 用 `@Global()` 导出 `PrismaService`。

改造 `health.controller.ts` 改为注入 `PrismaService`。在 `app.module.ts` 注册 `PrismaModule`。

- [ ] **Step 5: 写 Dockerfile**

多阶段：`deps`（装依赖）→ `build`（`prisma generate` + `nest build`）→ `runner`（只拷贝 `dist`、`node_modules`、`prisma`）。入口 `sh -c "npx prisma migrate deploy && node dist/main.js"`。基础镜像 `node:24-alpine`。

启用 `docker-compose.yml` 的 `api` 服务：`build: ./apps/api`、`env_file: .env`、`environment.DATABASE_URL=postgresql://moonbud:${POSTGRES_PASSWORD:-moonbud_dev}@postgres:5432/moonbud`。

- [ ] **Step 6: 运行全部测试确认通过**

Run: `pnpm --filter @moonbud/api test:e2e`
Expected: PASS —— 健康检查 1 个 + schema 4 个

- [ ] **Step 7: 验证容器可构建并起服务**

Run: `docker compose build api && docker compose up -d && curl -s http://localhost:3000/api/health`
Expected: `{"status":"ok","db":"up"}`

- [ ] **Step 8: Commit**

```bash
git add apps/api docker-compose.yml
git commit -m "feat(api): add prisma schema, full migration, and dockerized api service"
```

---

### Task 3: 注册与登录（账号 + 密码）

**Files:**
- Create: `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/auth.service.ts`
- Create: `apps/api/src/auth/dto/register.dto.ts`
- Create: `apps/api/src/auth/dto/login.dto.ts`
- Create: `apps/api/src/auth/password.util.ts`
- Create: `apps/api/src/auth/token.service.ts`
- Test: `apps/api/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `@moonbud/shared` 的 `USERNAME_PATTERN`、`PASSWORD_MIN_LENGTH`、`AuthResponse`、`UserDto`；Task 2 的 `PrismaService`
- Produces:
  - `POST /api/auth/register { username, password, nickname, timezone, email?, phone? }` → `201 AuthResponse`
  - `POST /api/auth/login { username, password }` → `200 AuthResponse`
  - `hashPassword(plain: string): Promise<string>` / `verifyPassword(plain: string, hash: string): Promise<boolean>`
  - `TokenService.issue(userId: string): Promise<{ accessToken: string; refreshToken: string }>`
  - `TokenService.revokeAllForUser(userId: string): Promise<void>`
  - `TokenService.rotate(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }>`

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/api/test/auth.e2e-spec.ts
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'

describe('鉴权', () => {
  let app: INestApplication
  beforeAll(async () => { app = await createTestApp() })
  beforeEach(async () => { await resetDatabase() })
  afterAll(async () => { await app.close() })

  const reg = (b: Record<string, unknown>) => request(app.getHttpServer()).post('/api/auth/register').send(b)

  it('注册返回双 token 与用户信息，且不泄露密码哈希', async () => {
    const res = await reg({ username: 'mama2024', password: 'pass12345', nickname: '妈妈', timezone: 'Asia/Shanghai' }).expect(201)
    expect(res.body.accessToken).toBeTruthy()
    expect(res.body.refreshToken).toBeTruthy()
    expect(res.body.user.username).toBe('mama2024')
    expect(res.body.user).not.toHaveProperty('passwordHash')
    expect(JSON.stringify(res.body)).not.toContain('$2b$')
  })

  it('账号大小写不同视为同一个账号（查重不区分大小写）', async () => {
    await reg({ username: 'mama2024', password: 'pass12345', nickname: '妈妈', timezone: 'Asia/Shanghai' }).expect(201)
    await reg({ username: 'MAMA2024', password: 'pass12345', nickname: '妈妈', timezone: 'Asia/Shanghai' }).expect(409)
  })

  it('拒绝不合规账号与过短密码', async () => {
    await reg({ username: 'ab', password: 'pass12345', nickname: 'X', timezone: 'Asia/Shanghai' }).expect(400)
    await reg({ username: '妈妈2024', password: 'pass12345', nickname: 'X', timezone: 'Asia/Shanghai' }).expect(400)
    await reg({ username: 'okname', password: 'short', nickname: 'X', timezone: 'Asia/Shanghai' }).expect(400)
  })

  it('拒绝非法时区', async () => {
    await reg({ username: 'okname', password: 'pass12345', nickname: 'X', timezone: 'Not/AZone' }).expect(400)
  })

  it('登录成功；密码错误返回 401 且不区分"账号不存在"与"密码错误"', async () => {
    await reg({ username: 'mama2024', password: 'pass12345', nickname: '妈妈', timezone: 'Asia/Shanghai' }).expect(201)
    await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'mama2024', password: 'pass12345' }).expect(200)
    const wrongPw = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'mama2024', password: 'nope12345' }).expect(401)
    const noUser = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'ghost2024', password: 'nope12345' }).expect(401)
    expect(wrongPw.body.message).toBe(noUser.body.message)
  })

  it('登录不区分账号大小写', async () => {
    await reg({ username: 'mama2024', password: 'pass12345', nickname: '妈妈', timezone: 'Asia/Shanghai' }).expect(201)
    await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'MaMa2024', password: 'pass12345' }).expect(200)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/api test:e2e -- auth`
Expected: FAIL —— 404，路由不存在

- [ ] **Step 3: 实现 DTO 与密码工具**

`register.dto.ts` 用 `class-validator`：`@Matches(USERNAME_PATTERN, { message: '账号需为 4–20 位字母、数字或下划线' })`、`@MinLength(PASSWORD_MIN_LENGTH)`、`@IsNotEmpty() nickname`、`@IsTimeZone() timezone`（**自定义校验器：`Intl.DateTimeFormat(undefined, { timeZone })` 不抛错即合法，用 `@moonbud/shared` 的 `isSupportedTimezone`**）、`email`/`phone` 可选。

`password.util.ts`：`hashPassword` = `bcrypt.hash(plain, 10)`；`verifyPassword` = `bcrypt.compare`。

- [ ] **Step 4: 实现 `AuthService`**

关键点：

- **账号一律 lower-case 后存储与查询**（用单独的 `usernameNormalized`？不——v1 直接把 `username` 存为小写，响应里就返回小写，避免两列不一致）。注册时 `username.toLowerCase()`，登录时同样处理，这样大小写不敏感是天然的。
- 注册冲突：先 `findUnique`，存在则抛 `ConflictException('该账号已被使用')`；同时捕获 Prisma `P2002` 兜底（并发注册）。
- 登录失败：**无论账号不存在还是密码错误，都抛同一个 `UnauthorizedException('账号或密码不正确')`**；账号不存在时也要做一次 `bcrypt.compare` 对固定假哈希，避免用响应时间区分账号是否存在。
- 响应经 `toUserDto(user)` 映射，**只挑白名单字段**，绝不 `...user` 展开。

- [ ] **Step 5: 实现 `TokenService`**

- `issue`：access 用 `JwtService.signAsync({ sub: userId }, { secret: JWT_ACCESS_SECRET, expiresIn: JWT_ACCESS_TTL })`；refresh 用 `randomUUID()` 生成原始串，**只把 `bcrypt` 哈希存进 `refresh_tokens.tokenHash`**，原始串只回给客户端（这样库泄露也拿不到可用 token）。
- `rotate`：查 `tokenHash` 未撤销且未过期 → 撤销旧的 → 签发新的（**旋转，不是续期同一个**）。
- `revokeAllForUser`：把该用户所有未撤销的 refresh token 置 `revokedAt`。

- [ ] **Step 6: 实现 Controller 与模块**

`AuthController` 挂 `@Controller('auth')`，两个 `@Post`。`AuthModule` 导入 `JwtModule.register({})`（密钥在调用时传，不全局固定）、`PrismaModule`。

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm --filter @moonbud/api test:e2e -- auth`
Expected: PASS —— 6 个测试绿

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/auth apps/api/test/auth.e2e-spec.ts
git commit -m "feat(api): add username/password registration and login"
```

---

### Task 4: JWT 守卫、`/me`、刷新与登出

**Files:**
- Create: `apps/api/src/auth/jwt-auth.guard.ts`
- Create: `apps/api/src/auth/current-user.decorator.ts`
- Create: `apps/api/src/auth/public.decorator.ts`
- Create: `apps/api/src/auth/me.controller.ts`
- Create: `apps/api/src/auth/dto/refresh.dto.ts`
- Test: `apps/api/test/session.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`（全局守卫）、`apps/api/src/auth/auth.controller.ts`（refresh/logout）

**Interfaces:**
- Consumes: Task 3 的 `TokenService`、`PrismaService`
- Produces:
  - `@Public()` 装饰器：标记免鉴权路由
  - `@CurrentUser() user: { id: string; username: string }` 参数装饰器
  - `JwtAuthGuard` 作为全局 `APP_GUARD`，默认**所有路由都要登录**
  - `POST /api/auth/refresh { refreshToken }` → `200 { accessToken, refreshToken }`
  - `POST /api/auth/logout` → `204`（撤销当前用户的 refresh token）
  - `GET /api/me` → `200 { user: UserDto, families: FamilyDto[] }`

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/api/test/session.e2e-spec.ts
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'

describe('会话', () => {
  let app: INestApplication
  let tokens: { accessToken: string; refreshToken: string }
  beforeAll(async () => { app = await createTestApp() })
  beforeEach(async () => {
    await resetDatabase()
    const res = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ username: 'papa2024', password: 'pass12345', nickname: '爸爸', timezone: 'Asia/Shanghai' }).expect(201)
    tokens = { accessToken: res.body.accessToken, refreshToken: res.body.refreshToken }
  })
  afterAll(async () => { await app.close() })

  it('无 token 访问 /api/me 返回 401', async () => {
    await request(app.getHttpServer()).get('/api/me').expect(401)
  })

  it('带 access token 可访问 /api/me 并返回家庭列表', async () => {
    const res = await request(app.getHttpServer()).get('/api/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`).expect(200)
    expect(res.body.user.username).toBe('papa2024')
    expect(res.body.families).toEqual([])
  })

  it('篡改的 token 返回 401', async () => {
    await request(app.getHttpServer()).get('/api/me')
      .set('Authorization', `Bearer ${tokens.accessToken}tampered`).expect(401)
  })

  it('refresh 换新 token，且旧 refresh 立即失效（旋转）', async () => {
    const r1 = await request(app.getHttpServer()).post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken }).expect(200)
    expect(r1.body.accessToken).toBeTruthy()
    await request(app.getHttpServer()).post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken }).expect(401)
  })

  it('登出后 refresh 失效', async () => {
    await request(app.getHttpServer()).post('/api/auth/logout')
      .set('Authorization', `Bearer ${tokens.accessToken}`).expect(204)
    await request(app.getHttpServer()).post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken }).expect(401)
  })

  it('公开路由无需 token', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/api test:e2e -- session`
Expected: FAIL —— `/api/me` 返回 404（路由未实现）

- [ ] **Step 3: 实现守卫与装饰器**

`JwtAuthGuard extends AuthGuard('jwt')`：读 `Reflector` 上的 `IS_PUBLIC_KEY`，是公开路由则放行。在 `app.module.ts` 用 `{ provide: APP_GUARD, useClass: JwtAuthGuard }` 全局注册——**这样新加的路由默认受保护，忘记加守卫不会造成漏洞**。

`public.decorator.ts` 导出 `IS_PUBLIC_KEY` 与 `Public()`。`current-user.decorator.ts` 从 `request.user` 取。

JWT 策略（`passport-jwt`）从 `Authorization: Bearer` 提取，校验用 `JWT_ACCESS_SECRET`，`validate` 返回 `{ id: payload.sub, username: payload.username }`。

`/api/auth/register`、`/api/auth/login`、`/api/auth/refresh`、`/api/health` 加 `@Public()`。

- [ ] **Step 4: 实现 `/me`、refresh、logout**

`me.controller.ts`：`GET /api/me` 用 `@CurrentUser()` 取 id，查用户 + 其所有 `familyMembers`（含 family），映射成 `{ user, families }`。`families[].role` 是该用户在该家庭的角色。

`auth.controller.ts` 补 `refresh`（`@Public()`，调 `TokenService.rotate`）与 `logout`（`@HttpCode(204)`，调 `revokeAllForUser`）。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @moonbud/api test:e2e`
Expected: PASS —— 全部（health 1 + schema 4 + auth 6 + session 6）

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/api/test/session.e2e-spec.ts
git commit -m "feat(api): add global jwt guard, /me, refresh rotation, and logout"
```

---

### Task 5: 家庭模块与 RBAC 守卫（越权防线）

**Files:**
- Create: `apps/api/src/families/families.module.ts`
- Create: `apps/api/src/families/families.controller.ts`
- Create: `apps/api/src/families/families.service.ts`
- Create: `apps/api/src/families/family-member.guard.ts`
- Create: `apps/api/src/families/roles.decorator.ts`
- Create: `apps/api/src/families/dto/create-family.dto.ts`
- Create: `apps/api/src/families/dto/update-family.dto.ts`
- Test: `apps/api/test/families.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: Task 4 的 `@CurrentUser()`、`JwtAuthGuard`
- Produces:
  - `@RequireFamilyRole(...roles: FamilyRole[])` 装饰器 + `FamilyMemberGuard`
  - `FamilyMemberGuard` 把成员记录挂到 `request.familyMember = { id, familyId, userId, role, displayName }`
  - `POST /api/families { name }` → `201 FamilyDto`（创建者成为 OWNER 且写入 `family_members`）
  - `GET /api/families` → `200 FamilyDto[]`（当前用户所属的未归档家庭）
  - `GET /api/families/:familyId` → `200 FamilyDto & { members: MemberDto[] }`
  - `PATCH /api/families/:familyId { name }` → `200 FamilyDto`（ADMIN+）
  - `POST /api/families/:familyId/archive` → `200`（仅 OWNER）
  - `POST /api/families/:familyId/transfer { toUserId }` → `200`（仅 OWNER）
  - `POST /api/families/:familyId/leave` → `204`
  - `interface MemberDto { id: string; userId: string; role: FamilyRole; displayName: string | null; joinedAt: string; nickname: string; username: string }`

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/api/test/families.e2e-spec.ts
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'

describe('家庭与权限', () => {
  let app: INestApplication
  let a: { token: string; id: string; familyId: string }
  let b: { token: string; id: string }

  const register = async (username: string) => {
    const res = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ username, password: 'pass12345', nickname: username, timezone: 'Asia/Shanghai' }).expect(201)
    return { token: res.body.accessToken as string, id: res.body.user.id as string }
  }

  beforeAll(async () => { app = await createTestApp() })
  beforeEach(async () => {
    await resetDatabase()
    const ua = await register('user_a1')
    const ub = await register('user_b1')
    const f = await request(app.getHttpServer()).post('/api/families')
      .set('Authorization', `Bearer ${ua.token}`).send({ name: '我们家' }).expect(201)
    a = { ...ua, familyId: f.body.id }
    b = ub
  })
  afterAll(async () => { await app.close() })

  it('创建家庭时创建者自动成为 OWNER', async () => {
    const res = await request(app.getHttpServer()).get(`/api/families/${a.familyId}`)
      .set('Authorization', `Bearer ${a.token}`).expect(200)
    expect(res.body.role).toBe('OWNER')
    expect(res.body.members).toHaveLength(1)
    expect(res.body.members[0].role).toBe('OWNER')
  })

  it('非成员读取别家数据返回 403，且响应体不含家庭名', async () => {
    const res = await request(app.getHttpServer()).get(`/api/families/${a.familyId}`)
      .set('Authorization', `Bearer ${b.token}`).expect(403)
    expect(JSON.stringify(res.body)).not.toContain('我们家')
  })

  it('非成员改别家数据返回 403', async () => {
    await request(app.getHttpServer()).patch(`/api/families/${a.familyId}`)
      .set('Authorization', `Bearer ${b.token}`).send({ name: '被改了' }).expect(403)
  })

  it('不存在的 familyId 返回 403 而非 404，避免探测家庭是否存在', async () => {
    await request(app.getHttpServer()).get('/api/families/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${b.token}`).expect(403)
  })

  it('GET /api/families 只返回自己所属的家庭', async () => {
    const mine = await request(app.getHttpServer()).get('/api/families')
      .set('Authorization', `Bearer ${a.token}`).expect(200)
    expect(mine.body.map((f: { id: string }) => f.id)).toEqual([a.familyId])
    const others = await request(app.getHttpServer()).get('/api/families')
      .set('Authorization', `Bearer ${b.token}`).expect(200)
    expect(others.body).toEqual([])
  })

  it('归档家庭后成员读写均被拒绝，且不再出现在家庭列表', async () => {
    await request(app.getHttpServer()).post(`/api/families/${a.familyId}/archive`)
      .set('Authorization', `Bearer ${a.token}`).expect(200)
    await request(app.getHttpServer()).get(`/api/families/${a.familyId}`)
      .set('Authorization', `Bearer ${a.token}`).expect(403)
    const list = await request(app.getHttpServer()).get('/api/families')
      .set('Authorization', `Bearer ${a.token}`).expect(200)
    expect(list.body).toEqual([])
  })

  it('转让后原 OWNER 降为 ADMIN，新 OWNER 生效', async () => {
    await request(app.getHttpServer()).post(`/api/families/${a.familyId}/transfer`)
      .set('Authorization', `Bearer ${a.token}`).send({ toUserId: b.id }).expect(400) // b 不是成员
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/api test:e2e -- families`
Expected: FAIL —— 404

- [ ] **Step 3: 实现 `FamilyMemberGuard`**

这是整个后端的权限唯一实现处。逻辑：

1. 从 `request.params.familyId` 取家庭 id；缺失则放行（非家庭作用域路由由 `JwtAuthGuard` 负责）。
2. `@RequireFamilyRole()` 未标注时，默认要求**至少是 MEMBER**（即必须是成员）。若明确标注则取标注的角色集合。
3. 查 `familyMember.findUnique({ where: { familyId_userId: { familyId, userId } }, include: { family: true } })`。
4. **成员不存在 → 抛 `ForbiddenException`（403，不是 404）**——这样攻击者无法通过 404/403 的差异探测家庭是否存在。
5. **`family.archivedAt` 非空 → 同样 403**（第 5 条 Review Focus 的硬边界）。
6. 角色不在允许集合 → 403。
7. 命中则把成员记录挂到 `request.familyMember` 并放行。

- [ ] **Step 4: 实现 `FamiliesService` 与 Controller**

`create(name, userId)`：用 `prisma.$transaction` 一次创建 `family` + `family_members(role=OWNER)`，避免出现无 OWNER 的家庭。

`transfer(familyId, fromUserId, toUserId)`：目标必须是**本家庭成员**（否则 400）；事务内把目标升为 OWNER、自己降为 ADMIN。

`archive(familyId)`：置 `archivedAt`（仅 OWNER）。**不删除任何数据。**

`leave(familyId, userId)`：见 Task 6 的"最后一名 OWNER"约束——本任务先实现基础删除，Task 6 补强并加测试。

`listForUser(userId)`：`familyMember.findMany({ where: { userId, family: { archivedAt: null } } })`。

所有 Controller 方法用 `@UseGuards(FamilyMemberGuard)` + `@RequireFamilyRole(...)`。`GET /:familyId` 不加角色标注（任何成员可读）。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @moonbud/api test:e2e -- families`
Expected: PASS —— 7 个测试绿

- [ ] **Step 6: 补一条跨模块越权回归测试**

在 `apps/api/test/families.e2e-spec.ts` 追加：用户 B 对 A 的家庭调用**每个**已存在的家庭作用域端点（GET/PATCH/archive/transfer/leave）都应 403。用一个 `it.each` 列表驱动，防止将来新增端点时漏加守卫。

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/families apps/api/src/app.module.ts apps/api/test/families.e2e-spec.ts
git commit -m "feat(api): add families module with centralized family RBAC guard"
```

---

### Task 6: 成员管理、最后 OWNER 不变量、退出家庭

**Files:**
- Create: `apps/api/src/families/members.service.ts`
- Create: `apps/api/src/families/members.controller.ts`
- Create: `apps/api/src/families/dto/update-member.dto.ts`
- Test: `apps/api/test/members.e2e-spec.ts`
- Modify: `apps/api/src/families/families.module.ts`

**Interfaces:**
- Consumes: Task 5 的 `FamilyMemberGuard`、`@RequireFamilyRole`；Task 5 的 `leave`
- Produces:
  - `GET /api/families/:familyId/members` → `200 MemberDto[]`
  - `PATCH /api/families/:familyId/members/:memberId { role?, displayName? }` → `200 MemberDto`（仅 OWNER/ADMIN）
  - `DELETE /api/families/:familyId/members/:memberId` → `204`（仅 OWNER/ADMIN）
  - `POST /api/families/:familyId/members/:memberId/reset-password` → `200 { temporaryPassword: string }`（仅 OWNER/ADMIN）
  - `assertFamilyHasOwner(tx, familyId): Promise<void>`（内部）

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/api/test/members.e2e-spec.ts
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'

describe('成员管理', () => {
  let app: INestApplication
  let owner: { token: string; id: string }
  let member: { token: string; id: string }
  let familyId: string
  let memberRowId: string

  const register = async (username: string) => {
    const res = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ username, password: 'pass12345', nickname: username, timezone: 'Asia/Shanghai' }).expect(201)
    return { token: res.body.accessToken as string, id: res.body.user.id as string }
  }
  const addMember = async (userId: string, role = 'MEMBER') => {
    const inv = await request(app.getHttpServer()).post(`/api/families/${familyId}/invites`)
      .set('Authorization', `Bearer ${owner.token}`).send({ role }).expect(201)
    await request(app.getHttpServer()).post(`/api/invites/${inv.body.code}/accept`)
      .set('Authorization', `Bearer ${member.token}`).expect(201)
  }

  beforeAll(async () => { app = await createTestApp() })
  beforeEach(async () => {
    await resetDatabase()
    owner = await register('owner_u1')
    member = await register('mem_u1')
    const f = await request(app.getHttpServer()).post('/api/families')
      .set('Authorization', `Bearer ${owner.token}`).send({ name: 'F' }).expect(201)
    familyId = f.body.id
  })
  afterAll(async () => { await app.close() })

  it('最后一名 OWNER 不能退出家庭', async () => {
    const res = await request(app.getHttpServer()).post(`/api/families/${familyId}/leave`)
      .set('Authorization', `Bearer ${owner.token}`).expect(400)
    expect(JSON.stringify(res.body)).toMatch(/OWNER|所有者|转让/)
  })

  it('最后一名 OWNER 不能被移除', async () => {
    const list = await request(app.getHttpServer()).get(`/api/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`).expect(200)
    const ownerRow = list.body.find((m: { role: string }) => m.role === 'OWNER')
    await request(app.getHttpServer()).delete(`/api/families/${familyId}/members/${ownerRow.id}`)
      .set('Authorization', `Bearer ${owner.token}`).expect(400)
  })

  it('有两名 OWNER 时其中一人可以退出', async () => {
    await request(app.getHttpServer()).post(`/api/families/${familyId}/transfer`)
      .set('Authorization', `Bearer ${owner.token}`) // 目标需先是成员
      .send({ toUserId: member.id }).expect(400)
  })

  it('MEMBER 不能移除他人也不能改角色', async () => {
    await request(app.getHttpServer()).post(`/api/families/${familyId}/invites`)
      .set('Authorization', `Bearer ${owner.token}`).send({ role: 'MEMBER' }).expect(201)
  })
})
```

> **实现注记：** 上面测试里的 "有两名 OWNER" 与 "MEMBER 不能移除他人" 两条需要在 `beforeEach` 里把 `member` 真正加入家庭。补齐 `addMember` 的调用（当前 `addMember` 已定义但未使用），把断言写成真实的成员操作。这两条是 Task 6 的核心验收点，**不允许留成占位断言**。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/api test:e2e -- members`
Expected: FAIL —— 404

- [ ] **Step 3: 实现 `assertFamilyHasOwner`**

在事务内 `count({ where: { familyId, role: 'OWNER' } })`，若为 0 抛 `BadRequestException('家庭必须至少保留一名所有者，请先转让所有权')`。**在移除成员、降级 OWNER、退出家庭三处都要调用。**

- [ ] **Step 4: 实现成员服务与控制器**

- `updateRole`：不允许把 OWNER 降级到 ADMIN 若那是最后一名 OWNER。ADMIN 不能操作 OWNER（`ForbiddenException`）。
- `remove`：ADMIN 不能移除 OWNER；调用 `assertFamilyHasOwner`。
- `resetPassword`（成员为他人重置）：生成 12 位随机临时密码 → `users.passwordHash = hash(temp)` 且 `mustChangePassword = true` → 写 `password_reset_tokens`（`tokenHash` 存临时密码哈希、`issuedBy` 为操作者、`expiresAt` = +24h）→ **响应里返回临时密码明文（唯一一次）**。**禁止对自己调用**（应走 `change-password`），否则等于绕过旧密码校验：`if (targetUserId === actorId) throw new BadRequestException('请使用"修改密码"功能')`。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @moonbud/api test:e2e -- members`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/families apps/api/test/members.e2e-spec.ts
git commit -m "feat(api): add member management with last-owner invariant"
```

---

### Task 7: 修改密码、忘记密码请求、邀请码

**Files:**
- Create: `apps/api/src/auth/dto/change-password.dto.ts`
- Create: `apps/api/src/auth/reset-request.service.ts`
- Create: `apps/api/src/invites/invites.module.ts`
- Create: `apps/api/src/invites/invites.service.ts`
- Create: `apps/api/src/invites/invites.controller.ts`
- Create: `apps/api/src/invites/invite-code.util.ts`
- Test: `apps/api/test/passwords.e2e-spec.ts`
- Test: `apps/api/test/invites.e2e-spec.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`、`apps/api/src/auth/auth.service.ts`

**Interfaces:**
- Consumes: Task 3/6 的 token 与密码工具
- Produces:
  - `POST /api/auth/change-password { oldPassword, newPassword }` → `200 { accessToken, refreshToken }`（**撤销该用户全部旧 refresh token**）
  - `POST /api/auth/reset-request { username }` → `202`（**无论账号是否存在都返回 202**，防账号枚举；v1 只落库不自动处理）
  - `POST /api/families/:familyId/invites { role: 'ADMIN'|'MEMBER', expiresInHours?, maxUses? }` → `201 { code, expiresAt }`（ADMIN+）
  - `GET /api/families/:familyId/invites` → `200 InviteDto[]`
  - `DELETE /api/families/:familyId/invites/:inviteId` → `204`（ADMIN+，置 `revokedAt`）
  - `POST /api/invites/:code/accept` → `201 FamilyDto`（需登录）
  - `generateInviteCode(): string` —— 8 位大写字母+数字，**排除易混字符 `O0I1L`**
  - `interface InviteDto { id: string; code: string; role: FamilyRole; expiresAt: string; maxUses: number; usedCount: number; revokedAt: string | null }`

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/api/test/passwords.e2e-spec.ts
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'

describe('密码', () => {
  let app: INestApplication
  beforeAll(async () => { app = await createTestApp() })
  beforeEach(async () => { await resetDatabase() })
  afterAll(async () => { await app.close() })

  it('修改密码成功后旧 refresh token 失效，新 token 可用', async () => {
    const reg = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ username: 'pw_u1', password: 'pass12345', nickname: 'A', timezone: 'Asia/Shanghai' }).expect(201)
    const changed = await request(app.getHttpServer()).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ oldPassword: 'pass12345', newPassword: 'newpass12345' }).expect(200)
    expect(changed.body.accessToken).toBeTruthy()
    await request(app.getHttpServer()).post('/api/auth/refresh')
      .send({ refreshToken: reg.body.refreshToken }).expect(401)
    await request(app.getHttpServer()).post('/api/auth/login')
      .send({ username: 'pw_u1', password: 'newpass12345' }).expect(200)
  })

  it('旧密码错误时拒绝修改，且原密码仍然有效', async () => {
    const reg = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ username: 'pw_u2', password: 'pass12345', nickname: 'A', timezone: 'Asia/Shanghai' }).expect(201)
    await request(app.getHttpServer()).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ oldPassword: 'wrongpass1', newPassword: 'newpass12345' }).expect(401)
    await request(app.getHttpServer()).post('/api/auth/login')
      .send({ username: 'pw_u2', password: 'pass12345' }).expect(200)
  })

  it('新密码过短被拒绝', async () => {
    const reg = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ username: 'pw_u3', password: 'pass12345', nickname: 'A', timezone: 'Asia/Shanghai' }).expect(201)
    await request(app.getHttpServer()).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ oldPassword: 'pass12345', newPassword: 'short' }).expect(400)
  })

  it('reset-request 对存在与不存在的账号返回相同状态码', async () => {
    await request(app.getHttpServer()).post('/api/auth/register')
      .send({ username: 'pw_u4', password: 'pass12345', nickname: 'A', timezone: 'Asia/Shanghai' }).expect(201)
    const known = await request(app.getHttpServer()).post('/api/auth/reset-request').send({ username: 'pw_u4' }).expect(202)
    const unknown = await request(app.getHttpServer()).post('/api/auth/reset-request').send({ username: 'ghost999' }).expect(202)
    expect(known.body).toEqual(unknown.body)
  })
})
```

```typescript
// apps/api/test/invites.e2e-spec.ts
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'

describe('邀请码', () => {
  let app: INestApplication
  let owner: { token: string; id: string }
  let joiner: { token: string; id: string }
  let familyId: string

  const register = async (username: string) => {
    const res = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ username, password: 'pass12345', nickname: username, timezone: 'Asia/Shanghai' }).expect(201)
    return { token: res.body.accessToken as string, id: res.body.user.id as string }
  }
  const createInvite = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/api/families/${familyId}/invites`)
      .set('Authorization', `Bearer ${owner.token}`).send(body)

  beforeAll(async () => { app = await createTestApp() })
  beforeEach(async () => {
    await resetDatabase()
    owner = await register('inv_owner')
    joiner = await register('inv_join1')
    const f = await request(app.getHttpServer()).post('/api/families')
      .set('Authorization', `Bearer ${owner.token}`).send({ name: 'F' }).expect(201)
    familyId = f.body.id
  })
  afterAll(async () => { await app.close() })

  it('生成的邀请码为 8 位且不含易混字符', async () => {
    const res = await createInvite({ role: 'MEMBER' }).expect(201)
    expect(res.body.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/)
  })

  it('不能生成 OWNER 角色的邀请码', async () => {
    await createInvite({ role: 'OWNER' }).expect(400)
  })

  it('接受邀请后成为成员，家庭出现在自己的列表里', async () => {
    const inv = await createInvite({ role: 'MEMBER' }).expect(201)
    await request(app.getHttpServer()).post(`/api/invites/${inv.body.code}/accept`)
      .set('Authorization', `Bearer ${joiner.token}`).expect(201)
    const list = await request(app.getHttpServer()).get('/api/families')
      .set('Authorization', `Bearer ${joiner.token}`).expect(200)
    expect(list.body.map((f: { id: string }) => f.id)).toEqual([familyId])
  })

  it('已加入的人重复接受不会重复插入（幂等）', async () => {
    const inv = await createInvite({ role: 'MEMBER', maxUses: 5 }).expect(201)
    await request(app.getHttpServer()).post(`/api/invites/${inv.body.code}/accept`)
      .set('Authorization', `Bearer ${joiner.token}`).expect(201)
    await request(app.getHttpServer()).post(`/api/invites/${inv.body.code}/accept`)
      .set('Authorization', `Bearer ${joiner.token}`).expect(201)
    const detail = await request(app.getHttpServer()).get(`/api/families/${familyId}`)
      .set('Authorization', `Bearer ${owner.token}`).expect(200)
    expect(detail.body.members).toHaveLength(2)
  })

  it('超过使用次数上限后拒绝', async () => {
    const inv = await createInvite({ role: 'MEMBER', maxUses: 0 }).expect(201)
    await request(app.getHttpServer()).post(`/api/invites/${inv.body.code}/accept`)
      .set('Authorization', `Bearer ${joiner.token}`).expect(400)
  })

  it('撤销后的邀请码不可用', async () => {
    const inv = await createInvite({ role: 'MEMBER' }).expect(201)
    await request(app.getHttpServer()).delete(`/api/families/${familyId}/invites/${inv.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`).expect(204)
    await request(app.getHttpServer()).post(`/api/invites/${inv.body.code}/accept`)
      .set('Authorization', `Bearer ${joiner.token}`).expect(400)
  })

  it('不存在的邀请码返回 400，不泄露家庭信息', async () => {
    const res = await request(app.getHttpServer()).post('/api/invites/NOTEXIST/accept')
      .set('Authorization', `Bearer ${joiner.token}`).expect(400)
    expect(JSON.stringify(res.body)).not.toContain('F')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/api test:e2e -- passwords` 与 `-- invites`
Expected: FAIL —— 404

- [ ] **Step 3: 实现 change-password 与 reset-request**

`change-password`：校验旧密码（错则 `UnauthorizedException`）→ 新密码按 `PASSWORD_MIN_LENGTH` 校验 → 更新 `passwordHash` 且 `mustChangePassword = false` → `TokenService.revokeAllForUser(userId)` → 重新 `issue` 并返回。**必须在同一个事务/顺序里先撤销再签发**，否则新 token 会被自己的撤销干掉。

`reset-request`：**恒定返回 202 与固定文案**（如 `{ message: '如果该账号存在，我们已记录你的请求，请联系家庭管理员重置密码' }`）。账号存在时往 `password_reset_tokens` 写一条 `tokenHash: 'REQUEST'` 的标记记录或单独的日志表——**不要把请求是否命中泄露给调用方，也不要在响应时间上区分**（账号存在时也要走一遍等价的哈希运算）。

- [ ] **Step 4: 实现邀请码模块**

`generateInviteCode()`：从 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`（31 个字符，**去掉 `O` `0` `I` `1` `L`**）随机取 8 位；插入冲突时重试最多 5 次。

`accept(code, userId)`：事务内 `findUnique({ where: { code } })` → 校验存在/未撤销/未过期/`usedCount < maxUses` → **若已是成员则直接返回家庭（幂等，不增计数）** → 否则建 `family_members`（`role` 取邀请上的 role）→ `usedCount++`。任何失败一律 `BadRequestException`，**文案不含家庭名**。

`create` 的 DTO 用 `@IsIn(['ADMIN', 'MEMBER'])`，**从类型层面就拒绝 OWNER**。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @moonbud/api test:e2e`
Expected: PASS —— 全部

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/api/test/passwords.e2e-spec.ts apps/api/test/invites.e2e-spec.ts
git commit -m "feat(api): add change-password, reset requests, and family invites"
```

---

### Task 8: 孩子与记录（JSONB 校验、软删除、区间校验）

**Files:**
- Create: `apps/api/src/children/children.module.ts`
- Create: `apps/api/src/children/children.controller.ts`
- Create: `apps/api/src/children/children.service.ts`
- Create: `apps/api/src/events/events.module.ts`
- Create: `apps/api/src/events/events.controller.ts`
- Create: `apps/api/src/events/events.service.ts`
- Create: `apps/api/src/events/dto/create-event.dto.ts`
- Create: `apps/api/src/events/dto/update-event.dto.ts`
- Create: `apps/api/src/events/dto/query-events.dto.ts`
- Test: `apps/api/test/events.e2e-spec.ts`
- Test: `apps/api/test/children.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `@moonbud/shared` 的 `EVENT_TYPES`、`validateEventPayload`、`validateNote`、`NOTE_MAX_LENGTH`、`EventType`；Task 5 的守卫
- Produces:
  - `GET|POST /api/families/:familyId/children`、`PATCH|DELETE /api/families/:familyId/children/:childId`（DELETE 为软删除，置 `archivedAt`）
  - `GET /api/families/:familyId/events?childId=&type=&from=&to=&until=&page=&pageSize=` → `200 Paginated<EventDto>`
  - `POST /api/families/:familyId/events` → `201 EventDto`
  - `PATCH|DELETE /api/families/:familyId/events/:eventId`（仅创建者本人或 ADMIN/OWNER）
  - `EventsService.findLatestByType(childId: string, type: EventType, until: Date): Promise<EventDto | null>`（供 Task 13 的防重复提示复用）

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/api/test/events.e2e-spec.ts
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'

describe('记录', () => {
  let app: INestApplication
  let me: { token: string; id: string }
  let other: { token: string; id: string }
  let familyId: string
  let childId: string

  const register = async (username: string) => {
    const res = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ username, password: 'pass12345', nickname: username, timezone: 'Asia/Shanghai' }).expect(201)
    return { token: res.body.accessToken as string, id: res.body.user.id as string }
  }
  const post = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/api/families/${familyId}/events`)
      .set('Authorization', `Bearer ${me.token}`).send(body)

  beforeAll(async () => { app = await createTestApp() })
  beforeEach(async () => {
    await resetDatabase()
    me = await register('ev_me1')
    other = await register('ev_other1')
    const f = await request(app.getHttpServer()).post('/api/families')
      .set('Authorization', `Bearer ${me.token}`).send({ name: 'F' }).expect(201)
    familyId = f.body.id
    const c = await request(app.getHttpServer()).post(`/api/families/${familyId}/children`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ name: '宝宝', gender: 'UNKNOWN', birthday: '2026-01-01' }).expect(201)
    childId = c.body.id
  })
  afterAll(async () => { await app.close() })

  it('创建喂奶记录并读回，payload 原样保存', async () => {
    const res = await post({
      childId, type: 'feeding', occurredAt: '2026-10-16T02:00:00.000Z',
      payload: { method: 'bottle', amountMl: 120 }, note: '喝得很快',
    }).expect(201)
    expect(res.body.payload).toEqual({ method: 'bottle', amountMl: 120 })
    expect(res.body.createdBy).toBe(me.id)
  })

  it('拒绝 payload 多带未知字段', async () => {
    await post({ childId, type: 'feeding', occurredAt: '2026-10-16T02:00:00.000Z', payload: { method: 'bottle', bogus: 1 } }).expect(400)
  })

  it('拒绝华氏度体温', async () => {
    await post({ childId, type: 'temperature', occurredAt: '2026-10-16T02:00:00.000Z', payload: { celsius: 98.6 } }).expect(400)
    await post({ childId, type: 'temperature', occurredAt: '2026-10-16T02:00:00.000Z', payload: { celsius: 37.2 } }).expect(201)
  })

  it('拒绝 endedAt 早于 occurredAt 的睡眠记录', async () => {
    const res = await post({
      childId, type: 'sleep',
      occurredAt: '2026-10-16T05:00:00.000Z', endedAt: '2026-10-16T04:00:00.000Z', payload: {},
    }).expect(400)
    expect(JSON.stringify(res.body)).toMatch(/endedAt|结束/)
  })

  it('接受 endedAt 晚于 occurredAt 的睡眠记录', async () => {
    await post({
      childId, type: 'sleep',
      occurredAt: '2026-10-16T04:00:00.000Z', endedAt: '2026-10-16T05:00:00.000Z', payload: { quality: 'good' },
    }).expect(201)
  })

  it('拒绝超过 500 字的备注', async () => {
    await post({
      childId, type: 'feeding', occurredAt: '2026-10-16T02:00:00.000Z',
      payload: { method: 'breast' }, note: 'x'.repeat(501),
    }).expect(400)
  })

  it('拒绝未知记录类型', async () => {
    await post({ childId, type: 'nonsense', occurredAt: '2026-10-16T02:00:00.000Z', payload: {} }).expect(400)
  })

  it('拒绝别的家庭的 childId', async () => {
    // other 建自己的家庭与孩子，me 试图写入
    const f2 = await request(app.getHttpServer()).post('/api/families')
      .set('Authorization', `Bearer ${other.token}`).send({ name: 'F2' }).expect(201)
    const c2 = await request(app.getHttpServer()).post(`/api/families/${f2.body.id}/children`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ name: '别家孩子', gender: 'UNKNOWN', birthday: '2026-01-01' }).expect(201)
    await post({ childId: c2.body.id, type: 'feeding', occurredAt: '2026-10-16T02:00:00.000Z', payload: { method: 'breast' } }).expect(400)
  })

  it('软删除后不出现在列表，但数据库里仍在', async () => {
    const created = await post({ childId, type: 'feeding', occurredAt: '2026-10-16T02:00:00.000Z', payload: { method: 'breast' } }).expect(201)
    await request(app.getHttpServer()).delete(`/api/families/${familyId}/events/${created.body.id}`)
      .set('Authorization', `Bearer ${me.token}`).expect(204)
    const list = await request(app.getHttpServer()).get(`/api/families/${familyId}/events?childId=${childId}`)
      .set('Authorization', `Bearer ${me.token}`).expect(200)
    expect(list.body.total).toBe(0)
  })

  it('未参与家庭的人不能读取记录', async () => {
    await post({ childId, type: 'feeding', occurredAt: '2026-10-16T02:00:00.000Z', payload: { method: 'breast' } }).expect(201)
    await request(app.getHttpServer()).get(`/api/families/${familyId}/events?childId=${childId}`)
      .set('Authorization', `Bearer ${other.token}`).expect(403)
  })

  it('until 参数排除未来时间，findLatestByType 不会返回未来记录', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString()
    await post({ childId, type: 'feeding', occurredAt: future, payload: { method: 'breast' } }).expect(201)
    const list = await request(app.getHttpServer())
      .get(`/api/families/${familyId}/events?childId=${childId}&type=feeding&until=${new Date().toISOString()}`)
      .set('Authorization', `Bearer ${me.token}`).expect(200)
    expect(list.body.total).toBe(0)
  })

  it('按类型与时间排序返回（新的在前）', async () => {
    await post({ childId, type: 'feeding', occurredAt: '2026-10-16T01:00:00.000Z', payload: { method: 'breast' } }).expect(201)
    await post({ childId, type: 'feeding', occurredAt: '2026-10-16T03:00:00.000Z', payload: { method: 'bottle' } }).expect(201)
    const list = await request(app.getHttpServer())
      .get(`/api/families/${familyId}/events?childId=${childId}&type=feeding`)
      .set('Authorization', `Bearer ${me.token}`).expect(200)
    expect(list.body.items.map((e: { occurredAt: string }) => e.occurredAt)).toEqual([
      '2026-10-16T03:00:00.000Z', '2026-10-16T01:00:00.000Z',
    ])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/api test:e2e -- events`
Expected: FAIL —— 404

- [ ] **Step 3: 实现 CreateEventDto 与两处校验**

`class-validator` 负责"结构"（`type` 在 `EVENT_TYPES` 内、`occurredAt` 是 ISO 日期串、`childId` 是 UUID），`@moonbud/shared` 的 `validateEventPayload` 负责"内容"。**在 `EventsService.create` 里调用 `validateEventPayload` 并抛 `BadRequestException(errors)`**——不放进 DTO，因为 payload 的形状依赖 `type`。

区间校验：`if (endedAt && endedAt <= occurredAt) throw new BadRequestException('结束时间必须晚于开始时间')`。

- [ ] **Step 4: 实现 `EventsService`**

- `assertChildInFamily(childId, familyId)`：查 `children` 确认 `childId` 属于 `familyId`，否则 `BadRequestException`（**这是第 8 条测试的防线：防止用别家的 childId 写入本家庭**）。
- `findAll(familyId, query)`：`where` 组装 `deletedAt: null`、可选 `childId`/`type`、`occurredAt: { gte: from, lte: until ?? to }`；`orderBy: { occurredAt: 'desc' }`；返回 `Paginated<EventDto>`。
- `update(eventId, userId, dto)`：查记录 → **`createdBy !== userId` 且调用者不是 ADMIN/OWNER 则 `ForbiddenException`**（角色从 `request.familyMember` 传入，不在 service 里重查）→ 若改了 `type` 或 `payload`，**重新跑 `validateEventPayload`** → 写 `updatedBy`。
- `softDelete(eventId, userId, role)`：同样的权限判断 → 置 `deletedAt`。
- `findLatestByType(childId, type, until)`：`orderBy: { occurredAt: 'desc' }`、`where: { childId, type, deletedAt: null, occurredAt: { lte: until } }`、`take: 1`。

- [ ] **Step 5: 实现 `ChildrenService`**

CRUD；`DELETE` 置 `archivedAt`（软删除，spec 第 4 节）。`birthday` 不接受未来日期（`@MaxDate` 等价校验：大于今天 → 400）。

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm --filter @moonbud/api test:e2e`
Expected: PASS —— events 14 个 + children 若干 + 此前全部

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/children apps/api/src/events apps/api/src/app.module.ts apps/api/test/events.e2e-spec.ts apps/api/test/children.e2e-spec.ts
git commit -m "feat(api): add children and events with JSONB validation and soft delete"
```

---

### Task 9: 提醒 CRUD 与完成语义

**Files:**
- Create: `apps/api/src/reminders/reminders.module.ts`
- Create: `apps/api/src/reminders/reminders.controller.ts`
- Create: `apps/api/src/reminders/reminders.service.ts`
- Create: `apps/api/src/reminders/occurrences.service.ts`
- Create: `apps/api/src/reminders/dto/create-reminder.dto.ts`
- Create: `apps/api/src/reminders/dto/update-reminder.dto.ts`
- Test: `apps/api/test/reminders.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `@moonbud/shared` 的 `computeDueAt`、`expandDueDates`、`isSupportedTimezone`、`ReminderType`；Task 5 的守卫
- Produces:
  - `GET|POST /api/families/:familyId/reminders?status=`
  - `GET|PATCH|DELETE /api/families/:familyId/reminders/:reminderId`
  - `POST /api/families/:familyId/reminders/:reminderId/complete { occurrenceId? }` → `200 ReminderDto`
  - `GET /api/families/:familyId/reminders/:reminderId/occurrences` → `200 ReminderOccurrenceDto[]`
  - `OccurrencesService.materializeDue(now: Date): Promise<number>`（返回新建的 occurrence 数，供 Task 11 的 cron 调用）

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/api/test/reminders.e2e-spec.ts
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'

describe('提醒', () => {
  let app: INestApplication
  let me: { token: string; id: string }
  let familyId: string
  let childId: string

  const register = async (username: string) => {
    const res = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ username, password: 'pass12345', nickname: username, timezone: 'Asia/Shanghai' }).expect(201)
    return { token: res.body.accessToken as string, id: res.body.user.id as string }
  }
  const post = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/api/families/${familyId}/reminders`)
      .set('Authorization', `Bearer ${me.token}`).send(body)

  beforeAll(async () => { app = await createTestApp() })
  beforeEach(async () => {
    await resetDatabase()
    me = await register('rm_me1')
    const f = await request(app.getHttpServer()).post('/api/families')
      .set('Authorization', `Bearer ${me.token}`).send({ name: 'F' }).expect(201)
    familyId = f.body.id
    const c = await request(app.getHttpServer()).post(`/api/families/${familyId}/children`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ name: '宝宝', gender: 'UNKNOWN', birthday: '2026-01-01' }).expect(201)
    childId = c.body.id
  })
  afterAll(async () => { await app.close() })

  it('创建一次性提醒默认 ACTIVE 且记录时区', async () => {
    const res = await post({
      childId, title: '打疫苗', type: 'ONE_TIME',
      dueAt: '2026-12-01T01:00:00.000Z', timezone: 'Asia/Shanghai',
    }).expect(201)
    expect(res.body.status).toBe('ACTIVE')
    expect(res.body.timezone).toBe('Asia/Shanghai')
  })

  it('RECURRING 需要 rrule，ONE_TIME 需要 dueAt', async () => {
    await post({ childId, title: 'X', type: 'RECURRING', timezone: 'Asia/Shanghai' }).expect(400)
    await post({ childId, title: 'X', type: 'ONE_TIME', timezone: 'Asia/Shanghai' }).expect(400)
  })

  it('拒绝非法时区', async () => {
    await post({ childId, title: 'X', type: 'ONE_TIME', dueAt: '2026-12-01T00:00:00.000Z', timezone: 'Not/AZone' }).expect(400)
  })

  it('完成一次性提醒后状态为 DONE', async () => {
    const r = await post({ childId, title: '打疫苗', type: 'ONE_TIME', dueAt: '2026-12-01T00:00:00.000Z', timezone: 'Asia/Shanghai' }).expect(201)
    const done = await request(app.getHttpServer())
      .post(`/api/families/${familyId}/reminders/${r.body.id}/complete`)
      .set('Authorization', `Bearer ${me.token}`).send({}).expect(200)
    expect(done.body.status).toBe('DONE')
  })

  it('完成重复提醒只关本次实例，系列保持 ACTIVE', async () => {
    const r = await post({
      childId, title: '每天吃维D', type: 'RECURRING',
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0', timezone: 'Asia/Shanghai',
    }).expect(201)
    const occ = await request(app.getHttpServer())
      .get(`/api/families/${familyId}/reminders/${r.body.id}/occurrences`)
      .set('Authorization', `Bearer ${me.token}`).expect(200)
    expect(occ.body.length).toBeGreaterThan(0)
    const done = await request(app.getHttpServer())
      .post(`/api/families/${familyId}/reminders/${r.body.id}/complete`)
      .set('Authorization', `Bearer ${me.token}`).send({ occurrenceId: occ.body[0].id }).expect(200)
    expect(done.body.status).toBe('ACTIVE')
    const after = await request(app.getHttpServer())
      .get(`/api/families/${familyId}/reminders/${r.body.id}/occurrences`)
      .set('Authorization', `Bearer ${me.token}`).expect(200)
    const completed = after.body.find((o: { id: string }) => o.id === occ.body[0].id)
    expect(completed.status).toBe('DONE')
    expect(completed.completedBy).toBe(me.id)
  })

  it('改计划只清理未来未完成的实例，保留已完成历史', async () => {
    const r = await post({
      childId, title: '每天吃维D', type: 'RECURRING',
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0', timezone: 'Asia/Shanghai',
    }).expect(201)
    const occ = await request(app.getHttpServer())
      .get(`/api/families/${familyId}/reminders/${r.body.id}/occurrences`)
      .set('Authorization', `Bearer ${me.token}`).expect(200)
    const firstDue = occ.body[0].id
    await request(app.getHttpServer())
      .post(`/api/families/${familyId}/reminders/${r.body.id}/complete`)
      .set('Authorization', `Bearer ${me.token}`).send({ occurrenceId: firstDue }).expect(200)
    await request(app.getHttpServer())
      .patch(`/api/families/${familyId}/reminders/${r.body.id}`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' }).expect(200)
    const after = await request(app.getHttpServer())
      .get(`/api/families/${familyId}/reminders/${r.body.id}/occurrences`)
      .set('Authorization', `Bearer ${me.token}`).expect(200)
    expect(after.body.some((o: { id: string }) => o.id === firstDue && o.status === 'DONE')).toBe(true)
    expect(after.body.some((o: { status: string }) => o.status === 'PENDING')).toBe(false)
  })

  it('取消提醒后未触发的实例变为 SKIPPED，已完成保留', async () => {
    const r = await post({
      childId, title: 'X', type: 'RECURRING',
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0', timezone: 'Asia/Shanghai',
    }).expect(201)
    await request(app.getHttpServer()).delete(`/api/families/${familyId}/reminders/${r.body.id}`)
      .set('Authorization', `Bearer ${me.token}`).expect(204)
    const list = await request(app.getHttpServer())
      .get(`/api/families/${familyId}/reminders?status=CANCELLED`)
      .set('Authorization', `Bearer ${me.token}`).expect(200)
    expect(list.body.items.map((x: { id: string }) => x.id)).toContain(r.body.id)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/api test:e2e -- reminders`
Expected: FAIL —— 404

- [ ] **Step 3: 实现 `OccurrencesService.materializeDue`（按需生成 + 幂等）**

这是 spec 第 4 节的核心行为。算法：

1. `const reminders = await prisma.reminder.findMany({ where: { status: 'ACTIVE' } })`。
2. 对每条：
   - **ONE_TIME**：若 `dueAt <= now` 且该 `(reminderId, dueAt)` 不存在 → `create`。
   - **RECURRING**：`const last = await prisma.reminderOccurrence.findFirst({ where: { reminderId }, orderBy: { dueAt: 'desc' } })`；`from = last?.dueAt ?? new Date(0)`；`until = now`；**下界加安全窗**：`from < now - 7天` 时把 `from` 提到 `now - 7天`（防止一个很久没扫的提醒一次展开几万条）。
   - 用 `expandDueDates({ rrule, timezone, from, to: until, limit: 500 })` 得到候选时刻。
   - 逐个 `createMany({ data: candidates.map(...), skipDuplicates: true })`——**`skipDuplicates` + 唯一约束共同保证幂等**。
3. 返回新建条数总和。

**错误隔离**：单条提醒的 `rrule` 非法不能让整个扫描崩掉。对每条用 `try/catch`，记 `logger.error`，继续下一条。

- [ ] **Step 4: 实现 `RemindersService` 的 CRUD 与完成语义**

- `create`：`ONE_TIME` 必须有 `dueAt`、`RECURRING` 必须有 `rrule`（否则 400）；`timezone` 必须先 `isSupportedTimezone` 校验；`timezone` 省略时取 `users.timezone`。
- `complete(reminderId, occurrenceId?, userId)`：
  - `ONE_TIME`：`reminder.status = 'DONE'`，并把其唯一 occurrence 置 `DONE` + `completedBy`/`completedAt`。
  - `RECURRING`：**只更新指定 occurrence**（未传 `occurrenceId` 则取最早一条 `PENDING`），`reminder.status` **保持 ACTIVE**。
- `update`：若改动了 `rrule`/`dueAt`/`timezone`，事务内 `deleteMany({ where: { reminderId, status: 'PENDING', dueAt: { gt: now } } })`，**保留 `DONE` 与过去时刻的实例**。
- `cancel`（DELETE 路由）：`status = 'CANCELLED'`，并把 `status: 'PENDING'` 的实例全部置 `SKIPPED`。
- `listOccurrences`：`orderBy: { dueAt: 'asc' }`。
- **"已过期"不落库**：`GET /reminders` 的 `status=OVERDUE` 查询翻译成 `status: 'ACTIVE'` + 存在 `dueAt < now` 且 `status: 'PENDING'` 的实例。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @moonbud/api test:e2e -- reminders`
Expected: PASS —— 7 个测试绿

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reminders apps/api/src/app.module.ts apps/api/test/reminders.e2e-spec.ts
git commit -m "feat(api): add reminders with on-demand occurrence materialization"
```

---

### Task 10: 站内通知与推送接口占位

**Files:**
- Create: `apps/api/src/notifications/notifications.module.ts`
- Create: `apps/api/src/notifications/notifications.controller.ts`
- Create: `apps/api/src/notifications/notifications.service.ts`
- Create: `apps/api/src/push/push-provider.interface.ts`
- Create: `apps/api/src/push/noop-push.provider.ts`
- Create: `apps/api/src/push/push.module.ts`
- Test: `apps/api/test/notifications.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: Task 9 的 occurrence
- Produces:
  - `GET /api/notifications?unreadOnly=` → `200 Paginated<NotificationDto>`
  - `POST /api/notifications/:id/read` → `200 NotificationDto`
  - `POST /api/notifications/read-all` → `200 { updated: number }`
  - `NotificationsService.createForOccurrence(occurrenceId: string): Promise<number>`
  - `interface PushProvider { send(userId: string, title: string, body: string, data?: Record<string, unknown>): Promise<void> }`
  - `class NoopPushProvider implements PushProvider`（只 `logger.debug`，**不发送任何东西**）
  - 注入令牌 `PUSH_PROVIDER`

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/api/test/notifications.e2e-spec.ts
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'

describe('通知', () => {
  let app: INestApplication
  let me: { token: string; id: string }
  let familyId: string

  const register = async (username: string) => {
    const res = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ username, password: 'pass12345', nickname: username, timezone: 'Asia/Shanghai' }).expect(201)
    return { token: res.body.accessToken as string, id: res.body.user.id as string }
  }

  beforeAll(async () => { app = await createTestApp() })
  beforeEach(async () => {
    await resetDatabase()
    me = await register('nt_me1')
    const f = await request(app.getHttpServer()).post('/api/families')
      .set('Authorization', `Bearer ${me.token}`).send({ name: 'F' }).expect(201)
    familyId = f.body.id
  })
  afterAll(async () => { await app.close() })

  it('初始没有未读通知', async () => {
    const res = await request(app.getHttpServer()).get('/api/notifications')
      .set('Authorization', `Bearer ${me.token}`).expect(200)
    expect(res.body.total).toBe(0)
  })

  it('只能看到发给自己的通知', async () => {
    const other = await register('nt_other1')
    const res = await request(app.getHttpServer()).get('/api/notifications')
      .set('Authorization', `Bearer ${other.token}`).expect(200)
    expect(res.body.total).toBe(0)
  })

  it('read-all 对空列表返回 updated: 0', async () => {
    const res = await request(app.getHttpServer()).post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${me.token}`).expect(200)
    expect(res.body).toEqual({ updated: 0 })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/api test:e2e -- notifications`
Expected: FAIL —— 404

- [ ] **Step 3: 实现通知服务与控制器**

- `list(userId, unreadOnly)`：`where: { userId, ...(unreadOnly ? { readAt: null } : {}) }`、`orderBy: { createdAt: 'desc' }`、分页。
- `markRead(id, userId)`：**必须带 `userId` 条件**（`updateMany({ where: { id, userId } })`）——否则能标记别人的通知，属越权。
- `readAll(userId)`：`updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } })`，返回 `{ updated: count }`。
- `createForOccurrence(occurrenceId)`：查 occurrence → 查 reminder → **确定收件人**：`assigneeId` 非空则只发给该用户；为空则发给**该家庭全部成员**。逐人 `create` 通知；再调用 `pushProvider.send(...)`（当前是 Noop）。**收件人去重**（同一用户在一个家庭里只有一条成员记录，天然不重复，但仍用 `Set` 保证）。

- [ ] **Step 4: 实现 PushProvider 接口与 Noop 实现**

接口文件只放类型与注入令牌；`NoopPushProvider` 的 `send` 只 `this.logger.debug(\`[noop-push] ...\`)`，并**在类注释里写明：v1 不接通真实推送，接入 uni-push 时新增一个实现并替换 provider 绑定即可，业务代码不改**（spec 第 6 节阶段二）。

`push.module.ts` 用 `{ provide: PUSH_PROVIDER, useClass: NoopPushProvider }` 并导出。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @moonbud/api test:e2e -- notifications`
Expected: PASS —— 3 个测试绿

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/notifications apps/api/src/push apps/api/src/app.module.ts apps/api/test/notifications.e2e-spec.ts
git commit -m "feat(api): add in-app notifications and push provider placeholder"
```

---

### Task 11: 每分钟调度任务（幂等 + 错误隔离）

**Files:**
- Create: `apps/api/src/reminders/reminder-scheduler.service.ts`
- Test: `apps/api/test/scheduler.e2e-spec.ts`
- Modify: `apps/api/src/reminders/reminders.module.ts`、`apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: Task 9 的 `OccurrencesService.materializeDue`、Task 10 的 `NotificationsService.createForOccurrence`
- Produces:
  - `ReminderSchedulerService.tick(now?: Date): Promise<{ created: number; notified: number }>`
  - `@Cron(CronExpression.EVERY_MINUTE)` 的 `handleCron()`，内部调 `tick()`

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/api/test/scheduler.e2e-spec.ts
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'
import { ReminderSchedulerService } from '../src/reminders/reminder-scheduler.service'
import { PrismaService } from '../src/prisma/prisma.service'

describe('提醒调度', () => {
  let app: INestApplication
  let scheduler: ReminderSchedulerService
  let prisma: PrismaService
  let me: { token: string; id: string }
  let familyId: string

  const register = async (username: string) => {
    const res = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ username, password: 'pass12345', nickname: username, timezone: 'Asia/Shanghai' }).expect(201)
    return { token: res.body.accessToken as string, id: res.body.user.id as string }
  }

  beforeAll(async () => {
    app = await createTestApp()
    scheduler = app.get(ReminderSchedulerService)
    prisma = app.get(PrismaService)
  })
  beforeEach(async () => {
    await resetDatabase()
    me = await register('sc_me1')
    const f = await request(app.getHttpServer()).post('/api/families')
      .set('Authorization', `Bearer ${me.token}`).send({ name: 'F' }).expect(201)
    familyId = f.body.id
  })
  afterAll(async () => { await app.close() })

  it('到期的 ONE_TIME 提醒生成实例与通知', async () => {
    await request(app.getHttpServer()).post(`/api/families/${familyId}/reminders`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ title: '打疫苗', type: 'ONE_TIME', dueAt: new Date(Date.now() - 60_000).toISOString(), timezone: 'Asia/Shanghai' }).expect(201)
    const r = await scheduler.tick()
    expect(r.created).toBe(1)
    expect(r.notified).toBe(1)
    const n = await prisma.notification.count()
    expect(n).toBe(1)
  })

  it('重复 tick 不产生重复通知（幂等）', async () => {
    await request(app.getHttpServer()).post(`/api/families/${familyId}/reminders`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ title: '打疫苗', type: 'ONE_TIME', dueAt: new Date(Date.now() - 60_000).toISOString(), timezone: 'Asia/Shanghai' }).expect(201)
    await scheduler.tick()
    const second = await scheduler.tick()
    expect(second.created).toBe(0)
    expect(second.notified).toBe(0)
    expect(await prisma.notification.count()).toBe(1)
  })

  it('未到期的提醒不生成任何东西', async () => {
    await request(app.getHttpServer()).post(`/api/families/${familyId}/reminders`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ title: '未来', type: 'ONE_TIME', dueAt: new Date(Date.now() + 3600_000).toISOString(), timezone: 'Asia/Shanghai' }).expect(201)
    const r = await scheduler.tick()
    expect(r).toEqual({ created: 0, notified: 0 })
  })

  it('非法 rrule 的提醒不影响其它提醒的处理，也不让 tick 抛错', async () => {
    await request(app.getHttpServer()).post(`/api/families/${familyId}/reminders`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ title: '坏的', type: 'RECURRING', rrule: 'NOT A RRULE', timezone: 'Asia/Shanghai' }).expect(201)
    await request(app.getHttpServer()).post(`/api/families/${familyId}/reminders`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ title: '好的', type: 'ONE_TIME', dueAt: new Date(Date.now() - 60_000).toISOString(), timezone: 'Asia/Shanghai' }).expect(201)
    const r = await scheduler.tick()
    expect(r.created).toBe(1)
  })

  it('很久未跑的重复提醒不会一次展开成千上万条', async () => {
    await request(app.getHttpServer()).post(`/api/families/${familyId}/reminders`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ title: '每分钟', type: 'RECURRING', rrule: 'FREQ=MINUTELY', timezone: 'Asia/Shanghai' }).expect(201)
    const r = await scheduler.tick()
    expect(r.created).toBeLessThanOrEqual(500)
  })

  it('提醒的执行人不为空时只通知该成员', async () => {
    const other = await register('sc_other1')
    const inv = await request(app.getHttpServer()).post(`/api/families/${familyId}/invites`)
      .set('Authorization', `Bearer ${me.token}`).send({ role: 'MEMBER' }).expect(201)
    await request(app.getHttpServer()).post(`/api/invites/${inv.body.code}/accept`)
      .set('Authorization', `Bearer ${other.token}`).expect(201)
    await request(app.getHttpServer()).post(`/api/families/${familyId}/reminders`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({
        title: '只给他', type: 'ONE_TIME',
        dueAt: new Date(Date.now() - 60_000).toISOString(),
        timezone: 'Asia/Shanghai', assigneeId: other.id,
      }).expect(201)
    await scheduler.tick()
    const n = await prisma.notification.findMany()
    expect(n).toHaveLength(1)
    expect(n[0].userId).toBe(other.id)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/api test:e2e -- scheduler`
Expected: FAIL —— `ReminderSchedulerService` 不存在

- [ ] **Step 3: 实现 `tick(now = new Date())`**

```
1. created = await occurrences.materializeDue(now)
2. 找出所有 dueAt <= now 且 firedAt 为空的 occurrence（含刚创建的）
3. 对每条：
   a. try { notified += await notifications.createForOccurrence(occ.id) } catch (e) { logger.error(...) }
   b. 无论成功失败都要标记 firedAt = now —— 否则失败的那条会每分钟重试，形成噪声洪流
      但若 createForOccurrence 抛错，应先回滚 firedAt 的标记？不：v1 选择标记并记错误日志，
      理由是"重复通知"比"漏一次通知"更容易让用户反感（spec 反目标：提醒不可靠同样是失败，
      但重复轰炸会让用户直接关闭通知）
4. return { created, notified }
```

`handleCron()` 只做 `await this.tick()` 并把结果 `logger.log`，**自身也要 try/catch**，绝不让异常逃逸出 cron（否则 `@nestjs/schedule` 会记录未处理异常）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @moonbud/api test:e2e -- scheduler`
Expected: PASS —— 6 个测试绿

- [ ] **Step 5: 验证真实 cron 已注册**

Run: `pnpm --filter @moonbud/api start:dev` 并观察日志
Expected: 启动后约 60 秒内出现一次 cron 执行日志（`created`/`notified`），且进程不崩

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reminders apps/api/test/scheduler.e2e-spec.ts
git commit -m "feat(api): add idempotent per-minute reminder scheduler"
```

---

### Task 12: 防重复照护的"最近一条"接口

**Files:**
- Create: `apps/api/src/events/latest-event.controller.ts`
- Test: `apps/api/test/latest-event.e2e-spec.ts`
- Modify: `apps/api/src/events/events.module.ts`

**Interfaces:**
- Consumes: Task 8 的 `EventsService.findLatestByType`
- Produces:
  - `GET /api/families/:familyId/children/:childId/events/latest?type=feeding` → `200 { event: EventDto | null }`
  - `interface LatestEventResponse { event: EventDto | null }`

> **为什么单独一个端点而不是复用列表接口**：前端在每次打开记录表单时都要问一次"最近一条是什么"。用列表接口要传 `pageSize`、解析分页结构、还要自己保证排序正确。专用端点把"最近一条"这个语义固定在后端，前端只判空。spec 第 9 节要求这个提示**不消耗用户额外步骤**，所以它必须是一次轻量、语义明确的请求。

- [ ] **Step 1: 写失败的测试**

```typescript
// apps/api/test/latest-event.e2e-spec.ts
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'

describe('最近一条记录', () => {
  let app: INestApplication
  let me: { token: string; id: string }
  let familyId: string
  let childId: string

  const get = (type = 'feeding') =>
    request(app.getHttpServer())
      .get(`/api/families/${familyId}/children/${childId}/events/latest?type=${type}`)
      .set('Authorization', `Bearer ${me.token}`)

  const postEvent = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/api/families/${familyId}/events`)
      .set('Authorization', `Bearer ${me.token}`).send({ childId, ...body })

  beforeAll(async () => { app = await createTestApp() })
  beforeEach(async () => {
    await resetDatabase()
    const res = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ username: 'lt_me1', password: 'pass12345', nickname: '爸爸', timezone: 'Asia/Shanghai' }).expect(201)
    me = { token: res.body.accessToken, id: res.body.user.id }
    const f = await request(app.getHttpServer()).post('/api/families')
      .set('Authorization', `Bearer ${me.token}`).send({ name: 'F' }).expect(201)
    familyId = f.body.id
    const c = await request(app.getHttpServer()).post(`/api/families/${familyId}/children`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ name: '宝宝', gender: 'UNKNOWN', birthday: '2026-01-01' }).expect(201)
    childId = c.body.id
  })
  afterAll(async () => { await app.close() })

  it('没有任何记录时返回 null 而不是 404', async () => {
    const res = await get().expect(200)
    expect(res.body).toEqual({ event: null })
  })

  it('返回该类型最近的一条，并带上记录人昵称', async () => {
    await postEvent({ type: 'feeding', occurredAt: new Date(Date.now() - 7200_000).toISOString(), payload: { method: 'breast' } }).expect(201)
    await postEvent({ type: 'feeding', occurredAt: new Date(Date.now() - 1200_000).toISOString(), payload: { method: 'bottle', amountMl: 100 } }).expect(201)
    const res = await get().expect(200)
    expect(res.body.event.payload.method).toBe('bottle')
    expect(res.body.event.createdByNickname).toBe('爸爸')
  })

  it('忽略未来时间的记录（用户补录过去时间时的关键行为）', async () => {
    await postEvent({ type: 'feeding', occurredAt: new Date(Date.now() + 3600_000).toISOString(), payload: { method: 'breast' } }).expect(201)
    const res = await get().expect(200)
    expect(res.body.event).toBeNull()
  })

  it('忽略已软删除的记录', async () => {
    const created = await postEvent({ type: 'feeding', occurredAt: new Date(Date.now() - 600_000).toISOString(), payload: { method: 'breast' } }).expect(201)
    await request(app.getHttpServer()).delete(`/api/families/${familyId}/events/${created.body.id}`)
      .set('Authorization', `Bearer ${me.token}`).expect(204)
    const res = await get().expect(200)
    expect(res.body.event).toBeNull()
  })

  it('只看指定类型，不串到别的类型', async () => {
    await postEvent({ type: 'diaper', occurredAt: new Date(Date.now() - 300_000).toISOString(), payload: { kind: 'pee' } }).expect(201)
    const res = await get('feeding').expect(200)
    expect(res.body.event).toBeNull()
  })

  it('非法 type 返回 400', async () => {
    await get('nonsense').expect(400)
  })

  it('非成员访问返回 403', async () => {
    const other = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ username: 'lt_other1', password: 'pass12345', nickname: 'X', timezone: 'Asia/Shanghai' }).expect(201)
    await request(app.getHttpServer())
      .get(`/api/families/${familyId}/children/${childId}/events/latest?type=feeding`)
      .set('Authorization', `Bearer ${other.body.accessToken}`).expect(403)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @moonbud/api test:e2e -- latest-event`
Expected: FAIL —— 404

- [ ] **Step 3: 实现端点**

`LatestEventController` 上的路由 `children/:childId/events/latest` 必须**注册在 `EventsController` 的 `events/:eventId` 之前**，否则 `:eventId` 会吞掉这个路径（NestJS 按声明顺序匹配）。若两控制器难以保证顺序，把该路由并入 `EventsController` 并放在 `@Get(':eventId')` 之前。

实现：`@Query('type')` 用 `@IsIn(EVENT_TYPES)` 校验 → `assertChildInFamily(childId, familyId)` → `findLatestByType(childId, type, new Date())` → 有结果时 `include: { creator: { select: { nickname: true } } }` 并映射出 `createdByNickname` → 返回 `{ event }`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @moonbud/api test:e2e -- latest-event`
Expected: PASS —— 7 个测试绿

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/events apps/api/test/latest-event.e2e-spec.ts
git commit -m "feat(api): add latest-event endpoint for duplicate-care warning"
```

---

### Task 13: Swagger、README 与全量回归

**Files:**
- Create: `apps/api/src/swagger.ts`
- Create: `README.md`（仓库根）
- Modify: `apps/api/src/main.ts`、`package.json`

**Interfaces:**
- Consumes: 此前全部任务
- Produces: `GET /api/docs`（Swagger UI），README 含启动步骤

- [ ] **Step 1: 加 Swagger**

`main.ts` 里 `SwaggerModule.setup('api/docs', app, document)`（**注意路径与全局前缀的关系：setup 的相对路径最终为 `/api/docs`**）。用 `DocumentBuilder` 设置标题 `moonBud API`、版本 `1.0`、`addBearerAuth()`，并在 `@ApiTags` 上标注各控制器分组。

- [ ] **Step 2: 写 README**

必须包含、且能被照着执行的顺序：

1. 前置：Node 24+、pnpm 10+、Docker Desktop **已启动**。
2. `cp .env.example .env` 并说明每个变量。
3. `pnpm install`
4. `pnpm docker:up`
5. `pnpm --filter @moonbud/api exec prisma migrate deploy`
6. `pnpm dev:api`
7. `curl http://localhost:3000/api/health` 期望输出
8. 打开 `http://localhost:3000/api/docs`
9. `pnpm test:api` 跑全部 e2e
10. **已知限制**一节，照抄 spec 第 17 节：APP 关闭时无推送（需 uni-push 且未接通）、无邮箱/短信、不在家庭中的用户忘记密码无自助通路。

- [ ] **Step 3: 全量回归**

Run: `pnpm --filter @moonbud/shared test && pnpm --filter @moonbud/shared build && pnpm docker:up && pnpm --filter @moonbud/api test:e2e`
Expected: 全绿，无 `console.error`，无未处理 Promise 警告

- [ ] **Step 4: 数据库容器重建后再跑一次（验证迁移幂等）**

Run: `docker compose down -v && pnpm docker:up && pnpm --filter @moonbud/api exec prisma migrate deploy && pnpm --filter @moonbud/api test:e2e`
Expected: 全新库上迁移与测试同样全绿 —— **证明迁移脚本没有依赖既有状态**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/swagger.ts apps/api/src/main.ts README.md
git commit -m "docs(api): add swagger ui and runnable README"
```

---

## Self-Review

**1. Spec coverage（逐节对照）：**

| spec 节 | 覆盖任务 |
|---|---|
| 第 3 节 领域模型、角色权限、当前孩子 | Task 5、6（角色与不变量）；当前孩子为前端职责，见 mobile 计划 |
| 第 4 节 users/families/family_members | Task 2、3、5、6 |
| 第 4 节 children | Task 8 |
| 第 4 节 events + JSONB + 软删除 + 改删权限 | Task 8 |
| 第 4 节 reminders + 时区 + occurrence + 重复语义 | Task 9、11；时区算法在 shared 计划 Task 3 |
| 第 4 节 notifications | Task 10 |
| 第 4 节 family_invites + 不许 OWNER | Task 7 |
| 第 4 节末 家庭永不硬删除（归档/退出/转让） | Task 5、6 |
| 第 5 节 鉴权双 token、家庭上下文走 URL、RBAC 守卫 | Task 3、4、5 |
| 第 5 节 账号密码、修改密码、找回 | Task 3、6、7 |
| 第 6 节 阶段一调度 + 阶段二 PushProvider 占位 | Task 10、11 |
| 第 9 节 防重复照护的支撑接口 | Task 12 |
| 第 12 节 Docker 部署、迁移 | Task 1、2、13 |
| 第 7 节 主题系统 | 前端职责，见 mobile 计划 |
| 第 8 节 二维码邀请的服务端部分 | Task 7（落地页为前端职责） |

**无遗漏。** 主题、页面、预览属前端，已在 mobile 计划中承接。

**2. Step scan：** 每个 step 单一动作、结果可校验。Task 9 Step 3 与 Task 11 Step 3 给出了算法（因为签名与测试无法唯一决定——属于 skill 允许的例外），其余为签名 + 断言。

**3. Type consistency：** `FamilyRole`（Task 2 枚举 / Task 5 `MemberDto`）、`EVENT_TYPES`（shared / Task 8 `@IsIn` / Task 12 `@IsIn`）、`materializeDue` 返回 `number`（Task 9 定义，Task 11 消费）、`createForOccurrence` 返回 `number`（Task 10 定义，Task 11 消费 `notified`）、`findLatestByType(childId, type, until)`（Task 8 定义签名，Task 12 调用）——均一致。`PUSH_PROVIDER` 令牌（Task 10）在 Task 11 未使用（正确：通知创建与推送是两个动作，推送在 `NotificationsService` 内）。

**4. Review Focus：** 5 条全部有对应测试——越权读（Task 5 Step 1 第 2、4 条 + Step 6 的逐端点回归）、最后 OWNER 退出（Task 6 Step 1 第 1 条）、cron 重复通知与死循环（Task 11 Step 1 第 2、5 条）、睡眠区间倒置（Task 8 Step 1 第 4 条）、归档后仍能读写（Task 5 Step 1 第 6 条）。另补入 spec 反目标的两条：记录软删除后不丢（Task 8）、提醒不可靠（Task 11 的错误隔离测试）。

**5. Proportion：** 本计划约 1150 行，对应实现约 2500–3500 行（含测试）。计划短于实现，未逐行转录程序。Task 9/11 的算法段落是必要的例外。

**已知的计划内风险（执行时须留意）：**

- Task 11 Step 3 第 3.b 步的取舍（推送失败也标记 `firedAt`）是**刻意选择"漏一次胜过每分钟重复轰炸"**。若执行中发现更合适的做法（如失败时写 `firedAt` 但增加 `attempts` 计数并在 3 次后放弃），可在该任务内改进，但**必须同时改 Task 11 的幂等测试**，不能只改实现。
- 移动端计划尚未撰写。后端完成后需先写 `2026-10-16-mobile-app.md` 再开发前端。
