# moonBud 设计文档

日期：2026-10-16
状态：待用户确认
定位：多个家庭成员共同照护同一个孩子的记录与提醒 APP

---

## 0. 环境侦察结论（先读这一节，它约束了后面所有决定）

在本机实测得到的结论，直接影响"能不能真的做出 APP"：

| 检查项 | 结果 | 影响 |
|---|---|---|
| Node.js | v24.1.0 ✅ | 可跑后端与前端编译 |
| npm / pnpm | 11.3.0 / 10.18.3 ✅ | 可管理依赖 |
| Docker CLI | 29.7.2 + Compose v5.3.1 ✅ | 命令可用 |
| **Docker 守护进程** | **未运行** ❌ | `docker` 命令报 `failed to connect ... dockerDesktopLinuxEngine`，必须启动 Docker Desktop |
| Git | 2.50.1 ✅ | 可初始化仓库 |
| **HBuilderX** | **未安装** ❌ | **无法生成 APK / IPA / HAP**（见 12 节） |
| **JDK** | **仅 1.8.0_144**（`C:\ProgramData\Oracle\Java\javapath`）❌ | 太旧，Android 构建需要 JDK 17 |
| Android SDK / adb | 未安装 ❌ | 无法用命令行连真机调试 |
| **DevEco Studio** | **未安装** ❌ | **无法构建鸿蒙包** |
| D: 可用空间 | 400.8 GB ✅ | 充足 |
| npm registry | npmmirror 镜像 ✅ | 国内下载正常 |

**由此得出的一条硬边界，必须写在你心里：**

我可以独立完成**后端 + 数据库 + 前端全部业务代码**，并且用 `npm run dev:h5` 在浏览器里给你看真实界面（这是这套技术栈唯一不需要额外软件的预览通路）。但 **APK / IPA / HAP 安装包必须由你在 HBuilderX 里点"发行"生成** —— 这不是我的能力限制，是 uni-app 官方设计的限制，命令行只能产出 app 打包资源、不能出签名安装包。

项目路径 `D:\mine\moonBud`（18 字符）满足鸿蒙对路径长度的要求（官方建议 ≤77 字符且不含中文），这点安全，无需额外配置。

**另见第 17 节阻塞项清单**——其中第 1 项（启动 Docker Desktop）在开发开始时立刻需要。

---

## 1. 意图与为什么

**问题**：几个大人共同照护同一个孩子时，"谁喂过了、上次睡多久、下一次疫苗什么时候"这些信息靠微信群和记忆传递。人一多就必然错乱：重复喂、漏喂、重复买、互相以为对方做了。市面上多数育儿 APP 面向**单个家长自己做记录**，协作是一层薄薄的"分享"，而不是核心。

**moonBud 要解决的**：让**多个照护者围绕同一个孩子**保持信息一致。核心是协作与提醒，不是育儿知识。

**为什么不实时也没关系**：用户明确说"可以看到记录，也可以操作，但不需要实时"。照护场景的节奏是分钟到小时级，不是秒级。"爸爸刚喂过奶、妈妈打开 APP 能看到"用下拉刷新就够了。这砍掉了一整套 WebSocket/冲突合并的复杂度，是本次设计最大的简化来源。

---

## 2. 目标 / 非目标 / 反目标

### 目标（v1 必须做到）
1. 用户可注册登录，一个用户可属于**多个家庭**，可随时切换当前家庭。
2. 一个家庭围绕一或多个孩子组织；家庭成员**都能看、都能记**。
3. 记录类型覆盖照护高频项：喂奶、睡眠、换尿布、辅食、用药、体温、身高体重、里程碑。
4. 提醒：站内提醒中心 + 到点提醒；提醒可分派给某个成员或全家庭。
5. 通过二维码邀请他人加入家庭。
6. UI 精美，支持多套配色主题即时切换 + 跟随系统深色模式。
7. 安卓优先，代码同时兼容 iOS 与鸿蒙。

### 非目标（v1 明确不做，不要顺手做了）
- 育儿知识库（用户明确说放后面，底部导航仅预留占位）
- 实时同步、在线状态、正在输入提示
- 聊天 / 私信 / 动态流
- 相册与视频
- 数据统计图表（v1 只做时间线列表）
- 短信验证码、第三方登录
- 付费、订阅、多语言（除中文外的 i18n）

### 反目标（技术上跑通但算失败）
- **家庭成员看到彼此不该看到的内容**。角色权限如果有漏洞，这个产品在家庭场景里就是失败的，因为家庭内部也有隐私（例如保姆不应看到妈妈的个人备注）。
- **提醒不可靠**。一个会漏报疫苗时间的提醒功能，比没有提醒更糟——用户会依赖它。
- **记录丢失**。家庭记录是长期资产（几年），任何"刷新后记录没了"都是不可接受的失败。
- **添加记录要超过 3 步**。照护时人往往单手抱娃，多一步就会导致用户干脆不用。

---

## 3. 领域模型

四个核心概念，关系如下：

```
User（用户）──< FamilyMember >── Family（家庭）
                                    │
                                    └──< Child（孩子）
                                           │
                                           ├──< Event（记录）
                                           └──< Reminder（提醒）
```

- **User**：一个人。全局唯一，可属于多个家庭。
- **Family**：一个协作单元。有名称、创建者。所有业务数据都挂在家庭下。
- **FamilyMember**：User 与 Family 的关联，携带 **role**。这是权限的唯一来源。
- **Child**：家庭的照护对象。挂在家庭下，不直接挂用户。
- **Event / Reminder**：都挂在 Child 下，因此天然通过 Child 继承家庭的权限边界。

### 角色与权限

| 角色 | 查看 | 记录 | 提醒 | 邀请他人 | 编辑孩子 | 移除成员 | 解散家庭 |
|---|---|---|---|---|---|---|---|
| OWNER 创建者 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ADMIN 管理员 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅（除 OWNER） | ❌ |
| MEMBER 成员 | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

