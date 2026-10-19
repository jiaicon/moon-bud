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
加两条写路径缺口。当前门禁：`pnpm --filter @moonbud/mobile test` 202/202（26 个文件）、
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

### 2026-10-19 晚：这批欠账已清（I-4…I-14 + 大部分 Minor）

`I-4` 退出/转让有了 UI（成员管理里 OWNER 可"转让创建者"，家庭设置里可退出）；`I-5` 原生
tabBar/导航栏由 `theme/native-chrome.ts` 运行时按主题覆盖，文字色先过 AA 再上（不达标时沿明度
调，保住品牌色色相）；`I-6` 下拉刷新会收尾；`I-7` 换家庭后记录页重载孩子缓存并按孩子过滤；
`I-9` 提醒表单里有"停掉这个提醒"；`I-11` 孩子可编辑；`I-13` 补了 `pages/join/index` 落地页并
注册进 `pages.json`，`VITE_INVITE_BASE_URL` 在 `.env.development` 给了默认值；`I-14` 二维码
固定黑码白底。`endpoints.ts` 里剩下的零调用点函数只有 `remindersApi.occurrences`。

Minor：`M-2` 加入成功后显式 `switchFamily`；`M-3` `theme/system-theme.ts` 监听系统主题；
`M-5` 注册成功清掉 `previewVisited`；`M-6` 移除孩子后删掉 storage 里的旧 id；`M-7` 列表页加
`ready` 标记，首屏不再发双份请求；`M-9` 冷启动 `rearmLocalNotifications()` 重建排期；
`M-4` 记录列表按天分组改走 `events/day-groups.ts`、提醒文案改走 `reminders/due-label.ts`，
两处都按账号/提醒自己的时区算日子，与首页摘要一致。

**验证时抓到的权限回归（已修）**：家庭设置把"归档此家庭"画给了 ADMIN、把改名输入框画给了
MEMBER，邀请页把生成/撤销码画给了 MEMBER，而后端归档只认 OWNER、改名与发码只认 OWNER/ADMIN、
列表任何成员可读。现在 `pages/__tests__/role-gates.test.ts` 把前后端两头的角色要求钉在同一张
测试里。

仍然欠着：`M-1` access token 落盘（有意取舍，见上）、`M-8` `usesCleartextTraffic: true`
（发行前关）、`M-10` H5 游客深链无守卫、`M-11` `method as 'GET'`（真机风险记在 BUILD.md）。
另有登录页双击提交会弹通用文案"操作失败，请稍后重试"——防抖的正常结果，提示语误导但不是缺陷。

评审"放弃判断"的 5 条按现状定案：v1 保留归档入口（只加了实话文案与确认，`I-4` 缺位时它是
唯一出口）；PATCH 风险按文档承担，不在后端加 POST 别名；`u-subsection` 留着不换 chips；
游客 H5 深链不加守卫（H5 只是调试面）；`welcome` 的"继续注册"不做回访面板。
`#ifdef APP-PLUS` 是否包含 `APP-HARMONY` 本地无法证实，BUILD.md 已把"鸿蒙没有 plus API"
写成前提，出包时才可能暴露。



### 2026-10-19 深夜：两轮巡检 + 时区可改

巡检 A/B 已入库（`08891a5`）：所有读路径按账号时区、PATCH 静默丢弃的字段收口、退出登录清
本地通知排期、e2e 改走独立测试库。

**时区可改（已入库 `86e906c`）**：`PATCH /api/me` 只收 `timezone`（必填，`IsIanaTimezone`），"我的"页
加了时区行与选择器（`utils/timezone-options.ts`：候选清单 + `UTC±H:MM` 由 Intl 墙上时间算出来，
不用 `timeZoneName:'shortOffset'`，旧 webview 会抛）。注册页把 `deviceTimezone()` 的值念出来并指
明去哪里改——这个值从前是静默写进账号的。改完只影响"怎么看"：记录与提醒存的是时刻，
`reminders.timezone` 各自带着自己那一份，不会因为一个人换了城市就替全家改日程。

**更正上面的一条**：e2e 不再 TRUNCATE 开发库。`test/setup-env.ts` 现在要求仓库根有 `.env.test`
（gitignore，里面 `DATABASE_URL` 指向 `moonbud_test`），缺了就直接抛错拒绝启动。

暂缓未修，下次别当新发现：
- `invites.service.ts` 的 `usedCount` 是先读后写，同一码最后一个名额被两个请求撞进同一毫秒时
  会多放进一个人。改成 `updateMany(where usedCount < maxUses)` 能收口，但这要求测试能先红，
  并发交错复现不了，所以只在代码里注明了窗口。
- 框架默认异常是英文（不存在的 route → `Cannot PATCH /api/me`、守卫 → `Unauthorized`），
  会经 `http.ts` 原样显示。正常客户端打不到不存在的 route；我在开发中打到过一次，原因是常驻
  API 跑的是旧 `dist`（见下条）。

### 2026-10-19 深夜（二）：本地通知不再只武装一次 + 过期时刻不再念成"还没到"

