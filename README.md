# moonBud

多个家庭成员**共同照护同一个孩子**的记录与提醒 APP。

要解决的问题：几个大人一起带一个娃时，"谁喂过了、上次睡多久、下次疫苗什么时候"靠微信群和记忆传递，人一多就必然错乱——重复喂、漏喂、互相以为对方做了。市面上多数育儿 APP 面向**单个家长自己记录**，协作只是薄薄一层分享；moonBud 把协作与提醒做成核心。

设计文档：`docs/superpowers/specs/2026-10-16-moonbud-design.md`（意图、领域模型、权限、数据模型、已定的取舍都在里面）。

---

## 仓库结构

```
moonBud/
├─ apps/
│  ├─ api/            NestJS 后端（Prisma + PostgreSQL 16）
│  └─ mobile/         uni-app 客户端（Vue3 + TS + uView Pro）
├─ packages/shared/   唯一共享契约：记录类型的 zod 校验 + API 类型
├─ docs/superpowers/  设计文档与实施计划
├─ docker-compose.yml postgres + api
└─ .env.example       环境变量样例
```

`packages/shared` 是后端与前端**唯一的共同来源**：8 种记录类型的 payload 校验规则（zod）、由 schema 推导的 TS 类型、账号规则、时间线/提醒的 DTO、时区感知的 RRULE 计算。后端用它校验 `events.payload`，前端用它生成动态表单字段与本地校验。改记录类型只改这一处。

---

## 快速开始（后端）

### 1. 前置条件

| 需要 | 版本 | 说明 |
|---|---|---|
| Node.js | ≥ 24 | |
| pnpm | ≥ 10 | `corepack enable` 可装 |
| Docker Desktop | 已安装**并已启动** | 第 4 步要用；未启动时 `docker` 会报连不上 `dockerDesktopLinuxEngine` |

### 2. 准备环境变量

```bash
cp .env.example .env
```

每个变量的含义（`.env.example` 里有同样的注释）：

| 变量 | 用途 |
|---|---|
| `PORT` | API 监听端口，默认 3000 |
| `NODE_ENV` | `development` / `production` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose 里 postgres 容器的初始化参数 |
| `DATABASE_URL` | **宿主进程**连库用。注意端口是 **5433**，见下方"已知环境差异" |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | 双 token 签名密钥。**生产必须换成随机值**：`openssl rand -hex 32` |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | access 2h、refresh 30d。access 只存在内存，refresh 存本地 |
| `SCHEDULER_ENABLED` | 每分钟提醒扫描的开关。**生产必须为 `true`**，否则提醒不触发；e2e 里被 `test/setup-env.ts` 强制设为 `false` |
| `UNICLOUD_PUSH_URL` / `UNICLOUD_PUSH_TOKEN` | uni-push 2.0 的服务端出口：我们自己 URL 化的 uniCloud 云函数地址，以及两侧约定的共享密钥（云函数那侧叫环境变量 `PUSH_TOKEN`）。**两项齐了才启用推送**，缺任一项即退回只写日志，启动日志会写明用的是哪条通道。2.0 不允许服务端直连个推 REST，所以没有个推凭证这几项，见 `apps/mobile/BUILD.md` 第 7 节 |
| `PUSH_REMINDER_DUE` | 到点提醒是否由服务端推送。**默认 `true`**（2026-10-22 真机改判：`plus.push` 的定时消息排上就撤不掉、划掉 App 就整个不响，见 spec 第 3 节）。客户端在 cid 报进服务端成功的那一刻关掉本机排期，所以不会双弹；报不上 cid 的设备（H5、APK 未打 push 模块）仍由本地排期兜底。设成 `false` 则服务端跳过这一类，只剩本地定时 |

### 3. 装依赖

```bash
pnpm install
```

### 4. 起数据库

```bash
pnpm docker:up          # 等价于 docker compose up -d postgres
```

### 5. 建表

```bash
pnpm --filter @moonbud/api exec prisma migrate deploy
```

### 6. 起 API

```bash
pnpm dev:api            # nest start --watch
```

### 7. 确认活着

```bash
curl http://localhost:3000/api/health
# {"status":"ok","db":"up"}
```

`db` 为 `down` 时返回 503 —— 说明库没起或 `DATABASE_URL` 不对。

### 8. 打开接口文档

