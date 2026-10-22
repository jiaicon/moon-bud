# 月芽 消息推送（uni-push 2.0 + 小米厂商通道）设计

日期：2026-10-21（同日重写） 状态：**已批准方向，本文是实现依据**
前置：`2026-10-16-moonbud-design.md` 第 6 节"阶段二"。
重写原因：初稿把"到点提醒"当作推送的主要收益，复核后这个判断是错的（见第 3 节）。

## 1. 意图

服务端每分钟扫描到期提醒实例并为收件人写 Notification，但**送达完全依赖设备自己醒着**：
`due-watch.ts` 每 60 秒轮询未读，`local-notify.ts` 在设备上排 `plus.push.createMessage`。
另一台手机不打开 App，就什么都不知道。

目标状态：家里的小米手机**划掉 App、躺在口袋里**也能收到月芽的通知。
在中国大陆的国产 ROM 上这只有一条路——厂商通道；而小米自 2025-06-09 起明文要求
"仅通过小米应用商店安全审核并在小米应用商店发布的应用才可使用推送服务"，
并允许"非公开上架"。用户已决定走**非公开上架**，因此本项目 = 代码 + 外部审核材料 两轨并行。

## 2. 到达路径的物理事实（决定了设计形状）

| | 谁弹 | App 被划掉后 | 依赖 |
|---|---|---|---|
| 本地定时 `plus.push.createMessage(when)` | 设备自己的 AlarmManager | **多数情况仍能弹**，前提是 MIUI 允许自启动 + 省电策略"无限制" | 无需网络、无需任何账号；前提是 App 至少打开过并武装了排程 |
| 个推自有通道（uni-push 2.0，`offline:false`） | 长连接在线消息 | **收不到**（长连接随进程死） | 个推凭证，已开通 |
| 小米厂商通道（`offline:true`） | 系统级推送 | **能收到** | 上架 + 开通推送 + 消息分类审批 |

厂商通道的条数限制（小米原文数字，2026-10 现行）：
- 未分类应用走默认通道：**单应用单设备单日 1 条**，超出返回 `exceed quota` 被静默吞掉。
- 公信消息：无新闻许可 **5 条/设备/天**。
- **私信消息（系统/提醒类）：不限量**，但需在小米推送运营平台申请分类，且 2026-07-01 起
  接入的应用**必须用模板下发私信**。

月芽的喂奶提醒按 2 小时周期 = 一天最多 12 条 → **不拿"私信/不限量"分类就会被限额吃掉**。
这条必须在第 5 节的外部流程里排上，不是可选项。

## 3. 为什么"到点提醒"不该由推送发（默认关闭）—— **2026-10-22 真机推翻，现已改为默认开启**

本地定时在到达能力上**优于**服务端推送：更准时（不等服务端 cron 的那一分钟）、
更抗杀（AlarmManager 不依赖 App 进程）、且不依赖网络。而两条路径都对同一条提醒说话时，
Android 通知栏会**弹两次**——通知 id 分别由 DCloud SDK 和厂商通道生成，我们无法对齐它们做去重，
本地定时通知在系统触发时也没有 JS 回调可供拦截（`local-notify.ts` 的 payload 里根本没有
`occurrenceId`，它的键是 `提醒id#时刻`）。

所以本设计的取舍：

- **到点提醒继续由本地定时负责**，服务端**不推送**这一类（`PUSH_REMINDER_DUE` 默认 `false`）。
- **服务端推送覆盖本地定时原理上覆盖不了的事件**：密码找回请求、入家申请（如有）、
  以及后续新增的协作类通知。
- 将来小米通道就绪、且证明"划掉后厂商通道能到、本地定时不能到"时，把 `PUSH_REMINDER_DUE`
  打开，同时让用户在设置里选择该设备是否继续武装本地排程（避免双弹）。这个开关本次只做
  成配置项，不做成界面。

这是本设计最关键的一条判断。若它是错的（比如 MIUI 划掉 App 时连 AlarmManager 也清掉，
实测到点不弹），代价是"到点提醒在划掉后缺失"——正是第 6 节 spike 要证伪的东西。

### 3.1 spike 的答复与改后的决定（2026-10-22，小米 / HyperOS，自有证书包）

上面那两条"本地定时更抗杀、更可靠"都**不成立**：

1. **排上就撤不掉。** 官方《Push 推送开发指南》里 `plus.push.clear()` 清的是"系统通知栏中
   属于当前应用的所有消息"，还没到点、压在队列里的那条它碰不到。实测"停掉提醒"之后旧时刻
   照响 —— 而"我已经叫它别再响了"是提醒功能最不能撒谎的一件事。（另一半是参数用错：
   `when` 只是消息上显示的时间戳，真正推迟显示的是 `delay`（秒），所以当时还同时表现为
   "保存即弹、到点不响"。）