设计取舍：MEMBER 默认能看全部记录。**v1 不做"按记录粒度设隐私"**——那需要一整套可见性模型，成本远超越野。但角色分层必须现在就有，否则以后无法加。
`Owner 不可被移除`、`家庭至少保留一个 OWNER` 是两条必须强制的不变量。**最后一名 OWNER 不能退出家庭，只能转让或归档**（见第 4 节末）。

### 当前孩子（回答 builder check 第 5 问）

- "当前选中的孩子"存**本地**（`uni.setStorageSync`），且**按 familyId 分别存储**：`currentChildId:<familyId>`。理由：切换家庭是一等流程，不同家庭的孩子集合不同，共用一个全局值必然错位。
- 家庭有 ≥1 个孩子时：优先用本地记住的；若该孩子已归档或不属于当前家庭，回退到列表第一个。
- 家庭**零个孩子**时：首页不显示任何记录卡片，显示空状态 + 一个主按钮"添加孩子"，直接进入 `child-form`。**不允许进入没有孩子的记录页**——那会让用户面对一个没有主语的表单。

---

## 4. 数据模型

PostgreSQL + Prisma。表名用 snake_case，时间统一 `timestamptz`。

### users
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| username | text unique | **登录标识**。4–20 位，字母/数字/下划线，不区分大小写查重 |
| password_hash | text | bcrypt |
| nickname | text | 显示名，可重复 |
| email | text unique, nullable | **仅作联系方式**，不参与鉴权 |
| phone | text unique, nullable | **仅作联系方式**，不参与鉴权 |
| avatar_url | text nullable | |
| timezone | text | IANA 时区，如 `Asia/Shanghai`。注册时由客户端上报设备时区 |
| created_at / updated_at | timestamptz | |

**为什么 users 需要 timezone**：提醒默认取创建者时区（第 4 节 reminders.timezone）。没有这个字段，"默认取创建者时区"就没有取值来源。注册时用客户端设备的 IANA 时区写入，之后可在"我的"里修改。

**为什么 email / phone 保留但不鉴权**：它们是用户自愿填的联系方式，v1 不用它们登录、不发验证、不做找回。保留字段是给将来接邮件或短信留位置，避免以后加字段要迁移已有数据。**用户可以不填**——注册只需 `username + password + nickname`。

### families
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| name | text | 如"我们家" |
| owner_id | uuid FK→users | 冗余记录，便于查询 |
| archived_at | timestamptz nullable | 归档。**家庭永不硬删除**，见下 |
| created_at / updated_at | timestamptz | |

### family_members
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| family_id | uuid FK→families | |
| user_id | uuid FK→users | |
| role | enum(OWNER/ADMIN/MEMBER) | |
| display_name | text nullable | 在此家庭内的称呼，如"奶奶" |
| joined_at | timestamptz | |
| | unique(family_id, user_id) | 防重复加入 |

### children
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| family_id | uuid FK→families | |
| name | text | |
| gender | enum(MALE/FEMALE/UNKNOWN) | |
| birthday | date | |
| avatar_url | text nullable | |
| archived_at | timestamptz nullable | 软删除，保留历史记录 |

### events（记录）— 关键设计决定
**一张表 + JSONB，而不是每种记录一张表。**

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| child_id | uuid FK→children | |
| family_id | uuid FK→families | 冗余，用于高效按家庭查询与鉴权 |
| type | text | `feeding` / `sleep` / `diaper` / `solid` / `medicine` / `temperature` / `growth` / `milestone` |
| occurred_at | timestamptz | 事情发生的时间（非录入时间） |
| ended_at | timestamptz nullable | 睡眠等有区间的事件 |
| payload | jsonb | 类型专属字段 |
| note | text nullable | 自由备注 |
| created_by | uuid FK→users | 谁记的 |
| updated_by | uuid FK→users nullable | 谁最后改的。家庭记录需要可追溯"这条被谁动过" |
| deleted_at | timestamptz nullable | 软删除。见下方说明 |
| created_at / updated_at | timestamptz | |

索引：`(family_id, occurred_at DESC)`、`(child_id, occurred_at DESC)`、`(child_id, type, occurred_at DESC)`、`(child_id, type, occurred_at DESC) WHERE deleted_at IS NULL`（部分索引，服务"最近一次喂奶"这类查询）

**事件一律软删除**。理由：家庭记录是长期资产，硬删一条"上次喂奶时间"会让后续记录的连续性失去解释依据；而记错、点了删除是常态。软删除让"谁删了什么"可查、可恢复。所有查询默认加 `deleted_at IS NULL`。

### 谁能改删记录（回答 builder check 第 4 问）

| 操作 | 允许谁 |
|---|---|
| 新增记录 | 全体成员（MEMBER 及以上） |
| 编辑 / 删除记录 | **记录创建者本人**，或 ADMIN / OWNER |

理由：不采用"谁都能改任何一条"。在家庭场景里，让一个临时来帮忙的亲戚能删掉妈妈几个月的记录，风险远大于便利。ADMIN/OWNER 保留修正权限，覆盖"记错了但记录人已不在"的情况。此规则在 RBAC 守卫里实现，与角色检查同一处，不散落到 service。

**payload 按类型的约定：**

| type | payload 字段 |
|---|---|
| feeding | `{ method: 'breast'\|'bottle'\|'formula', side?: 'left'\|'right'\|'both', amountMl?: number, durationMin?: number }` |
| sleep | `{ quality?: 'good'\|'fair'\|'poor' }`（起止用 occurred_at / ended_at） |
| diaper | `{ kind: 'pee'\|'poo'\|'mixed', color?: string, texture?: string }` |
| solid | `{ food: string, amountDesc?: string, reaction?: string }` |
| medicine | `{ name: string, dose: string, route?: string }` |
| temperature | `{ celsius: number, site?: 'axillary'\|'ear'\|'forehead'\|'rectal' }` |
| growth | `{ weightKg?: number, heightCm?: number, headCm?: number }` |
| milestone | `{ title: string, description?: string }` |