浏览器打开 <http://localhost:3000/api/docs>（Swagger UI）。OpenAPI JSON 在 `/api/docs-json`。

注意路径里带 `api`：Swagger 挂的是独立中间件，不经过 `setGlobalPrefix('api')`。

### 9. 跑测试

```bash
pnpm test:api           # 后端 e2e，跑在真实 PostgreSQL 上
pnpm test:shared        # 共享契约单测
```

后端 e2e **不用 sqlite 替身**：JSONB、`unique` 约束、`timestamptz` 的行为必须真实，替身会把这些差异藏起来。因此第 4 步的数据库必须先起来。

e2e 每个 suite 都会 `TRUNCATE` 全部业务表，所以它**只连 `.env.test` 里指定的独立测试库**（`test/setup-env.ts` 少了这个文件就当场报错，绝不退回第 4 步那份开发 `.env`）。第一次跑之前建一次：

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres \
  -c "CREATE DATABASE moonbud_test OWNER \"$POSTGRES_USER\";"
echo "DATABASE_URL=postgresql://<用户>:<密码>@localhost:5433/moonbud_test" > .env.test
set -a; . ./.env.test; set +a                             # prisma CLI 只认环境变量
pnpm --filter @moonbud/api exec prisma migrate deploy   # 在测试库里建表
```

`.env.test` 已在 `.gitignore` 里（里面有密码），也别把它指向开发库。

---

## 常用脚本

| 命令 | 作用 |
|---|---|
| `pnpm docker:up` / `pnpm docker:down` | 起 / 停 postgres 容器 |
| `pnpm dev:api` | 后端开发模式（watch） |
| `pnpm test:api` | 后端 e2e（需数据库） |
| `pnpm test:shared` / `pnpm build:shared` | 共享包单测 / 构建 |
| `pnpm dev:app` | 客户端 H5 预览（唯一不需要 HBuilderX 的界面通路） |

---

## 移动端（`apps/mobile`）

uni-app（Vue3 标准版）+ uView Pro + Pinia，一套代码覆盖 H5 / 小程序 / App（Android、iOS、鸿蒙）。

```
pnpm --filter @moonbud/mobile dev:h5      # 浏览器预览，http://localhost:5173
pnpm --filter @moonbud/mobile test        # 逻辑单测（vitest，不需要后端）
pnpm --filter @moonbud/mobile type-check  # vue-tsc 全量类型检查
pnpm --filter @moonbud/mobile build:h5    # 生产构建，产物在 dist/build/h5
```

`apps/mobile/.env.development` / `.env.production` 已随仓库提交（里面没有密钥），改地址就是改这两个文件。

三个必须知道的点：

- **后端地址只能来自 `VITE_API_BASE_URL`**，缺配置会在启动时直接抛错而不是回退到 localhost —— 回退在真机上表现为"莫名连不上"。浏览器里 `127.0.0.1:3000/api` 够用，**真机必须换成开发机的局域网 IP**（详见 [`apps/mobile/BUILD.md`](apps/mobile/BUILD.md) 第 1 节）。
- **APK 出不了命令行。** `build:app` 只产出打包资源，签名 APK 必须由 HBuilderX 走云打包；因此本仓库的全部验证止于浏览器，真机行为（本地通知、扫码、明文 HTTP）要等你按 BUILD.md 出包后才算验证过。
- **验收标准定在 Android。** iOS 需要开发者账号，鸿蒙需要 DevEco Studio 且不支持 `plus` API（本地通知在鸿蒙上直接不可用，提醒只走站内提醒中心）—— 两者都是兼容性目标，不是验收目标。

页面清单、主题系统（4 套预设 + 明/暗/自动，全部走语义 CSS 变量，禁止字面色值）、游客只读预览等行为，见 `docs/superpowers/specs/2026-10-16-moonbud-design.md` 第 7、9 节。

---

## 已知环境差异（都是实测结论，不是猜测）

- **宿主 Postgres 端口是 5433，不是 5432。** 这台机器上已有本地 `postgresql-x64-18` 服务占用 5432；容器若也发布到 5432，宿主的连接会被**本地实例**接走，报出 `role "moonbud" does not exist` —— 一个完全指不到真实原因的错误。容器内始终是 5432，compose 里的 `api` 服务用服务名 `postgres:5432`。
- **API 镜像的基础镜像是 `node:22-alpine`，不是 24。** Docker Hub 在本机不可达（`connectex: connection actively refused`），只有缓存里已有的镜像可用。22 满足全部依赖（bcryptjs 是纯 JS，无 ABI 问题），宿主开发仍在 Node 24 上。Hub 可达后改一行即可。
- **`docker compose build api` 尚未成功过一次。** 每次失败的都不是配置本身，而是容器内的依赖下载：Docker Hub 不可达，容器里抓包极慢（有一次跑到约 45 分钟仍近乎零 CPU，属停滞而非计算），已终止。**当前没有任何 `moonbud-api` 镜像。** 后端在本机以 `node dist/main.js` + 真实数据库验证过（`/api/health` 200、未知路由 404），未验证的是镜像构建与容器内的 `prisma migrate deploy`。Hub 或镜像源通畅后重跑即可，Dockerfile 本身没有已知缺陷。
- 依赖走 npmmirror 镜像（`.npmrc`）。容器内 corepack 也会抓 pnpm，所以 Dockerfile 里额外设了 `COREPACK_NPM_REGISTRY`。

---

## 已知限制（产品层面，照设计文档第 17 节）

1. **APP 完全关闭时收不到推送。** v1 只有：每分钟服务端扫描生成站内通知、APP 打开时的应用内提醒、以及 APP 平台上的本地定时通知。要"关着也能收到"需要你开通 **uni-push 2.0** 并填入凭证；代码里已留好 `PushProvider` 接口（当前是 `NoopPushProvider`，只写日志），届时加一个实现即可，业务代码不动。
2. **没有邮箱 / 短信。** 登录只用账号 + 密码，邮箱与手机号是可选联系方式，不参与鉴权、不发验证码。
3. **忘记密码没有万能通路。**
   - 记得旧密码 → 「我的 → 账号安全 → 修改密码」。
   - 忘了，但所在家庭里还有别的成员 → 由该家庭的 ADMIN/OWNER 在成员页发起"重置密码"，系统给出**一次性临时密码**，当面告知本人，登录后强制修改。
   - 忘了，且不属于任何家庭（或家庭里只剩自己）→ **无自助通路**。`POST /api/auth/reset-request` 只登记一条待处理请求，不自动处理。这是账号密码方案的固有代价。
4. **家庭不能被删除，只能归档。** 一个家庭可能积累数年的记录，硬删除会级联清空 children / events / reminders，直接违背"记录丢失不可接受"这条反目标。归档后家庭从列表移除、成员读写返回 403，数据完整保留。
5. **记录不能按条设隐私。** MEMBER 默认能看家庭全部记录；角色分层（OWNER/ADMIN/MEMBER）已经有了，按记录粒度的可见性模型不在 v1。
6. **无实时同步。** 没有 WebSocket，数据新鲜度靠下拉刷新。照护节奏是分钟到小时级，"爸爸刚喂过奶、妈妈打开能看到"用刷新就够。
7. **v1 不做的**：育儿知识库（底部第 5 格只留占位常量，不加空页面）、聊天、相册、统计图表、第三方登录、付费订阅。
8. **客户端只在浏览器里验证过。** 本机没有 HBuilderX / DevEco Studio，APK / IPA / HAP 必须由你在 HBuilderX 里"发行"生成——这是 uni-app 官方设计的限制，命令行只能产出 app 打包资源，出不了签名安装包。**验收标准定在 Android**；iOS 与鸿蒙是兼容性目标（官方自己写明鸿蒙"能用，有坑，建议降低期望"）。

---

## 后端接口约定

统一前缀 `/api`。分页 `?page=1&pageSize=20`，响应 `{ items, total, page, pageSize }`。错误响应 `{ statusCode, message, error }`。

**家庭上下文走 URL 路径**：`/api/families/:familyId/children`，而不是塞进 token。一个用户可同时属于多个家庭，把"当前家庭"写进 token 会导致切家庭要重新签发 token。

鉴权是 access（短，仅内存）+ refresh（长，本地存储）双 token。每个涉及家庭的接口都由 `FamilyMemberGuard` 校验 `(familyId, userId)` 是否存在于 `family_members` —— **权限判断只有这一处**，不散落到 service 里（散落的权限判断是权限漏洞的第一来源）。

完整的端点清单见 Swagger（第 8 步）。