2. **不抗杀。** 2 分钟后的本地提醒，划掉 App 后到点不弹，重新打开也不补 —— `delay`
   的定时器跟着进程一起没了。

服务端推送在这两条上都站得住：到点那一刻才决定发不发，停掉/改时间天然作废；而且覆盖
"这台设备今天根本没打开过"的家长。代价是准点性取决于服务端 cron 的那一分钟，以及划掉 App
后个推长连接断了同样收不到（那要小米厂商通道，仍在第 4 节的流程里）。

改后的决定：

- `PUSH_REMINDER_DUE` 默认 **`true`**，到点提醒由服务端推送发。
- 本地排程与推送的互斥**做成自动**，不做界面：`registerPushClient()` 把 cid 报进服务端成功
  → 关掉本地排期；拿不到 cid（H5、APK 没打 push 模块、上报失败）→ 本地排期兜底。
  开关在 `local-notify.ts` 的 `setLocalPushEnabled`，双弹从这一处关。
- "划掉后能不能收到"仍然由系统设置决定（自启动、省电无限制、最近任务锁定），写进
  BUILD.md 第 3 节交给用户；真要跨过这道墙只有小米厂商通道，也就是上架。

## 4. 外部流程（与代码并行，归用户）

| 步骤 | 产出 | 依赖 | 周期 | 费用 |
|---|---|---|---|---|
| A 软著登记（中国版权保护中心，个人实名） | 登记证书 | 源代码前后各 30 页 + 说明文档，**我准备** | 自办 30–60 工作日；代办加急 3–20 天 | 自办 0 官费 |
| B App 备案（腾讯云，与 ICP 同主体新增 App 项） | App 备案号 | 包名 `top.iconmen.yueya`、签名 MD5、服务器接入信息，**我提供** | 约 1–2 周 | 0 |
| C 小米开发者账号（个人实名）→ 创建应用 → **非公开上架** → 开通推送 | 小米 AppId / AppAppKey / AppSecret | A + B 的证书 | 商店审核 1–3 天 | 0 |
| D 小米推送运营平台申请**私信/服务类**分类 + 消息模板 | 通过的 category/channel id + 模板 id | C | 3–10 天 | 0 |
| E DCloud 开发者中心 → uni-push 2.0 → 厂商推送设置 填 C 的三项；manifest `offline:true`；重新云打包 | 带小米通道的 APK | C | 当天 | 0 |

A 与 B 可并行提交。第 6 节的代码不依赖 A–E 任何一步，可以先做完并用个推自有通道验证"发得出去"。

上架材料清单（隐私政策页、应用简介、截图、权限用途说明）由我起草，提交动作归用户。

## 5. 代码设计

### 5.1 数据层：设备标识

```prisma
model Device {
  id         String   @id @default(uuid()) @db.Uuid
  userId     String   @db.Uuid
  clientId   String   @unique             // 个推 cid；重装/清数据会变
  platform   String                       // 目前只有 'android'
  lastSeenAt DateTime @default(now()) @db.Timestamptz(3)
  createdAt  DateTime @default(now()) @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("devices")
}
```

- `clientId` 全局唯一 + upsert：一台设备只属于最后一个登录它的账号（家人共用过手机时，
  后登录者拿走它）。
- 注销是**删除该行**，且 **`where` 必须同时含 `clientId` 与请求者 `userId`**——否则 A 退出登录
  会把 B 已接管的设备删掉。
- 不存 `pushEnabled` 布尔：用户能关系统通知但关不掉 SDK，这个字段只会撒谎。
- e2e 库 truncate 列表加 `devices`（`apps/api/test/utils/db.ts`）。

### 5.2 服务端接口：`apps/api/src/devices/`

- `POST /api/devices/push-client` `{ clientId, platform }` → upsert 到 `@CurrentUser()`，返回 204。
- `DELETE /api/devices/push-client` `{ clientId }` → 按 (clientId, userId) 删除，返回 204。
- `GET /api/devices/push-clients` → 当前用户的设备列表（`clientId` 只回后 6 位，用于"我的"页
  排障和 e2e 断言）。
- 鉴权：全局 `JwtAuthGuard` 覆盖，不需要 `FamilyMemberGuard`（设备属于用户，不属于家庭）。
- DTO：class-validator，中文 `defaultMessage`；`clientId` 必填、8–64 字符；`platform` `@IsIn(['android'])`。

### 5.3 发送通道：`GetuiPushProvider`