**必须做的事**：在代码里为每种 type 定义校验 schema（推荐 zod）。JSONB 的代价就是数据库不再帮你保证结构，**这个校验层不是可选项**，否则半年后数据会烂掉。

**为什么这样设计**：育儿记录种类一定会加（第一次翻身、刷牙、看医生……）。每加一种就改表结构，是这类应用最常见的维护灾难。JSONB 让加类型变成改一处 zod schema + 前端加一个表单。

### reminders
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| family_id | uuid FK→families | |
| child_id | uuid FK→children nullable | 可为家庭级提醒（如"交疫苗本"） |
| title | text | |
| note | text nullable | |
| type | enum(ONE_TIME/RECURRING) | |
| due_at | timestamptz nullable | ONE_TIME 用 |
| rrule | text nullable | RECURRING 用，iCal RRULE 格式 |
| timezone | text | **重要，见下** |
| assignee_id | uuid FK→users nullable | null = 全家庭 |
| status | enum(ACTIVE/DONE/CANCELLED) | |
| created_by | uuid FK→users | |
| created_at / updated_at | timestamptz | |

**时区必须存**：提醒"每天早上 8 点"对驻外的家人和一个在老家带娃的奶奶，8 点指的不是同一时刻。存 `timezone`（IANA 格式如 `Asia/Shanghai`），计算下次触发时按该时区解析。v1 默认取创建者时区，允许提醒级覆盖。

### reminder_occurrences（提醒实例）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| reminder_id | uuid FK→reminders | |
| due_at | timestamptz | 本次应触发时间 |
| fired_at | timestamptz nullable | 实际生成通知的时间 |
| status | enum(PENDING/DONE/SKIPPED) default PENDING | 本次实例的状态 |
| completed_by | uuid FK→users nullable | 谁完成的这一次 |
| completed_at | timestamptz nullable | |
| | unique(reminder_id, due_at) | 幂等，防重复触发 |

**为什么要单独一张实例表**：重复提醒需要"每次触发"的独立状态（谁完成了这次、这次是否已通知）。直接改 `reminders.due_at` 会丢失历史，且无法做幂等。

### 重复提醒的语义（回答 builder check 第 2 问）

这一节把最容易搞错的行为定死：

| 情形 | 行为 |
|---|---|
| `POST /reminders/:id/complete` 作用于 **ONE_TIME** | 该 reminder 置 `status=DONE`；其唯一 occurrence 置 `DONE` |
| 同上作用于 **RECURRING** | **只完成本次 occurrence**，系列继续。`reminders.status` 保持 `ACTIVE` |
| 如何停止整个重复系列 | 只能 `status=CANCELLED` 或删除 |
| 调度推进方式 | **不预生成未来实例**。每分钟扫描时，对每个 ACTIVE 的 RECURRING reminder，用 RRULE 从 `max(已生成 due_at) + 1秒` 起算，生成所有 `due_at <= now()` 且尚未存在的实例。靠唯一约束保证幂等 |
| 为什么按需生成而非预生成 N 个 | 预生成数量无法确定（用户可能三个月不看），且改计划时要清理已生成的行。按需生成让"改计划"只需改 reminder 一行 |
| 编辑提醒的计划（`due_at` / `rrule` / `timezone`） | **删除该提醒所有 `status=PENDING` 且 `due_at > now()` 的实例**，然后按新计划重新生成。已完成（DONE）与已过去（SKIPPED）的实例**保留**，因为它们是历史 |
| 取消或删除提醒 | `reminders.status=CANCELLED`（软）。**已 DONE 的实例保留**，从提醒列表的"已完成"中仍可见；未触发的 PENDING 实例一并置 `SKIPPED` |
| "已过期"如何判定 | `status=PENDING AND due_at < now()`（查询时计算，不落库） |

**`completed_by` 的意义**：这是协作功能的核心数据。"疫苗这次是谁带去的"必须能回答，否则多个照护者之间会互相以为对方做了——这正是第 1 节定义的问题本身。

### notifications（站内通知）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK→users | 收件人 |
| family_id | uuid FK→families | |
| occurrence_id | uuid FK→reminder_occurrences nullable | |
| title / body | text | |
| read_at | timestamptz nullable | |
| created_at | timestamptz | |

索引：`(user_id, read_at, created_at DESC)`

### family_invites
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| family_id | uuid FK→families | |
| code | text unique | 短码，如 8 位大写字母数字 |
| role | enum(ADMIN/MEMBER) | **邀请者不能通过邀请产出 OWNER** |
| created_by | uuid FK→users | |
| expires_at | timestamptz | 默认 7 天 |
| max_uses | int | 默认 1，可设更大 |
| used_count | int default 0 | |
| revoked_at | timestamptz nullable | |

**安全要点**：`role` 在邀请上就固定，且**白名单只允许 ADMIN/MEMBER**——防止创建者误发一个能提权的邀请码。

### 家庭永不硬删除（回答 builder check 第 3 问）

原设计里的 `DELETE /api/families/:id` 已**从 v1 移除**。理由：一个家庭可能积累数年的记录，硬删除会级联清空 children / events / reminders，直接违背第 2 节"记录丢失不可接受"这条反目标。误点一下毁掉几年数据，风险与收益完全不成比例。

替代方案（v1 实现前两者）：