**排期（未提交）**。旧写法只在"保存表单"和"完成本次"两个瞬间为每条提醒排**一个**时刻，
而家长建好"每天 20:00"之后不会回头编辑它——第一次响过，表里就只剩一个已过去的时刻，
这条提醒在这台手机上从此哑掉。现在：

- `reminders/occurrence-window.ts`：按提醒自己的时区展开 `(now, now+3 天]` 内的每次触发。
  三天是取舍——plus 只有"某一刻响一次"，窗口太短就得靠家长天天打开 App，太长是往系统
  通知器里塞几百条排期、改一次时间要全部重建。
- `notifications/local-notify.ts`：登记表条目改成"一次触发一行"，带 `owner` + `family`；
  `armReminders(familyId, ...)` 按家庭**整块替换**，所以别的设备上做完/停掉的提醒在下一次
  重算里就地消失（旧条目没有 `family`，重算时一并清掉）。`disarmReminder` 留给"停掉提醒"，
  本地立刻撤销，不等网络。
- `notifications/reminder-arming.ts` + `App.vue` 的 `onShow`：每次回到前台拉当前家庭的
  ACTIVE（`pageSize: 50`，服务端 `@Max(100)` 之内）重排；拉不到就什么都不动。表单保存与
  完成本次也走同一条重算。推送正文与卡片上的"该谁"共用 `assigneeLabel`，两处不会念得不一样。

**过期文案**。`formatDueIn` 从前只有"今天/明天"两支，且不看现在几点：一条今天早上 8 点没做
完的一次性提醒，晚上看仍写着"今天 08:00"，像还没到。现在今天已过写"今天 08:00（已过）"，
并补了"昨天"。顺手修掉一个真错：明天的判断用的是 `now + 86400000`，而夏令时切换那天有 25 个
小时，加满一天还在同一天里，"明天"会被念成月日——改成按墙上日期加减。

H5 里能验证的部分都验过（真机 no-op 的 `plus.push` 除外）：登记表里"每天该挤奶了"三行
19/20/21 号 20:00；旧版无 `family` 的条目被清掉；在应用背后 cancel 掉一条后，下一次前台它那
三行整块消失；屏幕上写着"今早的喂药 今天 02:58（已过）"。

仍然欠着：一次性的"过期"在首页概览里只统计有 `dueAt` 的提醒，重复提醒（`dueAt` 为 null）
永远不进过期数——要算得靠 occurrence 实例，客户端一次请求拿不到（`occurrences` 是逐条查的，
零调用点）。这条按现状留着。

**同日把上面这条还掉了**：首页不再自己筛 ACTIVE，改成问服务端要 `status=OVERDUE` 的
`total`（`pageSize: 1`，只要条数）。`buildTodaySummary` 的入参于是从"提醒数组"变成
"一个已经算好的数"——重复提醒在列表里 `dueAt` 是 null，客户端怎么筛都数不到它，
而 OVERDUE 在服务端是"活跃 + 有 PENDING 且已过期的实例"，本来就是对的口径。
H5 实证：一个家庭里放一条过期的一次性 + 一条每天的重复（两者都落在过去 30 分钟内），
横幅写"2 条提醒已过期"，旧逻辑只有 1。

**顺手补的洞（同一轮）**：`armReminders` 原先"别的家庭不动"，可归档/退出家庭根本不会去重算
那个家庭的排期——于是名单里已经没有这个家了，锁屏还继续替它报时，最长响满三天。现在重排
时把账号当前的家庭名单一起交给它，不在名单里的那一家就地抹掉；`familyId` 允许为 null，
代表"最后一家也归档了"：没有哪一家要重建，但表还是得洗一遍。
两个前提是踩过来的：① 家庭名单必须先在手（冷启动时 `families` 是空的而 `currentFamilyId`
从 storage 读回来了），拿一份空名单当"名下没有家庭"会把别的家庭还在响的推送清光，所以
读不到名单就直接 return，什么都不动；② 整块重建那一家时它自己的旧条目一律不留，
"别的家庭保留"只对名单里的那些成立。

H5 实证：给"每天该称重量"排上 19/20/21 号 21:00 三行，归档掉最后一家后重算，登记表空了。

### 踩过的坑，下次直接避开
- **`apps/api` 的常驻服务是 `node apps/api/dist/main.js`，改 `src` 不会生效。**
  验证后端行为前先 `pnpm --filter @moonbud/api build` 再重启，否则会拿旧二进制下结论。
- **e2e 会 `TRUNCATE` 整个业务库**（`test/utils/db.ts`），现在跑的是 `.env.test` 里的
  `moonbud_test`，不再吃掉开发库；但那个测试库里的账号一样会被清掉，
  跑完 e2e 要重新注册才能做前端验证。
- `pnpm --filter @moonbud/api test`（非 e2e）匹配不到任何测试并以 1 退出——api 的测试
  全在 `test/*.e2e-spec.ts`，别把它当回归门禁。
- u-popup `mode="bottom"` 渲染的是 `.u-drawer-content.u-drawer-bottom`，底色来自
  `--u-bg-white`；只测 documentElement 上的变量会得出错误结论，要看弹层自己的计算样式。