实现**现有** `PushProvider` 接口，但接口要加一个字段用于第 3 节的分流：
`send(userId, title, body, data)` 里 `data.occurrenceId` 非空即"到点类"，provider 据此
决定是否发送。这样 `NotificationsService` 的业务代码仍然一行不改（接缝当初就是为此留的），
`notificationId` 不进 payload——反正没有接收方读它。

- 个推 REST API v2，base `https://restapi.getui.com/v2/${GETUI_APPID}`。
- 鉴权 `POST /auth`：`sign = sha256(appKey + masterSecret + timestamp)`；token 进程内缓存，
  收到鉴权类错误码时重取一次。单副本部署（当前 Docker 单实例），不做分布式锁。
- 单推 `POST /push/single/cid`，`audience: {cid:[…]}`，`settings.ttl` = 1 小时。
- **厂商通道参数预留**：请求体里为小米留出 `pushChannel`/分类字段的位置，值取自
  `XIAOMI_PUSH_CATEGORY`（未配置时不下发该字段）。第 2 节的限额说明这个接缝必须有，
  否则通道接通那天提醒仍被吞。
- 失败语义：个推返回非成功码 → `warn` 日志（含 cid 后 6 位、错误码，正文只记长度），
  **不向上抛**——一个人没设备不该中断整批 fan-out。已知代价：`tick()` 的 `finally` 无条件置
  `firedAt`，所以推送失败不重试（沿用既有设计，第 7 节）。
- 无 cid 的用户 → `debug` 日志后直接返回（H5 用户本来就没有设备，这不是错误）。

`push.module.ts` 改工厂：`GETUI_APPID/APPKEY/MASTER_SECRET` 三者齐全 → Getui，
缺任一 → `NoopPushProvider`，并在启动日志打印"推送通道：个推 / 未配置（只写日志）"，
让"为什么没收到"第一眼就能排除配置问题。

### 5.4 协作类通知接上推送

`reset-request.service.ts:94` 现在只写 Notification 不推送——找回密码的请求对管理员来说
**恰恰是最需要立刻到达的一类**。本次把它接上 `push.send`。同类还有未来的入家申请审批。

### 5.5 客户端（`#ifdef APP-PLUS`，H5 零变化）

- `apps/mobile/src/notifications/push-client.ts`：`registerPushClient()` 调
  `uni.getPushClientId()` → POST 上报；失败只 warn，不打断使用。
- 调用时机：登录成功后（`stores/auth.ts`）、冷启动已登录时（`App.vue` onLaunch）。
  cid 会变，所以每次冷启动重报，不做本地缓存比对。退出登录 → DELETE（带本地存过的 cid）。
- `uni.onPushMessage`：`type==='click'` 时按 payload 走现有落点分流（`routing.ts`）。
  注意：**没有"单条提醒详情页"**，到点类通知的落点是提醒页 tab——本次接受这个落点，
  不新增页面。
- manifest：本次保持 `offline:false`（厂商凭证还没下来），但把
  `usesCleartextTraffic` 改成 **false**（域名已 HTTPS，局域网调试需求已消失）。
  改完要重新云打包；APK 身份已固定在 `top.iconmen.yueya` + yueya 自有证书，签名不可再换。

### 5.6 配置

`.env`（本地 + 服务器 `/home/workspace/moon-bud/.env`）新增，值由用户后续补：

```
GETUI_APPID=
GETUI_APPKEY=
GETUI_MASTER_SECRET=
XIAOMI_PUSH_CATEGORY=
PUSH_REMINDER_DUE=true
```

`deploy/compose.prod.yml` 用 `${GETUI_APPID:-}` 形式透传（该文件现在的 `SCHEDULER_ENABLED: 'true'`
是硬编码字面量，没有可照抄的透传先例，这是新写法）。`.env.example` 同步补齐并写明
"留空则推送通道退回只写日志"。

## 6. 必须先做的 spike（在写 provider 之前，全部丢掉不进仓库）

真机装 `__UNI__9B2D760__20261021170135.apk`（已验签名 `0A:C3:D2…`、包名、个推 SDK 在包内），
回答三个问题：

1. **cid 能不能拿到**：`uni.getPushClientId()` 在自有证书包上返回什么（临时 showModal）。
2. **个推自有通道到底能不能弹**：curl 手工 `POST /auth` + `POST /push/single/cid`，
   在前台 / 后台 / 划掉三种状态下各试一次。
3. **MIUI 划掉 App 后本地定时还弹不弹**：设 2 分钟后的本地提醒 → 划掉 App → 看是否亮屏。
   这一条决定第 3 节是不是错的。**未做自启动/省电设置**和**做完之后**各测一次。