| 操作 | 语义 | 权限 |
|---|---|---|
| 归档家庭 | 置 `archived_at`。家庭从"我的家庭"列表移除，成员的读写接口返回 403；数据完整保留 | 仅 OWNER |
| 退出家庭 | 删除自己的 `family_members` 行。**若自己是最后一个 OWNER 则禁止**，需先转让 | 任何成员（最后 OWNER 除外） |
| 转让所有权 | 把 OWNER 交给另一名 ADMIN/MEMBER，自己降为 ADMIN | 仅 OWNER |
| 彻底删除数据 | **v1 不做**。将来若要做，必须先提供完整导出（JSON），再要求输入家庭名确认 | — |

归档后的 UI 含义：不出现在家庭切换列表；"我的"里提供"已归档家庭"入口可查看只读历史并申请恢复。**v1 只需保证归档不可逆地保留数据，恢复入口可延后**。

---

## 5. 系统架构

```
┌──────────────────────────┐        ┌───────────────────────────┐
│  uni-app 客户端           │  HTTPS │  NestJS API (Docker)      │
│  Vue3 + TS + uView Pro   │───────▶│  - JWT 鉴权               │
│  Android / iOS / 鸿蒙     │  REST  │  - RBAC 家庭权限守卫       │
│  （浏览器 H5 用于开发预览） │        │  - 定时任务（每分钟）       │
└──────────────────────────┘        └────────────┬──────────────┘
                                                 │ Prisma
                                                 ▼
                                    ┌───────────────────────────┐
                                    │  PostgreSQL 16 (Docker)   │
                                    └───────────────────────────┘
```

通信方式：**REST + JSON**，无 WebSocket（依据第 1 节）。数据新鲜度靠下拉刷新。

### 鉴权
- 登录返回 `access_token`（短，如 2h）+ `refresh_token`（长，如 30d）。
- 前端存 refresh_token 于 `uni.setStorageSync`，access_token 仅内存。
- 每个请求带 `Authorization: Bearer <access_token>`。
- **家庭上下文通过 URL 路径传递**：`/api/families/:familyId/children`，而不是靠 token 里的"当前家庭"。理由：一个用户同时在多个家庭，把当前家庭写进 token 会导致切家庭要重新签发 token。

### 登录标识：账号 + 密码（用户要求）

**v1 用「账号（username）+ 密码」登录。** 邮箱与手机号只是可选联系方式，不参与鉴权、不发验证码、不做找回。

这个选择的好处很直接：**不需要任何短信或邮件服务**，注册即用，家人拿到邀请码当场就能注册进入。这消除了前一版设计里"必须依赖邮件服务才能找回密码"的隐患。

**代价是：没有邮箱或手机号，就没有"凭据外的身份证明"。** 因此找回密码必须换一条路。v1 的规则如下：

| 情形 | 处理方式 |
|---|---|
| **记得旧密码** | `POST /api/auth/change-password`（**用户要求新增**）。需提交旧密码 + 新密码，校验后重新签发 token |
| **忘记密码，但在某个家庭里还有别的成员** | **家庭成员重置**：由该家庭的一名 ADMIN/OWNER 在成员页发起"重置密码"，系统生成一次性临时密码并展示给该成员，由他当面告知本人。首次登录后强制修改 |
| **忘记密码，且不属于任何家庭（或家庭里只剩自己）** | **无自助通路**。这是刻意接受的边界，登记为已知限制：`POST /api/auth/reset-request` 仅记录一条待处理请求（写日志 + 入库），不做自动处理 |

**为什么"家庭成员重置"是合理的设计而不是漏洞**：这个应用的数据本来就是家庭共享资产，家庭成员之间不存在需要防范彼此读取的秘密（第 3 节：MEMBER 默认能看全部记录）。用家庭内部的信任关系做身份兜底，与产品的信任模型一致。**但必须加两条约束**：

1. 重置只能由**同家庭的 ADMIN/OWNER**发起，且**不能重置自己的密码来绕过旧密码校验**（改自己密码必须走 `change-password`）。
2. 临时密码**一次性**：写入 `password_reset_token`（见下），登录成功后立即失效，并强制跳转修改密码页。

### 修改密码（用户要求新增）

- 端点：`POST /api/auth/change-password { oldPassword, newPassword }`
- 校验旧密码正确 → 更新 `password_hash` → **撤销该用户所有现存 refresh_token**（防止旧会话继续可用）→ 当前设备重新签发 token。
- 入口：「我的 → 账号安全 → 修改密码」。
- 密码规则：最短 8 位。不做复杂度强制（大写/符号），因为**强制复杂度会推动用户写下来或复用**，对家庭应用得不偿失；改为在弱密码（如 `12345678`、与账号相同）时给出提示但允许提交。

### password_reset_tokens（临时密码凭据）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK→users | |
| token_hash | text | 临时密码哈希，**不存明文** |
| issued_by | uuid FK→users | 哪个 ADMIN/OWNER 发起的 |
| expires_at | timestamptz | 建议 24 小时 |
| used_at | timestamptz nullable | 用过即失效 |

### RBAC 守卫
关键实现点：**每个涉及 family 的接口都必须校验 `family_members` 里存在 (familyId, currentUserId) 且 role 满足要求**。用 NestJS Guard 统一实现，禁止在 service 里手写散落判断——散落的权限判断是权限漏洞的第一来源。

---

## 6. 提醒机制（分阶段，不要混淆）

这是整个项目最容易高估的部分，明确切开：

### 阶段一（v1 必做，不依赖任何外部服务）
1. **调度**：NestJS `@Cron` 每分钟扫描 `reminders`，算出到期未生成的 occurrence，插入 `reminder_occurrences`，并为相关用户插入 `notifications`。
   - 幂等靠 `unique(reminder_id, due_at)`，重复跑不会重复通知。
   - recurrence 用 RRULE 库（如 `rrule`）按 `timezone` 展开。
2. **站内提醒中心**：客户端拉 `/api/notifications`，底部 Tab 显示未读红点。
3. **APP 打开时的应用内提醒**：客户端定时轮询 + 本地 `uni.showToast` / 弹窗。
4. **APP 关闭时的本地通知**（Android/iOS）：用 `plus.push.createMessage` 做本地定时通知，仅在 APP 平台可用。

