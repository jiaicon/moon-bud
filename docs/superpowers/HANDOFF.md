# moonBud 会话交接（给下一个会话用）

## 当前状态（2026-10-16 晚更新）

| 计划 | 状态 | 说明 |
|---|---|---|
| `2026-10-16-shared-contract.md` | **3/3 完成并关闭** | `fe649ee` `cfb0172` `72bc9f9` `e484787` |
| `2026-10-16-api-backend.md` | **13/13 完成** | 基线 `e484787`，15 个提交（见下） |
| `2026-10-16-mobile-app.md` | **9/9 完成 + 终审修复已入库（尚未 push/合并决策）** | 见下"移动端计划状态" |

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
  （mobile 计划已把 `apps/mobile` 入库，lock 也随各 task 一起提交了；这条现在只是历史说明。）

## 移动端计划状态（2026-10-19 更新）

`2026-10-16-mobile-app.md` 的 9 个 task 全部完成，随后做了一次全新上下文的整支终审
（`review-package`，范围 `dd6dd91..0d534aa`），并按用户圈定的范围修完了 4 个 Critical
加两条写路径缺口。当前门禁：`pnpm --filter @moonbud/mobile test` 118/118、
`type-check` 干净、`build:h5` 成功；`pnpm --filter @moonbud/api test:e2e` 131/131、
`typecheck` 干净。

### 终审后已修

- **C-1** 深色模式下 uView 自带表面仍是白底（`theme/uview-bridge.ts` 桥接 `--u-*`，
  并由 `ThemeRoot` 在**每个平台**把两套变量绑在页面根节点上——uView 把默认值声明在
  `:root, page` 上，`page` 比 documentElement 离内容更近，只注入根元素会被盖掉）。
- **C-2** 加载失败被渲染成"今天还没有"（`pages/home/home-view.ts` 纯函数 + 重试入口 +
  "下面的数字现在不可信"红条）。
- **C-3** 冷启动并发续期把赢家的新凭证删掉（`http.ts` 的 `renewAccessToken()` single-flight；
  `auth.bootstrap` 只在 refresh token 仍是本次开始那一张时才 `clearSession`）。
- **C-4** 破坏性操作一键生效且归档文案是假的（`utils/confirm.ts` 的 `confirmDanger`；
  归档改为实话："当前版本没有恢复入口"）。
- **I-8** 记录可以改可以删了（`events/event-edit.ts`：表单按记录原时刻回填、
  权限镜像 `events.service.ts:212-214`，列表卡片点开即编辑、右侧删除带确认）。
- **I-12** 找回请求真的会通知同家庭的其他 OWNER/ADMIN（站内通知，10 分钟冷却），
  页面文案同步。

### 仍然欠着的（用户明确排除在本轮之外）

`I-4` 退出家庭/转让所有权没有 UI；`I-5` 原生 tabBar/导航栏写死在 `pages.json`，
没有 `setTabBarStyle`/`setNavigationBarColor`（深色模式上下两条栏是白的，且
`#4A7FB5` 是没过 WCAG 的旧雾蓝）；`I-6` 记录页下拉刷新可能永远转圈
（`if (loading) return` 早于 `finally`）；`I-7` 换家庭后记录页不重载孩子缓存，
"有孩子的家庭被告知没有孩子"且列表混全家记录；`I-9` 周期提醒停不掉
（`remindersApi.cancel` 无调用点）；`I-11` 孩子不能编辑（`childrenApi.update` 无调用点）；
`I-13` 邀请二维码指向 `/join` 落地页而客户端没有这个页面（计划本身就漏了这个 task，
`VITE_INVITE_BASE_URL` 默认也没配）；`I-14` 二维码按主题绘制，深色=反色码，微信解码不可靠。
`endpoints.ts` 里现在还剩这些零调用点函数：`remindersApi.cancel` / `occurrences`、
`familiesApi.leave` / `transfer`、`childrenApi.update`——按"死掉的客户端 API 就是没人做的
spec 条目"来读。

11 条 Minor（终审 M-1…M-11，全部记账未修）：`M-1` access token 落盘（与 spec §5"仅内存"
冲突，是有意取舍：冷启动免登录要能续，泄露的是 2h JWT 而非长期凭证）；`M-2` 加入成功后靠
隐式回退选中家庭，没有显式 `switchFamily`；`M-3` `auto` 模式只在启动时读一次系统主题，
没有 `onThemeChange` 监听；`M-4` 记录/提醒列表按**设备**时区分组，摘要按**账号**时区，
跨时区家庭会串日；`M-5` `previewVisited` 永不清除，注册过的回访用户仍被标成"继续注册"；
`M-6` `childStore.remove` 里的 `select(familyId,'')` 被成员检查拒绝，storage 留旧 id；
`M-7` `reminder-list` / `notification-center` 在 `onLoad`+`onShow` 各拉一次，双份请求；
`M-8` `usesCleartextTraffic: true` 写死且 BUILD.md 让运维保留，发行前应关掉；
`M-9` 本地通知注册表只在动提醒时重建，冷启动不重建、逾期不补装；`M-10` H5 没有游客路由守卫，
手输 `#/pages/home/index` 能进 tab 壳；`M-11` `http.ts` 用 `method as 'GET'` 绕过
`@dcloudio/types` 没有 PATCH 的枚举（已作为真机风险记在 BUILD.md）。
另有登录页双击提交会弹通用文案"操作失败，请稍后重试"——防抖的正常结果，提示语误导但不是缺陷。

评审"放弃判断"的 5 条按现状定案：v1 保留归档入口（只加了实话文案与确认，`I-4` 缺位时它是
唯一出口）；PATCH 风险按文档承担，不在后端加 POST 别名；`u-subsection` 留着不换 chips；
游客 H5 深链不加守卫（H5 只是调试面）；`welcome` 的"继续注册"不做回访面板。
`#ifdef APP-PLUS` 是否包含 `APP-HARMONY` 本地无法证实，BUILD.md 已把"鸿蒙没有 plus API"
写成前提，出包时才可能暴露。



### 踩过的坑，下次直接避开

- **`apps/api` 的常驻服务是 `node apps/api/dist/main.js`，改 `src` 不会生效。**
  验证后端行为前先 `pnpm --filter @moonbud/api build` 再重启，否则会拿旧二进制下结论。
- **e2e 会 `TRUNCATE` 整个开发库**（`test/utils/db.ts`），浏览器验证用的账号随之消失；
  跑完 e2e 要重新注册才能做前端验证。
- `pnpm --filter @moonbud/api test`（非 e2e）匹配不到任何测试并以 1 退出——api 的测试
  全在 `test/*.e2e-spec.ts`，别把它当回归门禁。
- u-popup `mode="bottom"` 渲染的是 `.u-drawer-content.u-drawer-bottom`，底色来自
  `--u-bg-white`；只测 documentElement 上的变量会得出错误结论，要看弹层自己的计算样式。