若 spike 结论与第 3 节矛盾（本地定时在划掉后不弹、而推送能弹），回来把 `PUSH_REMINDER_DUE`
的默认值改成 `true`，并设计本地排程与推送的互斥开关；其余代码不变。

**2026-10-22 三问的答复**（包 `__UNI__9B2D760__20261022144…`，含 `res.cid` 修复与 `delay` 修复）：

1. **cid 能拿到**。坑在字段名：成功回调给的是 `{ cid, errMsg }`（`@dcloudio/types` 的
   `GetPushClientIdSuccessData`），不是文档示例里的 `client_id`。读错键时单测全绿而服务端
   `devices` 表一条都没有，真机探针才揭穿。修好后生产库里落到了这台设备的 32 位 cid。
2. **个推自有通道能弹**：前台 curl 云函数 → 云函数回 `{"code":0}`、个推回
   `successed_online` → 手机横幅出现，点击按 `routing.ts` 分流。App 划掉时个推回
   `successed_offline`，横幅不来（没有厂商通道就没有离线到达）。
3. **划掉 App 后本地定时不弹，重新打开也不补。** 于是第 3 节被证伪，按上面那段话执行：
   默认值改 `true`，互斥开关做成"`registerPushClient` 报上 cid 就关本地"。

另外 spike 过程中钉住的一条 API 事实：`plus.push.clear()` 撤不掉**还没到点**的定时消息
（它清的是通知栏里已有的），这是"到点提醒不能交给本地"的直接原因。

**同日再补两条（决定"提醒轻不轻"）**：

4. **省电策略"无限制"下，App 退后台（不划掉）收得到**：同一枪在后台打仍回 `successed_online`，
   横幅、铃声、震动都有。所以"进程活着就能推"这条比原先估计的宽 —— 卡住的只有"划掉"。
5. **通知的响法由安卓 8+ 的通知渠道重要度决定，不由消息决定**。dumpsys 实测月芽名下只有一条渠道
   **`DcloudChannelID`**（`mOriginalImp=3` = 建的时候是默认档），表现就是"下拉面板躺一条、不弹不响不震"；
   把该渠道调到最高档，三种反馈一起出现。代码侧的对策是 `push-channel.ts`：冷启动就用
   `uni.getChannelManager().setPushChannel()`（平铺在 `uni` 上，**没有 `uni.push` 这个命名空间**）
   把**同一个 id** 建成 `importance:4 + 震动 + 锁屏可见` —— 安卓只承认建渠道那一刻设的重要度，
   App 事后改不动；而自创一个新 id 只会多建一条没人往里投通知的渠道。
   **未验**：卸载重装后新设备是否默认就响（这台机的旧渠道已被手动调高，验不出代码的功劳）。

## 7. 测试

- provider 单元（fetch mock）：sha256 拼接口径；token 过期重取一次；无 cid 不发请求；
  个推错误码不抛给调用方；请求体形状（cid 数组、ttl、厂商 category 有/无两种）；
  `data.occurrenceId` 非空且 `PUSH_REMINDER_DUE=false` 时不发。
- devices e2e：未登录 401；同 cid 重复上报幂等且只更新 `lastSeenAt`；A 的 cid 被 B 接管后
  A 的 DELETE 删不掉；DELETE 后设备列表为空；GET 返回的 cid 已脱敏。
- notifications e2e：fake provider 断言"某收件人无设备"不影响其余人；找回请求会产生一次 push 调用。
- 客户端纯函数单测：payload → 路由、cid 上报的状态迁移。
- 不做：不测真实到达（外部服务）；不打个推线上接口的集成测试。

## 8. 已知代价与反目标

- 推送失败不重试（`firedAt` 一旦置位即定案）；个推抖动那一分钟的提醒永久丢失，只剩通知中心兜底。
- 小米通道就绪前，"划掉也收到"不成立；就绪后，"限额"是新威胁（第 2 节），D 步没做完的
  那天，一天 12 条会被吞成 1 条。
- 反目标：**"看起来发送成功但其实手机上什么都没有"**。`NoopPushProvider` 的注释为此立过规矩。
  实现必须把"个推拿下了请求"和"设备大概率收到了"分开表达，绝不把 `is_success` 写成送达。
- 反目标：凭证进 git、进 APK、进聊天、进日志正文。宝宝名字出现在锁屏通知是用户自己的选择
  （保持现有 `buildBody` 文案），日志只记长度。
- 非目标：iOS/APNs、华为/OPPO/vivo/荣耀通道（家里主力是小米；其余品牌等小米这条链跑通再说）、
  微信订阅消息、推送富媒体、别名/标签/群推、送达回执统计。