### 阶段二（现在只留接口，不接通）
- 服务端推送到已关闭的 APP：需要 **uni-push 2.0** 或 **微信订阅消息**，两者都要求你在 DCloud / 微信开通服务并拿到凭证。
- 因此 v1 会定义 `PushProvider` 接口（`send(userId, title, body, data)`），只提供一个 `NoopPushProvider`（写日志）。将来加 `UniPushProvider` 即可，不改业务代码。

**必须向你复述的一句话**：v1 交付后，"APP 完全关闭时收到推送"**是不工作的**，直到你开通 uni-push 并填入凭证。

---

## 7. 主题与配色系统

要求"UI 精美、可切换配色"，因此主题是**一等功能**，不是设置里的彩蛋。

- 用 uView Pro 的 `useTheme` hook + `u-config-provider` 提供主题上下文（uView Pro 官方支持多主题与暗黑模式）。
- `src/theme/presets.ts` 定义 4 套预设，每套含语义色位：`primary / success / warning / error / background / surface / textPrimary / textSecondary / border`。
  - 建议预设：**晨雾蓝**（默认）、**奶油橘**、**薄荷绿**、**暮色紫**。
- 用户选择存本地 `uni.setStorageSync('theme')`，**不存服务端**。理由：这是个人设备偏好，不是家庭共享设置；存服务端会引出"家人切换主题要不要同步"这个无意义的问题。
- 支持"跟随系统"深色模式（uni-app 有 `uni.onThemeChange`）。
- 切换**即时生效**，不重启页面。
- **所有页面禁止写死颜色值**，一律引用主题语义变量。这是换肤功能能否长期成立的唯一保证——写死一个 `#2979ff`，那处就永远不会跟着主题变。

---

## 8. 二维码邀请流程

因为主流做法有差异，这里定死 v1 的方案：

1. 创建邀请：`POST /api/families/:familyId/invites` → 返回 `{ code, expiresAt }`。
2. 二维码内容：**HTTPS 落地页 URL**，形如 `https://<域名>/join?code=ABCD1234`。
   - 选它的理由：微信内可直接打开、不需要小程序码、不依赖任何平台审核。
   - 代价：扫码后先看到一个网页，再由网页引导打开 APP。
3. 落地页逻辑：显示家庭名与邀请人 → 已装 APP 则唤起 APP（`moonbud://join?code=` scheme），未装则提示下载。
4. 加入：`POST /api/invites/:code/accept` → 校验有效期、次数、未撤销 → 建 `family_members`。
5. 客户端也支持**手动输入邀请码**，因为扫码失败是常态。

**明确记为待办**：`https://<域名>` 需要你提供一个可访问的域名，或用 v1 的临时方案（落地页先本地跑起来，二维码指向局域网地址，仅同年家人测试用）。

### 应用标识（回答 builder check 第 8 问）

`manifest.json` 需要一个 **DCloud appid**，`moonbud://` 这个 URL scheme 也需要随应用一起注册。两者都要你有 DCloud 账号才能申请。

处理方式：

- v1 开发阶段用**占位 appid**，只跑 H5 预览，不受影响。
- 第 8 节第 3 步的"唤起 APP"在**占位状态下无法端到端验证**，只能验证到落地页正确解析 code。
- 需要**你去 DCloud 开发者中心注册账号并创建应用**，拿到 appid 后我填入 `manifest.json`，届时才能真正验证扫码 → 唤起 APP 的完整链路。
- 已加入第 17 节阻塞项。

---

## 9. 页面与导航

底部 Tab 固定 **4 格**：

| Tab | 内容 |
|---|---|
| 首页 | 今日概览（最近一次喂奶/睡眠距今多久）、快捷记录按钮、当前孩子切换 |
| 记录 | 时间线列表（按天分组）、筛选（类型/孩子/记录人）、新增记录 |
| 提醒 | 待办/已过期/已完成 分段、提醒中心（未读通知） |
| 我的 | 家庭管理、成员与角色、邀请二维码、主题设置、账号 |

**预留的第 5 格**（育儿知识）在 v1 不出现。实现方式：Tab 配置里留注释与占位常量，不加空页面——空页面比没有页面更容易让人误以为坏了。

页面清单：
- `welcome` 欢迎/落地页（**游客可见**，见第 9.5 节）
- `preview` 核心界面只读预览（**游客可见**，可切主题，不可操作）
- `login` 登录/注册
- `forgot-password` 忘记密码：说明联系家庭管理员重置，或提交找回请求
- `change-password` 修改密码（我的 → 账号安全）
- `family-select` 选择或创建家庭（多家庭时进入 APP 的第一步）
- `home` 首页
- `event-list` / `event-form` 记录列表与新增（`event-form` 按 type 动态渲染字段）
- `reminder-list` / `reminder-form`
- `notification-center` 提醒中心
- `family-settings` / `member-list` / `invite-qrcode` / `family-archive`
- `child-form` 新增/编辑孩子
- `theme-settings` 主题选择
- `join` 邀请落地页（H5 优先）

### 记录流程的硬指标
从首页到"记录已保存"**不超过 3 步**：首页快捷按钮 → 选类型（或直接是类型）→ 填最少字段 → 保存。
每个类型的表单只要求**一两个必填字段**（如喂奶只需 method，体温只需 celsius），其余可空。

### 防重复照护（回答 builder check 第 6 问）

第 1 节把"重复喂 / 漏喂"立为这个产品要解决的问题。如果 v1 只在时间线里陈列记录、不主动提示，那用户仍然要靠自己翻列表才能发现"爸爸 20 分钟前已经喂过"——**问题就没被解决**。因此这是 v1 的验收标准之一，不是打磨项。

