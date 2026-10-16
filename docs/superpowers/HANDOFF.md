# moonBud 会话交接（给下一个会话用）

## 新会话第一句该说什么

```
继续执行 docs/superpowers/plans/2026-10-16-api-backend.md，从 api T6 开始。
进度看 .superpowers/sdd/2026-10-16-api-backend/progress.md
```

工作目录必须是 `D:\mine\moonBud`。

## 执行方式（已确认，不要重新征求）

原生执行（inline）：在当前会话里逐个任务实现，每个任务走 TDD 红→绿，
最后整支分支派一个全新 reviewer 审查。

计划文档：`docs/superpowers/plans/` 下三份，
设计文档：`docs/superpowers/specs/2026-10-16-moonbud-design.md`

## 进度快照

已完成的提交（`git log --oneline`）：

| 计划 | 状态 | 提交 |
|---|---|---|
| shared-contract | **3/3 全部完成并关闭** | `fe649ee` `cfb0172` `72bc9f9` `e484787` |
| api-backend | **5/13** | `292b88d` `881d11f` `22b956b` `09b772d` `860f1de` |
| mobile-app | 0/9 未开始 | — |

api 已完成：T1 骨架+健康检查、T2 Prisma 迁移、T3 注册登录、T4 全局守卫+/me、T5 家庭 RBAC。
api 下一个：**T6 成员管理与"最后一名 OWNER"不变量**。

测试现状：`pnpm --filter @moonbud/api test:e2e` → **25 个全绿**（5 个 suite）。
`pnpm --filter @moonbud/shared test` → **35 个全绿**。

## 动手前必须知道的既有 rulings（不要重复踩）

完整版在各自 `progress.md` 里，这是摘要：

1. **数据库宿主端口是 5433，不是 5432。** 本机有本地 PostgreSQL 18 服务占着
   5432，会静默接走连接并报 `role "moonbud" does not exist`（完全不指向真因）。
2. **bcrypt 换成了 bcryptjs（纯 JS）。** 原生模块被 pnpm 拦了安装脚本，
   且会绑死宿主 Node 24 而镜像跑 Node 22。
3. **Prisma 所有模型都有 `@@map` 到 snake_case。** 不写的话表名是 PascalCase，
   而 `resetDatabase` 用 snake_case truncate，会报 `relation ... does not exist`。
4. **`main.ts` 与 e2e 测试共用 `configureApp()`。** 曾经因为测试自己拼装配而
   漏掉全局 `ValidationPipe`，导致**校验完全没生效**（非法账号返回 201），
   而测试还以为在验证校验。新增全局配置必须加在这里。
5. **`@moonbud/shared` 的 rrule 必须用默认导入**（`import rrulePkg from 'rrule'`）。
   它是纯 CJS 包，具名导入会让 ESM 产物在真实 Node 里加载失败，而 Vitest 抓不到
   （Vite 会合成具名导出）。改这个包后要**在真实 Node 里跑一次产物**。
6. **鉴权失败一律 401，不是 400。** 失效 refresh token 返回 401。
7. **家庭作用域权限只在 `FamilyMemberGuard` 一处实现**；非成员与不存在的家庭
   都返回 **403**（不用 404，避免探测家庭是否存在）；归档家庭一律拒绝。
8. **Docker 镜像还没构建成功。** Docker Hub 本机不可达，容器内拉包极慢。
   Dockerfile 里没有已知错误，但 `docker compose up` 起后端**尚未验证**。
   后端目前只在宿主机验证过（`node apps/api/dist/main.js` → 200）。

## 环境状态

- Docker Desktop 已启动，`moonbud-postgres` 容器在跑（healthy，端口 5433）
- 本地 PostgreSQL 18 服务**未改动**
- 计划里 T1 需要的 Docker Desktop 已就绪

## 当前工作区状态（干净）

```
D:\mine\moonBud
├─ apps/api            NestJS 后端（T1-T5 完成）
├─ packages/shared     共享契约（已完成）
├─ docs/superpowers/   设计文档 + 三份计划
├─ docker-compose.yml  postgres + api
└─ .superpowers/sdd/   各计划的 ledger（**git-ignored**，只在本机）
```

注意：`.superpowers/` 被 gitignore，所以 ledger 不在 git 里。如果要跨机器，
需要手工拷贝，或者从 `git log` 重建进度（提交信息是按任务分界的，可以重建）。
