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
├─ docker-compose.yml postgres + api（**仅开发用**：发布 5433/3000，与线上那份是两套）
├─ deploy/            线上那份：compose.prod.yml + nginx 站点配置
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

## 部署到线上（腾讯云）

线上是一台 1.9G 内存的 Ubuntu（`ssh ubuntu@<服务器 IP>`，IP 不写进仓库），域名 `yueya.iconmen.top`。
**后端走 Docker 镜像，前端是一堆静态文件**，两条路互不相干：改了哪边就只跑哪边。

### 先认识三个词

| 词 | 是什么 | 这台机器上的对应物 |
|---|---|---|
| **容器** | 装好环境的小盒子，里面跑着程序 | `moonbud-postgres`（数据库）、`moonbud-api`（后端） |
| **镜像** | 造盒子的模板；改了代码要重做模板 | `moonbud-api:prod` |
| **compose** | 一份清单：起哪几个盒子、各给什么变量、数据存哪 | `deploy/compose.prod.yml` |

拓扑：nginx（系统服务，80/443）→ 静态文件 `/var/www/moonbud/h5`；`/api` 反代到 `127.0.0.1:3100` → api 容器 → postgres 容器（走内网名 `postgres:5432`，一个端口都不对外发布）。公网上除了 80/443，没有月芽的任何入口。

### 一、改了后端（`apps/api` 或 `packages/shared`）

**1. 本机提交。** 打包只认提交，不认没提交的改动。

**2. 打一个"代码包裹"并传过去。** GitHub 从那台机器连不上，所以不能 `git pull`；bundle 就是把一段 git 历史压成一个文件，解开后效果等同于拉取。

```bash
git bundle create /tmp/mb.bundle master          # 必须是分支名，不能是提交区间
scp /tmp/mb.bundle ubuntu@<服务器 IP>:/tmp/mb.bundle
```

**3. 服务器上的代码快进到新提交。**

```bash
cd /home/workspace/moon-bud
git fetch /tmp/mb.bundle master:refs/tmp/lat
git merge --ff-only refs/tmp/lat                 # 护栏：只许往前挪
git update-ref -d refs/tmp/lat
```

`--ff-only` 是关键：万一服务器上有人手改过代码造成分叉，它直接报错停下，而不是悄悄合出一个只有服务器独有的版本。

**4. 重做镜像，再用新模板换掉后端盒子。**

```bash
sudo docker compose --env-file .env -f deploy/compose.prod.yml build api
sudo docker compose --env-file .env -f deploy/compose.prod.yml up -d
```

- **`--env-file .env` 不能省。** compose 找 `.env` 的位置跟着清单文件所在目录走，不加它就去 `deploy/` 里找，然后以「JWT_ACCESS_SECRET is required」失败。
- 密钥只在**服务器仓库根的 `.env`**（不进 git），清单里出现的只是变量名。哪一项留空会关掉哪条通道，都写在 `deploy/compose.prod.yml` 的注释里。
- `up -d` 只重建**内容有变化**的那个盒子，数据库盒子不动、数据原样待着。
- **改了表结构不需要任何单独步骤**：镜像的启动命令是 `prisma migrate deploy && node dist/main.js`，第 4 步盒子起来时顺手把库结构对齐了。

### 二、改了前端（`apps/mobile`）

前端完全不进 Docker。编译 → 打包 → 传 → 换目录。

```bash
cd apps/mobile && pnpm build:h5                  # 读 .env.production，产物在 dist/build/h5
tar -czf /tmp/mbh5.tgz -C dist/build/h5 .
scp /tmp/mbh5.tgz ubuntu@<服务器 IP>:/tmp/
```

```bash
cd /var/www/moonbud
sudo mv h5 h5.old-<日期>                          # 先留旧的一份，退路就是这一行反过来
sudo mkdir h5
sudo tar -xzf /tmp/mbh5.tgz -C h5
sudo chown -R www-data:www-data h5
```