**v1 必须实现**：进入 `event-form` 且已选类型（如喂奶）时，客户端查询该孩子**同类型最近一条记录**，若其 `occurred_at` 在当前时间之前 **N 分钟以内**（初始 N=90，可从设置调整），在表单顶部显示一条醒目提示：

> 爸爸 20 分钟前刚记过一次喂奶

**约束条件**（这几条决定了它不会变成骚扰）：

- 提示**不消耗额外步骤**：它出现在表单里，保存按钮照常可点。用户仍可记录（比如确实又喂了一次）。
- **不做阻断式弹窗**。阻断会让"双胞胎/加餐"这类正常情况变得难受。
- 查询用 `(child_id, type, occurred_at DESC) WHERE deleted_at IS NULL LIMIT 1`，走已有部分索引，不需要新接口——复用 `GET /events?childId=&type=&pageSize=1` 即可，但**必须带 `until=now()` 排除未来时间**（用户可补录过去时间，不能用"最新一条"直接判断）。

其余类型的提示阈值单独配置（如体温 120 分钟、用药 60 分钟），因为不同记录的合理间隔差别很大。

### 游客模式与注册引导（用户要求：先看到功能，再引导注册）

**不做"一进来就登录"**。理由：这是个家人共用的小工具，第一次打开的人还没看到任何价值就被要求填账号密码，是最典型的流失点；而且家人往往是**被邀请进来**的——他们需要先看到"这是个什么、我们家会得到什么"，才愿意注册。

因此启动流程改为：

```
首次打开 → welcome 落地页（游客可见，可切换主题）
              ├─ 「看看它能做什么」→ preview 界面预览（只读）
              ├─ 「我收到了邀请码」→ 输入邀请码 → 注册/登录 → 自动加入家庭
              └─ 「开始使用」→ 注册 → 创建家庭
```

**游客能看到什么**：完整的界面外观与功能说明，但**不可操作、不接触任何数据**。

- `welcome` 页展示 3 个价值点（多人协作记录 / 到点提醒 / 一起看得见）。
- **可切换配色在游客状态下就能试** —— 这是你要求的一等功能，让用户在注册前直接体验到真实效果（主题切换是纯前端行为，不涉及数据，所以**这一项是真交互而不是截图**）。这是最强的转化点。
- `preview` 预览页展示核心界面（首页、记录时间线、提醒、家庭），每屏配一句它能解决什么。

**preview 的具体形态（已定为"只读预览"）**：

- 展示**还原的界面**（用真实组件渲染、喂固定假数据），**视觉与真实页面一致**，但整体不可交互：点击表单、按钮不产生任何行为。
- **为什么不用静态截图**：截图在不同机型/分辨率下会模糊或变形，而用真实组件渲染可以自适应，且以后 UI 改了预览会跟着改，不会像截图那样过期失真。**这是选它的主要理由。**
- 每屏顶部/底部有一句说明，例如"爸爸 20 分钟前记过喂奶，打开就能看到 —— 注册后开始记录你们家自己的"。
- **不做**：不做写操作、不做内存态假数据、不做"游客也能记一条"。因此不需要只读拦截层，实现风险低。

**引导注册的落点**（只读预览下，用户不会产生"保存"这类意图，因此引导靠明确按钮）：

1. 每个 preview 屏底部固定一个**「开始使用」**按钮 —— 用户看完想用时，下一步就在眼前。
2. preview 页顶部一个**「注册 / 登录」**入口，给已经决定的人一条快路。
3. 离开 preview 后的下一次启动，`welcome` 上突出「继续注册」而不是重新展示预览。

**明确不做**：不弹全屏遮罩、不在阅读预览时打断、不限制预览时长、不设置"游客只能看 3 条"这类人为门槛。第 2 节的反目标里"添加记录要超过 3 步"同样适用于此——**注册流程本身也不能超过 3 步**（账号、密码、昵称一屏填完）。

---

## 10. API 约定

统一前缀 `/api`。分页用 `?page=1&pageSize=20`，响应 `{ items, total, page, pageSize }`。
错误响应统一 `{ statusCode, message, error }`（NestJS 默认结构）。

```
POST   /api/auth/register            { username, password, nickname, timezone, email?, phone? } → { accessToken, refreshToken, user }
POST   /api/auth/login               { username, password } → { accessToken, refreshToken, user }
POST   /api/auth/refresh             { refreshToken }
POST   /api/auth/change-password     { oldPassword, newPassword }   需要登录；撤销全部旧 refresh_token
POST   /api/auth/reset-request       { username }                   仅登记请求，v1 不自动处理
POST   /api/families/:id/members/:memberId/reset-password   仅 ADMIN/OWNER；返回一次性临时密码
GET    /api/me                       → 当前用户 + 所属家庭列表

POST   /api/families                 { name }
GET    /api/families/:id             → 家庭详情 + 成员
PATCH  /api/families/:id
POST   /api/families/:id/archive     归档（仅 OWNER）。**没有 DELETE，见第 4 节**
POST   /api/families/:id/transfer    转让所有权 { toUserId }（仅 OWNER）
POST   /api/families/:id/leave       退出家庭（最后一名 OWNER 禁止）
GET    /api/families/:id/members
PATCH  /api/families/:id/members/:memberId   改角色，仅 OWNER/ADMIN
DELETE /api/families/:id/members/:memberId    移除成员
POST   /api/families/:id/invites     → { code, expiresAt }
GET    /api/families/:id/invites
DELETE /api/invites/:inviteId        撤销
POST   /api/invites/:code/accept     加入家庭

GET    /api/families/:id/children
POST   /api/families/:id/children
PATCH  /api/families/:id/children/:childId
DELETE /api/families/:id/children/:childId   软删除

GET    /api/families/:id/events?childId=&type=&from=&to=&until=&page=
POST   /api/families/:id/events
PATCH  /api/families/:id/events/:eventId     仅创建者或 ADMIN/OWNER
DELETE /api/families/:id/events/:eventId     软删除，仅创建者或 ADMIN/OWNER

GET    /api/families/:id/reminders?status=
POST   /api/families/:id/reminders
PATCH  /api/families/:id/reminders/:reminderId
POST   /api/families/:id/reminders/:reminderId/complete   ONE_TIME 关闭系列；RECURRING 只完成本次实例
DELETE /api/families/:id/reminders/:reminderId            软取消，保留已完成实例的历史

GET    /api/notifications?unreadOnly=
POST   /api/notifications/:id/read
POST   /api/notifications/read-all
```

