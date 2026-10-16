# moonBud 会话交接（给下一个会话用）

## 当前状态（2026-10-16 晚更新）

| 计划 | 状态 | 说明 |
|---|---|---|
| `2026-10-16-shared-contract.md` | **3/3 完成并关闭** | `fe649ee` `cfb0172` `72bc9f9` `e484787` |
| `2026-10-16-api-backend.md` | **13/13 完成** | 基线 `e484787`，15 个提交（见下） |
| `2026-10-16-mobile-app.md` | **0/9 未开始** —— 先写计划再动手 | 计划文档尚不存在，需先按 spec 撰写 |

api-backend 的提交（`git log --oneline e484787..HEAD`）：

```
826bd99 test(api): keep the per-minute cron out of e2e so suites stay deterministic
e40a2fe docs(api): add swagger ui and runnable README
93031f4 feat(api): add latest-event endpoint for duplicate-care warning
3ae87ba feat(api): add idempotent per-minute reminder scheduler
d13c5e6 feat(api): add in-app notifications and push provider placeholder
ff59ca2 feat(api): add reminders with on-demand occurrence materialization
63537d5 feat(api): add children and events with JSONB validation and soft delete
8b7b258 feat(api): add change-password, reset requests, and family invites
dfb9ee4 feat(api): add member management with last-owner invariant
860f1de feat(api): add families module with centralized family RBAC guard
09b772d feat(api): add global jwt guard, /me, refresh rotation, and logout
22b956b feat(api): add username/password registration and login
881d11f feat(api): add prisma schema, snake_case migration, and dockerized api service
292b88d feat(api): scaffold NestJS app with dockerized postgres and health check
```

保留的文档：`README.md`（可从零照着跑起来）、`docs/superpowers/specs/2026-10-16-moonbud-design.md`、
三份计划。api 的实施过程裁决全部记在
`.superpowers/sdd/2026-10-16-api-backend/progress.md`（**git-ignored，只在本机**，刻意保留）。

## 下一条命令

```
开始执行 mobile-app 计划：先按 docs/superpowers/specs/2026-10-16-moonbud-design.md
撰写 docs/superpowers/plans/2026-10-16-mobile-app.md，再实现。
工作目录必须是 D:\mine\moonBud。
```

`apps/mobile/` 已存在一个 uni-app 脚手架（未纳入 git，属于 mobile 计划）。

## 执行方式（已确认，不要重新征求）

原生执行（inline）：在当前会话里逐个任务实现，每个任务走 TDD 红→绿，
最后整支分支派一个全新 reviewer 审查。

## 测试与验证现状

- `pnpm --filter @moonbud/api test:e2e` → **125 个全绿（14 个 suite）**，
  跑在真实 PostgreSQL 上，不是替身。
- `pnpm --filter @moonbud/shared test` → **35 个全绿**；`pnpm build:shared` 通过。
- `pnpm --filter @moonbud/api typecheck` 与 `nest build` 干净。
- 迁移幂等已验证：`docker compose down -v` 清空卷 → `docker:up` → `prisma migrate deploy`
  → 全新库上全量测试同样全绿。
- Swagger 已在真实进程里验证：`/api/docs` 200、`/api/docs-json` 200
  （`moonBud API` 1.0，bearer，31 条路径）。

## 动手前必须知道的既有 rulings（不要重复踩）

1. **数据库宿主端口是 5433，不是 5432。** 本机有本地 PostgreSQL 18 服务占着
   5432，会静默接走连接并报 `role "moonbud" does not exist`（完全不指向真因）。
   容器内始终是 5432。
2. **bcrypt 换成了 bcryptjs（纯 JS）。** 原生模块被 pnpm 拦了安装脚本，
   且会绑死宿主 Node 24 而镜像跑 Node 22。
3. **Prisma 所有模型都有 `@@map` 到 snake_case。** 不写的话表名是 PascalCase，
   而 `resetDatabase` 用 snake_case truncate，会报 `relation ... does not exist`。
4. **`main.ts` 与 e2e 测试共用 `configureApp()`。** 曾经因为测试自己拼装配而
   漏掉全局 `ValidationPipe`，导致**校验完全没生效**（非法账号返回 201）。
   新增全局配置必须加在这里。
5. **`enableImplicitConversion` 全局关闭**，数字/布尔查询参数一律显式
   `@Type`/`@Transform`；否则查询串里的 `false` 会变成 `true`。
6. **`@moonbud/shared` 的 rrule 必须用默认导入**（`import rrulePkg from 'rrule'`）。
   纯 CJS 包，具名导入会让 ESM 产物在真实 Node 里加载失败，而 Vitest 抓不到。
7. **鉴权失败一律 401，不是 400。** 失效 refresh token 返回 401。
8. **家庭作用域权限只在 `FamilyMemberGuard` 一处实现**；非成员与不存在的家庭
   都返回 **403**（不用 404，避免探测家庭是否存在）；归档家庭一律拒绝。
   JwtAuthGuard 是全局 `APP_GUARD`，默认全部路由都要登录，`@Public()` 才放行。
9. **e2e 里关掉了真实 cron**（`SCHEDULER_ENABLED=false`，见
   `apps/api/test/setup-env.ts`）。真实定时器会在别的 suite 清库清到一半时醒来，
   制造假错误并让计数不确定；测试一律用 `scheduler.tick()` 显式驱动。
   生产必须保持 `SCHEDULER_ENABLED=true`。
10. **记录一律软删除**；提醒的 DELETE 是"取消"（`status=CANCELLED` + PENDING→SKIPPED），
    绝不是删行——"记录丢失不可接受"是 spec 的反目标。
11. **`EventDto.createdByNickname` 是必填字段**；`LatestEventResponse` 在
    `@moonbud/shared` 里。
12. **Docker 镜像还没构建成功。** Docker Hub 本机不可达，容器内拉包极慢。
    Dockerfile 里没有已知错误，但 `docker compose up` 起后端**尚未验证**。
    后端目前只在宿主机验证过。

## 留给 mobile 计划的未决问题（后端已做出选择，前端要跟着定）

1. **`GET /api/families/:familyId/reminders?status=ACTIVE` 会包含已过期但未完成的提醒；
   `?status=OVERDUE` 是更窄的筛（ACTIVE + 有过去的 PENDING 实例）。** 两者**不是**分区。
   提醒页是"待办 / 已过期 / 已完成"三段式，若前端希望它们是互斥的，需要在 mobile 计划里
   明确，并决定是改后端筛选还是前端自己过滤（这条是 api 计划 Task 9 留下的）。
2. **`GET /api/families/:familyId/children/:childId/events/latest` 对归档孩子返回 400**，
   而同一孩子的记录列表 `GET .../events?childId=` 返回 200（前者复用了创建路径的
   `assertChildInFamily`，它连归档一起拒）。归档孩子在客户端不可见，所以影响很小，
   但这是一个读接口的不一致，愿改就在 mobile 计划或一个小补丁里改。

## 环境状态

- Docker Desktop 已启动，`moonbud-postgres` 容器在跑（healthy，宿主端口 5433）。
- 本地 PostgreSQL 18 服务**未改动**。
- 依赖走 npmmirror 镜像（`.npmrc`）；Dockerfile 里额外设了 `COREPACK_NPM_REGISTRY`。
- `pnpm-lock.yaml` 在当前工作区有未提交改动，内容全部来自 `apps/mobile`
  这个未跟踪目录（以及它带来的 peer 后缀变动）。**不要**单独提交它——
  那会给一个 git 不跟踪的目录声明 importer；等 mobile 计划把
  `apps/mobile` 纳入版本管理时一起提交。