用户下次打开页面就是新版；nginx 那边什么都不用改（`index.html` 已设成 `no-cache`，带哈希的 `/assets/` 走 30 天长缓存）。

### 三、每次部署完必须亲眼读到的四条

```bash
sudo docker ps                                          # 两个盒子都该是 Up
sudo docker logs --tail 40 moonbud-api                  # 迁移结果 + 推送/助手两行的通道状态
curl -s https://yueya.iconmen.top/api/health            # {"status":"ok","db":"up"}
curl -s -o /dev/null -w "%{http_code}\n" https://yueya.iconmen.top/
```

### 四、回滚

- **前端**：`sudo rm -rf /var/www/moonbud/h5 && sudo mv /var/www/moonbud/h5.old-<日期> h5`，一秒。
- **后端**：把代码退回上一个提交，重跑第一节的第 2～4 步。
- 只想重启服务、不动数据：`sudo docker compose --env-file .env -f deploy/compose.prod.yml restart api`。

### 五、三条别踩

1. **`down -v` 里的 `-v` 会把数据库整个删掉**（`down` 不带 `-v` 是安全的）。
2. **别在服务器上直接改代码** —— 那会让它和 master 分叉，下次部署在第 3 步被 `--ff-only` 挡回来。要验证想法就在本机改完打包过去。
3. **别 `docker system prune --volumes`** —— 那条会连数据卷一起清，等于第 1 条。

### 数据存在哪、有几份

Postgres 用的是 compose 声明的**命名卷**，宿主机路径 `/var/lib/docker/volumes/moonbud_moonbud-pgdata/_data`（在根分区上）。含义：删代码目录、重建镜像、换前端都碰不到它；但它**在 Docker 那棵树里**，所以第 1 和第 3 条那种带 `-v` 的命令能把它删掉。

**目前全库只有一个副本**——这台机器上的这个卷，没有任何定时备份。要恢复只能靠 `pg_dump`：

```bash
sudo docker exec -i moonbud-postgres pg_dump -U <用户> -d <库> -Fc -f /tmp/backup.dump
sudo docker cp moonbud-postgres:/tmp/backup.dump /home/ubuntu/
```

（`docker exec` 后面那个 `-i` 是必需的，少了它 stdin 会被丢掉。）库名与用户名在容器环境变量里：`sudo docker exec moonbud-postgres printenv POSTGRES_DB POSTGRES_USER`。

---

## 已知环境差异（都是实测结论，不是猜测）

- **宿主 Postgres 端口是 5433，不是 5432。** 这台机器上已有本地 `postgresql-x64-18` 服务占用 5432；容器若也发布到 5432，宿主的连接会被**本地实例**接走，报出 `role "moonbud" does not exist` —— 一个完全指不到真实原因的错误。容器内始终是 5432，compose 里的 `api` 服务用服务名 `postgres:5432`。
- **API 镜像的基础镜像是 `node:22-alpine`，不是 24。** Docker Hub 在本机不可达（`connectex: connection actively refused`），只有缓存里已有的镜像可用。22 满足全部依赖（bcryptjs 是纯 JS，无 ABI 问题），宿主开发仍在 Node 24 上。Hub 可达后改一行即可。
- **`docker compose build api` 在本机尚未成功过一次。** 每次失败的都不是配置本身，而是容器内的依赖下载：Docker Hub 不可达，容器里抓包极慢（有一次跑到约 45 分钟仍近乎零 CPU，属停滞而非计算），已终止。本机因此没有 `moonbud-api` 镜像，后端在本机以 `node dist/main.js` + 真实数据库验证（`/api/health` 200、未知路由 404）。**服务器上这条路已经跑通过很多次**（Dockerfile 里那些换镜像源、装 openssl、全局装 prisma 的写法都是被真实报错逼出来的），线上部署见上面「部署到线上」一节。
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