---

## 11. 前端技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 框架 | uni-app（**标准版，非 uni-app x**） | uni-app x 用 UTS 语法、生态与组件库不通用，且 uView Pro 面向标准 uni-app。标准版已支持鸿蒙 |
| 语言 | Vue 3 + TypeScript | uView Pro 声明全面支持 |
| UI 库 | **uView Pro** | 官方声明兼容 H5/小程序/App/**鸿蒙**，80+ 组件，含 `useTheme` 主题系统，正好满足"可切换配色" |
| 状态 | Pinia | uni-app Vue3 生态标准 |
| 请求 | 自封装 `uni.request`（uView Pro 自带 http 工具可作基础） | 需统一注入 token、familyId、错误处理 |
| 构建 | uni-app CLI（Vite 版，`uni-preset-vue#vite-ts`） | **必须用 CLI 而非 HBuilderX 可视化建项目**，否则我无法在命令行环境里工作 |

**为什么必须是 CLI 工程**：官方明确说明，用 HBuilderX 可视化创建的项目，编译器在 HBuilderX 目录下而非项目内，其他编辑器无法运行。本机未装 HBuilderX，所以我只能工作在 CLI 工程格式。**好消息**：CLI 工程可以随时拖进 HBuilderX 编辑和发行，两者兼容。

## 12. 后端与部署

| 项 | 选择 |
|---|---|
| 运行时 | Node.js 24 |
| 框架 | **NestJS** + TypeScript |
| ORM | Prisma |
| 数据库 | PostgreSQL 16 |
| 容器 | Docker Compose：`postgres` + `api` 两个服务，`api` 用多阶段构建 |
| 迁移 | Prisma Migrate，容器启动时 `prisma migrate deploy` |
| 配置 | `.env` + `.env.example`（提交 example，不提交 .env） |

Compose 服务：
- `postgres`：持久化卷 `pgdata`，健康检查 `pg_isready`。
- `api`：`depends_on: postgres(condition: service_healthy)`，暴露 3000。
- v1 不引入 Redis：调度用 `@Cron` 在单实例内跑即可。**明确记录**：将来 API 多实例部署时，cron 会重复执行，届时需要 Redis 分布式锁或独立 worker。当前单实例无此问题。

**注意**：本机 Docker 守护进程当前未运行，首次启动前需要你打开 Docker Desktop。

---

## 13. 仓库结构

```
moonBud/
├─ apps/
│  ├─ api/                    NestJS 后端
│  │  ├─ prisma/schema.prisma
│  │  ├─ src/
│  │  │  ├─ auth/  families/  children/  events/  reminders/  notifications/
│  │  │  ├─ common/guards/    RBAC 守卫
│  │  │  └─ push/             PushProvider 接口 + Noop 实现
│  │  └─ Dockerfile
│  └─ mobile/                 uni-app 客户端
│     ├─ src/pages/  src/theme/  src/api/  src/stores/
│     └─ package.json
├─ docker-compose.yml
├─ pnpm-workspace.yaml
├─ docs/superpowers/specs/    本设计文档
└─ README.md                  启动步骤
```

用 pnpm workspace 统一管理，根目录脚本：`pnpm dev:api` / `pnpm dev:app` / `pnpm db:migrate` / `pnpm docker:up`。

---

## 14. 构建与发行（现实中谁做什么）

| 目标 | 命令 | 谁做 | 前置条件 |
|---|---|---|---|
| 后端本地跑 | `docker compose up` | 我 | **你启动 Docker Desktop** |
| UI 预览 | `pnpm dev:app`（H5 模式） | 我 | 无 —— **这是唯一我能独立给你看界面的通路** |
| Android APK | HBuilderX → 发行 → App-Android 云打包 | **你** | 安装 HBuilderX；DCloud 账号 |
| 真机调试 | HBuilderX → 运行到手机 | **你** | HBuilderX + Android 手机开 USB 调试 |
| iOS IPA | HBuilderX → 发行 → iOS | **你** | 苹果开发者账号（$99/年）+ Mac 或云打包 |
| 鸿蒙 HAP | HBuilderX → 发行 → App-Harmony 本地打包 | **你** | HBuilderX 4.61+ **且** DevEco Studio 5.1.0.849+ **且** 鸿蒙开发者账号 + 证书 |

鸿蒙额外注意（官方明确列出）：
- 鸿蒙只能 **Vue3**，不支持 Vue2 —— 我们的选型符合。
- 鸿蒙不支持 `plus` API，但支持 nvue —— **影响第 6 节的本地通知**：`plus.push` 相关代码必须用条件编译隔离，鸿蒙下走别的路径。
- 鸿蒙权限不自动打包，需在 `harmony-configs/entry/src/main/module.json5` 手写 `requestPermissions`（通知权限尤其需要）。
- 官方自己写明"鸿蒙整体处于发展初期，能用，有坑……建议降低期望，不能严格比照 Android 和 iOS 的验收标准"。**建议 v1 验收标准定在安卓，iOS/鸿蒙作为兼容性目标而非验收目标。**

---

## 15. 本轮的判断（由我决定，请你抽查）

独立构建者审查后提出 8 个问题。全部已处理：其余由我决定并写入上文，列在这里供你核对（第 10 项部署形态是唯一仍需你答的，见第 17 节第 3 项）。

| # | 问题 | 我的决定 | 在哪一节 |
|---|---|---|---|
| 1 | 登录标识 | **账号（username）+ 密码**。邮箱/手机可选且不参与鉴权（用户要求） | 第 5 节 |
| 2 | 忘记密码怎么办 | **家庭成员重置**（ADMIN/OWNER 发一次性临时密码）+ 登录后修改密码；无家庭者无自助通路，登记为已知限制 | 第 5 节 |
| 3 | 重复提醒的完成语义 | 完成 RECURRING **只关本次实例**，系列继续；**按需生成**实例不预生成；改计划只删未来 PENDING 实例 | 第 4 节 |
| 4 | 家庭删除 | **删除端点从 v1 移除**，改为归档 / 退出 / 转让。数据永不硬删 | 第 4 节末 |
| 5 | 谁能改删别人的记录 | **仅创建者本人或 ADMIN/OWNER** | 第 4 节 |
| 6 | 当前孩子与时区来源 | 当前孩子存**本地且按家庭分别存**；`users` 加 `timezone`，注册时取设备时区 | 第 3、4 节 |
| 7 | 防重复照护 | **列为 v1 验收标准**，在记录表单里非阻断提示"XX 20 分钟前记过一次" | 第 9 节 |
| 8 | 游客模式 | **只读界面预览**（真实组件渲染、喂固定假数据、不可操作）+ 落地页；**主题切换是唯一真交互**；不强制弹注册 | 第 9.5 节 |
| 9 | 账号格式 | **4–20 位字母/数字/下划线**，注册页据此校验并给明确错误提示 | 第 4、5 节 |
| 10 | 部署形态 | 留给你答（第 17 节第 3 项）。前端 baseURL 走配置，两种都能支持 | 第 17 节 |
| 11 | DCloud appid | v1 先用占位，仅影响扫码唤起 APP 的端到端验证 | 第 8 节 |

**最需要你确认的两条**（因为它们改变了原设计）：

- **家庭不再能删除**。如果你确实需要"彻底删掉一个家"，告诉我，我会按"先导出再删"来做——但不会做成一个直接级联删除的接口。
- **忘记密码在"没有家庭可依靠"时无法自助找回**。这是账号密码方案的固有代价（原邮箱方案靠恢复码解决，但你选了账号密码）。如果家人里有人可能单独使用，请告诉我，我再加一层保护。

### 用户已明确答复（2026-10-16）

三条要求已折入上文，另有两个待定项已由用户选定：

| 用户要求 / 选择 | 落地位置 |
|---|---|
| 用账号密码登录 | 第 4、5 节 |
| 要修改密码功能 | 第 5 节 `change-password`、页面 `change-password` |
| 先看到功能再引导注册 | 第 9.5 节、页面 `welcome` / `preview` |
| 游客预览 = **只读界面预览**（非可交互沙盒） | 第 9.5 节 |
| 账号格式 = **4–20 位字母/数字/下划线** | 第 4、5 节 |

## 16. 留给构建者的决定

以下是本文档**有意不指定**、由实现者判断的：

- 具体 UI 视觉细节（间距、圆角、字号阶梯、图标风格）——按"精美"目标自行设计，但必须走主题语义变量。
- 首页"今日概览"的具体呈现形式（卡片数、信息密度）。
- 分页每页条数、缓存策略、请求防抖细节。
- NestJS 模块内部的文件划分、DTO 组织方式。
- 测试策略的覆盖范围（建议：权限守卫、提醒到期计算、JSONB 校验三处必须有测试，其余按需）。
- 落地页（`join`）是做成 uni-app 的 H5 页还是独立静态页。

## 17. 待用户提供或决策（阻塞项）

| # | 事项 | 阻塞什么 | 何时需要 |
|---|---|---|---|
| 1 | 启动 Docker Desktop（**已安装，只需打开**） | 后端与数据库无法运行 | **开发开始时立刻需要** |
| 2 | 同意安装 HBuilderX | 无法产出任何安装包 | 第一次要装到手机上时 |
| 3 | **v1 部署形态**：局域网家庭测试，还是要放到能远程访问的服务器 | 决定 API 地址配置、是否要 HTTPS 证书、备份方案；也决定邀请二维码能否给不在同一网络的人扫 | **写前端请求配置前**（见下方决策记录） |
| 4 | **注册 DCloud 账号并创建应用，拿到 appid** | `manifest.json` 与 `moonbud://` scheme；不解决则扫码唤起 APP 无法端到端验证 | 第一次要打真机包时 |
| 5 | 域名（或用局域网 IP 临时替代） | 邀请二维码的可扫码落地页 | 做到邀请功能时 |
| 6 | JWT / 数据库初始密码等环境变量值 | 部署 | 写 `.env` 时我可生成随机值，你确认即可 |
| 7 | 是否需要 iOS（决定是否值得投入苹果开发者账号 $99/年） | 不影响 v1 代码，影响发行计划 | v1 完成后 |
| 8 | 鸿蒙 DevEco Studio 是否有条件安装 | 鸿蒙构建 | 鸿蒙排期时 |

### 关于第 3 项的一个技术后果（我已在文档里按"两种都支持"设计）

手机上的 APP **无法访问 `localhost`**——手机上的 `localhost` 指手机自己。所以：
- 局域网测试：API 地址必须写成开发机的**局域网 IP**（如 `http://192.168.1.5:3000`），且手机与电脑在同一 WiFi。
- 远程访问：需要一台有公网入口的服务器 + 域名 + HTTPS（uni-app 的 APP 端对明文 HTTP 有平台限制）。

因此前端请求的 baseURL **必须走环境变量/配置文件**，不能在代码里写死。这一条决定了你给不给服务器的答案**不阻塞开发**，但会在第一次真机联调时变成必答题。
