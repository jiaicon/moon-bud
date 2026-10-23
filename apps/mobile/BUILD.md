# 移动端构建与发行（Android 优先）

这份文档解决一个问题：**怎么把 `apps/mobile` 变成一个能装在手机上的 app**。

先说结论，因为它决定了后面所有步骤的意义：

> 命令行（`pnpm build:app`）只能产出 **app 打包资源**（`dist/build/app`），
> **产出不了可安装的 APK**。签名 APK 必须由 **HBuilderX** 走"发行 → 原生 App-云打包"。
> 这不是本项目偷懒，是 uni-app 的发行模型：DCloud 的打包机负责生成并签名原生壳，
> 本地没有、也不需要 Android Studio 工程。
>
> 补充（2026-10-20 实测）：HBuilderX 自带的 `cli.exe` 可以在命令行里驱动这次云打包，见第 2b 节；
> 但账号登录与 appid 这两步它替不了你。

因此本仓库里所有代码级验证都止于浏览器（H5）。**真机行为 —— 本地通知、扫码、明文 HTTP ——
只有在下面这些步骤做完之后才算被验证过。**

---

## 0. 你需要准备什么

| 目标 | 怎么做 | 前置条件 |
|---|---|---|
| UI 预览 | `pnpm --filter @moonbud/mobile dev:h5` | 无。这是唯一不需要额外工具就能看到界面的通路 |
| Android APK | HBuilderX → 发行 → 原生 App-云打包 | 装 HBuilderX；注册 DCloud 账号 |
| 真机调试 | HBuilderX → 运行 → 运行到手机或模拟器 | 手机打开 USB 调试 |
| iOS IPA | HBuilderX → 发行 → iOS | 苹果开发者账号（$99/年）+ 云打包 |
| 鸿蒙 HAP | HBuilderX → 发行 → App-Harmony 本地打包 | HBuilderX 4.61+ **且** DevEco Studio 5.1.0.849+ **且** 鸿蒙开发者账号与证书 |

**v1 的验收标准定在 Android。** iOS 与鸿蒙是兼容性目标，不是验收目标（原因见第 5 节）。

---

## 1. 后端地址：真机不能用 localhost

`apps/mobile/.env.development` 里写的是 `http://127.0.0.1:3000/api`。这在浏览器里没问题，
但**手机上的 127.0.0.1 是手机自己**，连不到你的电脑。

打包/真机调试前，把地址改成跑着 `apps/api` 的那台机器的**局域网 IP**：

```
# apps/mobile/.env.development（真机调试用）
VITE_API_BASE_URL=http://192.168.1.23:3000/api
```

IP 怎么查：Windows `ipconfig`（无线局域网适配器 WLAN 的 IPv4 地址），macOS `ipconfig getifaddr en0`。

三个必须同时成立的条件，少一个都会表现为"登录后一直转圈"：

1. 手机和电脑在**同一个 WiFi**（不要用手机流量，也不要一个连 2.4G 一个连 5G 的隔离网络）；
2. 后端监听的是 `0.0.0.0` 而不是 `127.0.0.1`，否则局域网请求根本进不来；
3. Windows 防火墙放行 3000 端口（或临时关掉专用网络的防火墙）。

`.env.production` 现在填的是 `http://172.16.120.55:3000/api`（同一 WiFi 下的真机试用地址），
不是当初那个 `https://REPLACE-ME.example.com/api`。**换回占位符也行，而且正式部署时必须换**：
缺配置会在启动时直接抛错，比"上线后连不上自己排查半天"要好。正式部署时换成公网可达的 HTTPS 域名。
注意这台机器的局域网 IP 是 DHCP 分的，重启/换网络就会变，改完要重新 `build:app` 或重新云打包。

顺带一句：H5 开发服务器默认只监听 `127.0.0.1`，想在手机浏览器里打开同一个页面调试，
需要 `pnpm --filter @moonbud/mobile dev:h5 -- --host`（uni 会把 `--host` 透传给 vite）。

---

## 2. Android 步骤（推荐先走通这条）

1. 下载安装 [HBuilderX](https://www.dcloud.io/hbuilderx.html)（App 开发版，不是标准版 —— 标准版没有打包菜单）。
2. 把 **`apps/mobile` 整个目录**拖进 HBuilderX 左侧的项目管理器。
   注意是 `apps/mobile`，不是仓库根目录：根目录是 pnpm workspace，HBuilderX 看不懂。
3. 双击 `src/manifest.json`，切到"基础配置"页，把 **appid 换成你自己的**：
   点 appid 右侧的"重新获取"，登录 DCloud 账号后会自动填入形如 `__UNI__A1B2C3D` 的真值。
   仓库里那个 `__UNI__MOONBUD` 是占位符，云打包会直接拒绝它。
4. 确认"App 权限配置"里 `usesCleartextTraffic` 仍是开启状态（源码里已写死为 `true`）。
   关掉它，局域网明文 HTTP 请求会被系统全部拦掉，而报错只是"网络异常"。
5. `运行 → 运行到手机或模拟器 → 运行到 Android App 基座`，手机先开 USB 调试并授权。
   第一次会提示安装"标准基座"，同意即可。
6. 真机上跑通后：`发行 → 原生App-云打包`，选 Android，填包名（如 `com.moonbud.app`），
   证书先用"DCloud 老版证书/公共证书"跑通，正式上架再换自己的证书。
7. 打包完成后下载 APK，装到手机上。

**图标配置写出来的路径在 `unpackage/res/icons/*.png`，而 `unpackage/` 是 gitignore 的。**
所以换一台机器（或重新 clone）之后，manifest 里那些路径指向的文件不存在，云打包会报图标缺失：
在"App图标配置"里用 `src/static/logo.png` 重新生成一次即可。

**装好后第一件事**：登录 → 首页 → 记一笔喂奶。这条链路通了，说明第 1 节的地址配置是对的。

**每次云打包之前**：`src/manifest.json` 的 `versionCode` +1（`versionName` 给人看，跟着走）。
同签名同 versionCode 在小米上照样覆盖安装，所以现在没被咬到；一旦上架，商店要求严格递增，重复号会被拒收。
2026-10-16 到 2026-10-22 之间打了 5 个包，全是 `1.0.0(100)`，靠 HBuilderX 的产物文件名时间戳区分
（`__UNI__9B2D760__20261022172030.apk`）—— 从 `1.0.1(101)` 起不再这样。**打包对话框不会重读 manifest**
（和第 6 步的包名同一个坑），所以先改版本号再打开对话框，并在对话框里核对一眼显示的数字。

### 2b. 用命令行驱动云打包（HBuilderX 4.x+ 的 `cli.exe`）

第 2 节的菜单点击不是唯一通路。HBuilderX 安装目录下有 `cli.exe`，它能完成导入和云打包，
只是**仍然要 DCloud 账号登录，仍然要真 appid** —— 这两步 cli 代劳不了：

```
# 一次性：把 apps/mobile 导进 HBuilderX（HBuilderX 需要处于打开状态）
<E:\software\HBuilderX>\cli.exe project open --path D:\mine\moonBud\apps\mobile
<E:\software\HBuilderX>\cli.exe project list          # 应能看到 mobile(UniApp_VUE)

# 每次打包（自有证书）
cli.exe pack --project D:\mine\moonBud\apps\mobile --platform android \
  --android.packagename top.iconmen.yueya --android.androidpacktype 0 \
  --android.certfile C:\Users\jiaic\moonbud-keystore\yueya-jks.keystore \
  --android.certalias yueya \
  --android.certpassword <见同目录 keystore.password> --android.storepassword <同上> \
  --ignoreWarnings true
```

`--android.androidpacktype` 取值：0 自有证书、1 DCloud 公共证书、2 DCloud 老版证书、3 云端证书。
2026-10-21 之前用的是 3（云端证书，缓存落在 `apps/mobile/dist/cache/cloudcertificate/package.keystore`），
现在起固定用 0。**签名一旦用于注册推送或上架就不能再换**：换签名后新 APK 覆盖不了已装的旧包，
必须先卸载重装，厂商后台里登记的 SHA256 指纹也全部要重填。
证书在仓库外的 `C:\Users\jiaic\moonbud-keystore\`（不进 git；丢了这个目录就等于永久失去
给老用户覆盖更新的能力，务必备份到网盘/移动硬盘各一份）。
产物（APK 下载链接）出现在 HBuilderX 的下拉列表里，
`cli.exe logcat pack` 能看打包控制台日志，`cli.exe pack status --project <路径>` 能看任务状态。

**但这条路的权限前提是硬条件（2026-10-22 18:20 实测）**：HBuilderX 必须以管理员运行才能正常打包，
而 `cli.exe` 与它**必须同一完整性级别**。用非管理员的 shell（比如 Agent 的终端）驱动时会连吃两个错：

1. 任何 `cli.exe` 命令都只回一句 `未检测到已打开的HBuilderX，请先执行cli open启动HBuilderX后再重试`
   —— 你那个管理员实例其实开着，只是非管理员进程看不见它；
2. 于是 `cli open` 会**另起一个非管理员实例**，`cli pack` 表面上跑起来了，编译阶段死在
   `%APPDATA%\HBuilder X\.log` 里的 `QProcess: CreateNamedPipe failed. (拒绝访问。)`
   （两个实例抢同一条命名管道），控制台只把它翻译成一句误导人的"cli项目运行依赖本地的Nodejs环境"。
   这种失败**不会进云端队列、不消耗打包次数**（`cli pack status` 里最新一条还是上一次的成功记录）。

所以：要么**用管理员起一个 cli**（`Start-Process E:\software\HBuilderX\cli.exe -Verb RunAs`，要点一次 UAC），
要么就回到第 2 节的 GUI 点击。**同一台机器上任何时候都只能有一个 HBuilderX 实例** ——
多起来的那个不光自己打不了包，还会把 GUI 打包一起弄坏（发现方法：
`Get-CimInstance Win32_Process -Filter "Name='HBuilderX.exe'" | Select ProcessId,ParentProcessId`，
父进程是终端的那个就是多余实例）。

两个只有 GUI 能做的准备，顺序不能反：

1. **登录**：`cli user info` 会打印出保存过的用户名，但那只是记住的账号名。会话过期时
   `pack` 直接回 `user not login`（实测 2026-10-20）。在 HBuilderX 右上角点头像重新登录；
   `cli user login --username … --password …` 能用，但要你把密码交进命令行，不推荐。
2. **取真 appid**：登录后在 HBuilderX 里双击 `src/manifest.json` →"基础配置"→ appid 右侧"重新获取"。
   带着 `__UNI__MOONBUD` 这个占位符，云打包会拒绝。

另外这里没配应用图标（`manifest.json` 里没有 `icons`），云打包会用 DCloud 默认图标 —— 试用包无所谓，
正式包要在"基础配置 → 图标设置"里补一张 192x192 的图。

### 2c. HBuilderX 编译报 `Cannot find module .../vite-plugin-uni/bin/uni.js`

CLI 创建的 uni-app 项目在 HBuilderX 里发行时，**用的是项目本地的编译器**，而它按字面路径找
`<项目目录>/node_modules/@dcloudio/vite-plugin-uni/bin/uni.js`，不会向上解析。
本仓库是 pnpm workspace 且依赖被 hoist 到仓库根的 `node_modules`，`apps/mobile/node_modules` 里
只有 `@moonbud`，所以那句路径必然不存在（实测 2026-10-20，发行→云打包 1 秒即失败）。

补一个目录联接即可，只动 gitignore 里的 `node_modules`：

```
# PowerShell（cmd 的 mklink 经 git-bash 传引号会坏，用这个）
New-Item -ItemType Junction -Path 'D:\mine\moonBud\apps\mobile\node_modules\@dcloudio' `
  -Target 'D:\mine\moonBud\node_modules\@dcloudio'
Test-Path 'D:\mine\moonBud\apps\mobile\node_modules\@dcloudio\vite-plugin-uni\bin\uni.js'   # 应为 True
```

HBuilderX 编译产物落在 `apps/mobile/unpackage/`，也在 gitignore 里。

**要撤的时候用 `rmdir`，不要用 `rm -rf`**：联接在类 Unix 的删除语义下会被当成普通目录穿透，
`rm -rf` 会顺着它删掉仓库根真正的那份 `node_modules/@dcloudio`。

```
cmd /c rmdir "D:\mine\moonBud\apps\mobile\node_modules\@dcloudio"
```

**必须在真机上单独确认的一条：PATCH。** 后端的修改类路由（改家庭名、改孩子、改提醒、改记录）
全是 PATCH。`@dcloudio/types` 的 `request` 方法枚举里**没有 PATCH**，所以
`src/api/http.ts` 里把 method 断言成了 `'GET'` 才过类型检查。H5 端实测可用（uni-h5 运行时
确实发得出 PATCH），但 APP 端的原生网络层是否放行 PATCH **无法在这里验证**。
真机上只要"编辑"类操作报网络错误或 405，第一个就怀疑它 —— 退路是在后端加等价的 POST 路由，
而不是在客户端偷偷改用 PUT（那会和已上线的契约分叉）。

---

## 3. 本地通知在真机上是什么表现

- 提醒的**主路径永远是站内提醒中心**（底部"提醒"tab → 右上角"提醒中心"）。它不依赖推送权限，任何平台都可用。
- **到点提醒默认由服务端推送发**（`PUSH_REMINDER_DUE=true`，2026-10-22 真机改判：`plus.push`
  排上去的定时消息撤不掉，划掉 App 就连整个排期一起没）。本地排期退成兜底：`registerPushClient`
  把 cid 报进服务端成功 → `setLocalPushEnabled(false)`，这台设备一条本地定时都不排；
  拿不到 cid（H5、APK 没打 push 模块、上报失败）→ 继续排本地。**双弹就是从这一处关掉的。**
- `plus.push` 的本地排期**只在 APP 端存在**（`src/notifications/local-notify.ts` 用条件编译隔离）。
  在 H5/小程序上这个调用会 `console.warn` 一句"当前平台不支持本地通知"，不是 bug。
- **APK 必须打进 push 模块**，`plus.push` 才存在：`manifest.json` 里要写
  `"app-plus": { "modules": { "Push": {} } }`。只声明模块、不配 `sdkConfigs.push.unipush` ——
  我们要的是本机定时通知，不接个推/厂商通道，省掉 uni-push 后台开通那一堆配置。
  真机实测（2026-10-20）：没打这个模块时每次排期都抛"打包时未添加push模块，请参考…"，
  家长看到的是一句莫名其妙的原生报错。现在 `local-notify.ts` 把两处原生调用都包进 try/catch，
  登记表照写、调用方不被炸断、这句只在第一次落一条 `console.warn`（有单测钉住），
  但**提醒依然只剩站内提醒中心和应用内到点提示** —— 想要锁屏通知就得按上面那行声明重新打包。
- 已知限制，界面上"我的 → 关于"也写了：**APP 被关闭、或被系统在后台回收时，通知可能不响。**
  2026-10-22 真机实测：划掉 App 后本地定时**完全不响、重开也不补**，而个推长连接一断推送也到不了
  （`successed_offline`）—— 我们没接小米厂商通道，那条要上架才能开。所以能不能收到通知，
  取决于进程活着与否：在系统设置里给 moonBud 开"允许后台运行 / 自启动 / 省电策略无限制"，
  并把它钉在最近任务里。
- **省电策略调到"无限制"之后，App 退后台（不划掉）是收得到的**：同一枪在后台打，个推照样回
  `successed_online`。所以卡住离线到达的只有"进程不在了"这一种。
- **进程不在就不止是"慢一点"，是这条消息彻底没了**（2026-10-22 用重启做到比划掉更干净的条件）：
  重启后 12 分钟没人点开过 App，`pidof` 空、logcat 里没有任何自启动/个推拉起痕迹 —— 一枪打过去
  个推回 `successed_offline`，面板 0 条。随后把进程拉起来，`ttl`（1 小时）明明还在窗口内，
  **那条离线消息两分半钟里一次都没补发**；同一 cid 再打一枪（这次在线）就 `successed_online`、
  横幅立刻出现。所以"离线消息在 ttl 内会被补发"这句在小米上不能当保证用（见下面那条缓冲的修订）。
- **通知响不响由通知渠道决定，不由消息决定**（安卓 8+）。dumpsys 实测：月芽名下只有一条渠道
  `DcloudChannelID`（名"消息推送"，组 `DcloudGroupID`），`mOriginalImp=3` —— 建的时候就是默认档，
  表现是"躺下拉面板、不弹横幅、不响、不震"；把它在系统设置里调到最高档，横幅/铃声/震动全有了
  （`mImportance=4`、`mUserLockedFields=34` 就是那次手动调高的痕迹）。
  代码侧 `push-channel.ts` 在冷启动时用 `uni.getChannelManager().setPushChannel()` 把
  **这条同名渠道**按 `IMPORTANCE_HIGH + 震动` 抢先建好 ——
  **id 必须是 `DcloudChannelID`**：自创一个 id 只会多建一条没人往里投通知的渠道，设置里多一格、
  响法一点没变。安卓只承认"建渠道那一刻"设的重要度，事后 App 改不动，所以这一句必须赶在第一条
  通知弹出来之前跑到。
- **这一句到底落了什么：`adb shell pm clear` 后首启，dumpsys 显示 `mOriginalImp=4`、
  `mName=到点提醒`、`mVibrationEnabled=true`、`mUserLockedFields=0`** —— 重要度/渠道名/震动都是
  代码建的（不是用户调的，`mUserLockedFields=0` 就是没人动过的痕迹）。**但 `lockscreenVisibility`
  没落地**（实测仍 `-1000`=PRIVATE），所以那个字段已从代码里删掉，别再传。
  **而且新装默认档真的会响（同日登录回来拿到新 cid 后两枪实测）**：`successed_online`，横幅、响铃、
  震动三者齐全 —— 家长装上新包什么都不用调就能被吵到。（旧 cid 那条 `devices` 记录已删，
  清数据重装后个推发的是全新 cid。）
- **装了带新代码的 APK 后 dumpsys 里渠道一点没变，不是代码没跑**：安卓对已经存在的渠道 id 会
  忽略 `createNotificationChannel`，重要度/名字都改不动（这也是"先建为敬"必须抢在 SDK 之前的原因）。
  排查顺序：先 `unzip -p <apk> assets/app-service.js | grep -c DcloudChannelID` 证明代码真在包里，
  再用 `pm clear` 或卸载重装重测。
- Android 13+ 首次需要授予通知权限，`manifest.json` 里已声明 `POST_NOTIFICATIONS`。

---

## 4. iOS 步骤

需要苹果开发者账号（$99/年）。`发行 → 原生App-云打包` 选 iOS，两种证书路径：

- **企业/开发证书 + 描述文件**：自己或公司已有苹果开发者账号，在 Apple Developer 后台生成 `.p12` 与 `.mobileprovision`，打包时上传。
- **DCloud 云端证书（测试用）**：只能装到注册过的测试设备上。

没有 Mac 也能出包 —— 云打包在 DCloud 的机器上完成，本机不需要 Xcode。上架 App Store 才需要
Transporter 与审核流程，超出 v1 范围。

---

## 5. 鸿蒙步骤与它的坑

前置：HBuilderX 4.61+、DevEco Studio **5.1.0.849 及以上**、鸿蒙开发者账号与签名证书。
本仓库**没有** `harmony-configs` 目录：当前环境没装 DevEco Studio，先建一个空壳只会让人以为它能打包。
真要出鸿蒙包时，在 HBuilderX 里 `发行 → App-Harmony-本地打包`，它会生成该目录，再按下面三条改：

1. **路径长度**：鸿蒙工具链对路径长度与中文敏感。官方建议工程绝对路径 ≤77 字符且不含中文，
   `D:\mine\moonBud` 满足，但换机器时要重新确认。
2. **权限要手写**：鸿蒙不会把 `manifest.json` 里的 Android 权限自动带过去。通知权限必须自己在
   `harmony-configs/entry/src/main/module.json5` 的 `requestPermissions` 里声明，否则运行时静默失效。
3. **不支持 `plus` API**：`src/notifications/local-notify.ts` 里的 `plus.push` 在鸿蒙上不存在 ——
   这正是它必须用 `#ifdef APP-PLUS` 条件编译、而不是运行时 `typeof plus` 判断的原因
   （运行时判断挡不住编译期对 `plus` 的引用）。鸿蒙上本地通知直接不可用，提醒只走站内提醒中心。

DCloud 官方对鸿蒙的原话是"整体处于发展初期，能用，有坑……建议降低期望，不能严格比照 Android 和 iOS
的验收标准"。**所以鸿蒙按兼容性目标处理，不阻塞发版。**

---

## 6. 无 HBuilderX 时能验证到什么程度

```
pnpm --filter @moonbud/mobile test        # 单元/组件逻辑
pnpm --filter @moonbud/mobile type-check  # 全量类型检查
pnpm --filter @moonbud/mobile build:h5    # 生产构建
```

`build:h5` 的产物在 `apps/mobile/dist/build/h5`，用任意静态服务器打开即可跑完整的游客流程
（未登录直接进四个 Tab 页 → 空状态里的引导 → 功能教学 → 主题切换 → 注册/登录）。这是本仓库能给出的**最终**验证，
但它验证的是"代码正确"，不是"APP 可用" —— 后者只有第 2 节走通才算数。

---

## 7. 推送路线：uni-push 2.0 + 我们自己的 URL 化云函数（厂商通道明确不接）

**决定 1（2026-10-22）：不接小米厂商通道。** `manifest.json` 保持 `unipush.offline : false`，只走个推自有长连接。
原因：厂商通道的入口是"应用已在小米应用商店上架"——小米官方公告（开发者文档 pId=2057，2025-06-09 起）
和个推的厂商通道文档都写明了这条前置要求，而拿到上架资格要软著 + App 备案 + 商店审核一整条链，
**换成极光、阿里云 EMAS 也一样绕不过去**。为了几台家庭设备走这一趟不划算。

**决定 2（2026-10-22）：服务端不直连个推 REST，改成调我们的 uniCloud 云函数。**
这条不是偏好，是限制——DCloud 官方 FAQ 原文：

> 使用 uni-push 2.0，服务端不支持用个推 api 推送，只能用 dcloud 提供的服务端（云函数）推送。
> 第三方需将云函数 URL 化后调用这个 http 接口。

实测也印证了：uni-push 2.0 的应用在 DCloud 后台**拿不到个推 MasterSecret**（"应用信息"页只给
AppID/AppKey/AppSecret，而 `厂商推送设置` 里那句"MasterSecret 由个推保存，DCloud 并不保存"说的
是**厂商**的密钥）。用那三个值去 `/auth`，两种签名顺序都停在 `sign is invalid`。
所以原来的 `GetuiPushProvider` 已整体删除，换成 `UnicloudPushProvider`；如果哪天非要直连个推，
前提是把客户端退回 **uni-push 1.0**（1.0 的控制台确实给 AppId/AppKey/MasterSecret），代价是
manifest 换版本、重新云打包、已上报的 cid 全部作废——评估过，不值得。

链路：`NestJS ──HTTPS + x-push-token──▶ 云函数 push ──uni-cloud-push──▶ uni-push 2.0 ──▶ 个推长连接 ──▶ App`

这条路线换来什么、失去什么：

- **换来**：0 元、0 材料、客户端零改动（cid 上报、找回密码推送的代码都已上线）。云函数只有
  几十行，免费额度对"每月个位数条通知"的家庭用量是天文数字级的余量。
- **失去**：① App 进程被杀掉的那段时间收不到实时提示，而且那一条**不会因为进程回来而补发**
  （见上面"进程不在就不止是慢一点"，`ttl` 内拉起也没等到）；② 服务端多了一个第三方依赖（uniCloud
  服务空间），见下面"每月手动续期"。两条缓冲：
  1. 每条消息带 `ttl = 1 小时` —— 文档说窗口内被拉起会补发，**小米上实测没兑现**，别把它当兜底；
     真正保命的还是下一条。
  2. 通知本体存在服务器的通知中心表里，与推送链路无关——最坏情况是"打开 App 才看到"，
     内容不会丢，丢的只是那一下提示。

**要做的是设备侧设置，不是代码**（小米/Redmi，每台手机一次，归用户）：

1. 设置 → 应用管理 → 月芽 → **自启动**开启；**省电策略**选"无限制"。
2. 最近任务里长按（或下拉）月芽 → **锁定**，防止一键清理把它杀掉。

这组设置的作用不是"系统就不杀它"，而是"杀了允许重新拉起"。但**实测这两次都没等到重新拉起**：
划掉后 45 秒、重启后 12 分钟，主进程一次都没有自己回来（划掉那次只剩一个
`top.iconmen.yueya:pushservice` 常驻进程，而长连接在主进程里，所以个推照样判离线 —— 见第 8 节）。
能被这组设置救回来的只有"退后台没被杀"和"人自己点开之后"这两段；期间打的枪是离线枪，实测也不补发。
没做这组设置时，HyperOS 的后台回收通常在几分钟到十几分钟量级。

### 部署这个云函数（GUI 归用户，按顺序）

1. HBuilderX 打开 `apps/mobile` → 项目根目录（与 `src` 同级）右键 → **创建 uniCloud 云开发环境** →
   关联已有的服务空间 `moonbud-push`（支付宝云）。仓库里两个文件已经写好在
   `apps/mobile/uniCloud-alipay/cloudfunctions/push/{index.js,package.json}`；若 HBuilderX 生成的
   目录叫 `uniCloud`（服务商不同后缀不同），把这两个文件原样挪过去即可。
2. 右键云函数 `push` → **设置环境变量**：`PUSH_TOKEN` = 一个随机串（`openssl rand -hex 32`），
   和第 5 步服务器 `.env` 里的 `UNICLOUD_PUSH_TOKEN` 必须完全一致。
   这一步 HBuilderX 会在 uniCloud 目录里落地一个 `.env`，**已经加进 .gitignore，别提交**。
3. 右键 `push` → **上传云函数**。
4. uniCloud web 控制台 → 云函数列表 → `push` → **云函数 URL 化**：访问路径配成 `/push`，
   复制控制台给出的完整 https 地址（形如 `https://<空间域名>/push`）。
5. 服务器 `/home/workspace/moon-bud/.env`（chmod 600，**值别贴到聊天里**）：
   删掉 `GETUI_APPID` / `GETUI_APPKEY` / `GETUI_MASTER_SECRET` / `XIAOMI_PUSH_CATEGORY` 四行，
   写入 `UNICLOUD_PUSH_URL=<第 4 步的地址>` 和 `UNICLOUD_PUSH_TOKEN=<第 2 步的随机串>`。
   改完必须 `sudo docker compose -f deploy/compose.prod.yml --env-file .env up -d` **重建容器**
   （只 restart 不会重读 `.env`）。
6. 验证：启动日志这一行是唯一的判据 —— `推送通道：uniCloud 云函数（已配置）`；
   若写着 `未配置云函数地址与共享密钥，只写日志`，说明第 5 步没生效。

**每月手动续期（这条路线唯一的持续人工成本）**：官方计费文档原文——支付宝云免费版
"有效期默认一个月"、需**手动续期**；到期"第二天开始停服……资源保留 7 天……未续费则销毁且无法找回"，
**不会自动转按量计费**。也就是说 2026-11-21 之后如果没人去控制台点续期，推送会静默失效
（NestJS 侧只会在日志里记 code，功能上表现为"手机不响"）。给自己定一个每月的日历提醒。

**限额（超了是整条拒收，不是截断，所以 Nest 侧在发送前就截好，有测试钉住）**：
`title` ≤ 20 字、`content` ≤ 50 字、`payload` ≤ 800 字符。payload 超长时发送空对象并 warn——
消息照到，只是点击落回首页，比整条丢掉好。

**云函数的返回形态（2026-10-22 从服务器实测，之前单测全是 mock）**：URL 化**永远回 HTTP 200**，
结果全在 body 里，形如 `{code, msg, data}`。`code` 正常时是数字 `0`，出错时是**字符串** errCode。
实测两枪：错 token → `{"code":401,"msg":"x-push-token 不匹配"}`；对 token + 假 cid →
`{"code":"uni-cloud-push-error-20001","msg":"target user is invalid"}`。第二枪同时证明了三件事：
函数在跑、环境变量 `PUSH_TOKEN` 读到了、uni-cloud-push 扩展库已加载并真的打到了 uni-push 网关。
Nest 侧判成功的条件是 `res.ok && code === 0`，所以这两种都会走 warn 分支（不会误报成功）。

### 备选路线（暂缓，不排期）：真要接厂商通道时

| 步 | 做什么 | 产出 | 依赖 | 周期 | 费用 |
|---|---|---|---|---|---|
| A | 软著登记（中国版权保护中心，个人实名）。源代码前后各 30 页 + 说明文档**由我准备**，提交动作归你 | 登记证书 | — | 自办 30–60 工作日；代办加急 3–20 天 | 自办 0 官费 |
| B | App 备案（腾讯云，在与 ICP 同主体下新增一项 App） | App 备案号 | 包名 + 签名 MD5 + 服务器接入信息（见下） | 约 1–2 周 | 0 |
| C | 小米开发者账号（个人实名）→ 创建应用 → **非公开上架** → 开通推送 | 小米 AppId / AppAppKey / AppSecret | A + B 的证书 | 商店审核 1–3 天 | 0 |
| D | 小米推送运营平台申请**私信/服务类**分类 + 消息模板 | 通过的 category/channel id + 模板 id | C | 3–10 天 | 0 |
| E | DCloud 开发者中心 → uni-push 2.0 → 厂商推送设置，填 C 的三项；manifest `offline:true`；重新云打包 | 带小米通道的 APK | C | 当天 | 0 |

注意 D 不可跳过：未分类应用的小米默认通道是**单应用单设备单日 1 条**，超出的部分个推返回
`exceed quota` 后被静默吞掉（服务端日志什么都不会变红）。2026-07-01 起新接入的应用还必须用
**模板**（`template_id`）下发私信，旧类目通道 2026-12-31 关停。

真要接的时候，代码侧只动一处：在云函数 `sendMessage` 里补 `options: { android: { XM: {…} } }`
（`index.js` 里已经留了注释位）。NestJS 那侧不用改——这正是当初把发送口做成 `PUSH_PROVIDER`
接缝的原因。

**B 要填的两项身份**（签名证书固定在 `C:\Users\jiaic\moonbud-keystore`，不能再换）：

```
包名        top.iconmen.yueya
签名 MD5    49:DB:D5:E6:05:18:8F:36:82:4A:86:A4:9F:60:B6:7E
```

**这一条决定上面五步是否存在**：有报道称小米应用商店自 2024-12-27 起只接受企业认证（连个体工商户
都被拒）。若属实，个人主体根本无法上架，厂商通道这条路永久关闭，A–E 全部作废。只能在小米开发者
后台用你的真实账号确认：能不能创建应用、能不能看到"推送服务"开关。确认之前不要投入软著和备案。

---

## 8. 真机 spike：八问八答（2026-10-22 跑完，结论已进代码）

包：`__UNI__9B2D760__20261022132349.apk` 起（含 `manifest.json` 的 unipush 收口、自有证书）。
临时探针写在页面里跑，测完删掉，**测试代码不进仓库**。

1. **cid 能不能拿到** —— **能**。坑在字段名：成功回调给的是 `{ cid, errMsg }`
   （`@dcloudio/types` 的 `GetPushClientIdSuccessData`），不是文档示例里的 `client_id`。
   读错键时单测全绿而服务端 `devices` 表一条记录都没有，只有真机探针能揭穿。修好后生产库
   落到了这台设备的 32 位 cid。
2. **个推自有通道能不能弹** —— **前台能**。curl 云函数 → `{"code":0}`，个推回 `successed_online`，
   手机横幅出现，点击按 `routing.ts` 分流到成员列表。App 划掉时个推回 `successed_offline`，
   横幅不来 —— 没有厂商通道就没有离线到达。
3. **划掉 App 后本地定时还弹不弹** —— **不弹，重开也不补**。`delay` 的定时器跟着进程一起没了。
4. **撤销排期撤得掉吗** —— **撤不掉**。官方《Push 推送开发指南》写 `plus.push.clear()` 清的是
   "系统通知栏中属于当前应用的所有消息"，还没到点、压在队列里的那条它碰不到：实测"停掉提醒"
   之后旧时刻照响。

顺带定了一条 API 事实（四路对照，同一个包）：`when` 只是"消息上显示的提示时间"，
`plus+when` 与 `uni+when` 两条都在提交瞬间就弹出；真正推迟显示的是 `delay`（秒），
`plus+delay(120)` / `uni+delay(180)` 各自准点在 +120s / +180s 响。`local-notify.ts` 已改 `delay`。

**这四答把 spec 第 3 节证伪了**（那条判断写的就是"本地定时更抗杀"，并留了"若 spike 矛盾就改默认值"
的话）。于是：`PUSH_REMINDER_DUE` 默认改 `true`（生产服务器已打开），到点提醒由服务端发；
客户端 `registerPushClient` 报上 cid 就关本地排期，报不上才兜底（第 3 节）。

**后面又补了几测（同日，包 `20261022155` 之后）**：

5. **App 在后台（按 Home，不划掉）收得到吗** —— **收得到**。省电策略"无限制"下，同一枪在后台
   打照样回 `successed_online`。之前"后台收不到、回前台才收到"的那次，是没调到该策略 +
   通知本身太轻（下一条），不是通道断了。
6. **通知为什么"很轻"** —— 渠道重要度。`adb shell dumpsys notification --noredact` 里月芽名下只有
   一条渠道 `DcloudChannelID`（`mOriginalImp=3`），默认档只在下拉面板躺一条；把它调到最高档，
   横幅、铃声、震动一起有（当时是你在设置里手动调的，代码还没生效）。代码侧改成冷启动就
   `setPushChannel` **按同一个 id** 把这条渠道建成最高档（`push-channel.ts`）—— 自创 id 只会多建
   一条没人投通知的渠道；而安卓只承认建渠道时设的重要度，所以必须抢在建之前。
7. **清数据重装后，代码建的渠道到底落了什么** —— `adb shell pm clear top.iconmen.yueya` + 首启，
   `dumpsys notification --noredact` 里 `DcloudChannelID` 变成 `mOriginalImp=4`（代码建的，不是用户调的）、
   `mName=到点提醒`、`mVibrationEnabled=true`、`mUserLockedFields=0`。**importance/渠道名/震动都落地了。**
   没落地的只有 `lockscreenVisibility`（仍 `-1000`=PRIVATE），这个字段已从 `push-channel.ts` 删掉。
   **横幅也确实弹了**：登录回来（个推发的是全新 cid，旧的已删）连打两枪都回 `successed_online`，
   手机上横幅、响铃、震动三者齐全 —— **新装用户什么都不用调就能被吵到**。
8. **划掉 App 还收得到吗（要不要为厂商通道花钱）** —— **收不到，那笔钱是"要划掉也收到"的唯一解**。
   两种死法都测了，答案一样：
   - **真·划掉（17:53，进程先前活跃过、cid 也注册着，最贴近用户实际场景）**：从最近任务划掉后 `pidof` 空，
     但 `ps -A` 里还留着一个 **`top.iconmen.yueya:pushservice` 独立进程**。一枪过去照样回
     `successed_offline`，45 秒内主进程没被重新拉起、面板 0 条。**这条最值钱：DCloud/个推的常驻进程活着
     ≠ 长连接活着** —— 连接在主进程里，主进程一没个推就判离线，留着 `:pushservice` 也救不回来。
     所以"划掉后是不是没杀干净"这类问题在自启动/白名单上是问不出结果的。
   - **重启后从未打开（17:42，比划掉更干净）**：开机 12 分钟没人点过月芽，`ps -A` 里连 `:pushservice`
     都没有，logcat 无任何拉起痕迹（**自启动并没有把它带回来**）。一枪 `successed_offline`、面板 0 条，
     8 秒后 `pidof` 依旧空（**推送唤不醒进程**）。
   顺带把"离线会补发"这个假设也测死了：17:44:19 用 `adb shell monkey` 把进程拉起来，到 17:46:42 为止
   那条 17:42 的离线消息（`ttl = 1 小时` 明明还在窗口内）**一次都没补发**；而同一 cid 在 17:45:42
   打的在线枪立刻 `successed_online`，`dumpsys notification` 多出一条 `importance=4` 的记录。
   结论两句话：**能不能到达只取决于主进程活着与否；离线期间那一条是真丢了，不是延后。**
   所以"0 元路线"买到的实时性 = "App 恰好活着"。要夜里喂奶那种不能错过的提醒，只有小米厂商通道
   （要上架）；不上架就把主路径继续放在站内提醒中心 + 应用内到点强提醒弹窗上。

## 9. 「到点顺手记」的真机验证清单（代码已进仓库，装机的包还没有）

第一期（提醒带动作 + 到点「记一笔」）全部在 H5 上验过，**真机一条都没跑过**：现在装机的 APK
打的是这批代码之前的工作区。下面这些都要等**下一次云打包**之后在这台小米上验，
在此之前屏幕上出现「记一笔」的唯一地方是 H5（`pnpm dev:h5`）。

1. **建一条带动作的一次性提醒**：提醒表单里「到点顺手记」选一个类型（比如用药），
   必填项（药品名/剂量）填齐 —— 底部提示必须是**「到点直接记：通知上点一下「记一笔」就写下这条」**。
   这句只有三种可能，见哪句说哪句的真话：没填全是**「到点打开记一笔（必填项还没填全）」**，
   填了又不合格（体温填成 120 这种）是**「必填项都填了，可这份预填不合格：到点只会打开记一笔」**；
   睡眠/生长发育这种没有必填项的类型说的是**"记下光板一条"**。
2. **让 App 在前台等它响**（`due-watch` 那一分钟一次的轮询；本地推送在 App 活着时不一定响）。
   弹框必须是两个键：**「记一笔」+「知道了」**，不是一个「知道了」。
3. **点「记一笔」**：不许换页、不许再弹任何东西。之后记录列表应当多出一条**类型正确、预填字段带上了**的记录，
   提醒中心/通知中心里那一条不再发红（已读）。
4. **只带类型的那一条**（建提醒时必填项留空）：弹框按钮应当是**「去记一笔」**，点了进记一笔表单
   且类型已经选好；那条通知**保持未读**（点芯片没有 markRead，返回后红点还在）。
5. **多条同时到点**：弹框应当只有一个**「知道了」**，不给动作 —— 一屏里先挑一条来记是"想一下"，不是"点一下"。
   补偿在通知中心：那里**逐条**都有动作芯片。
6. **断网重复第 3 步**：飞行模式下点「记一笔」，不报错、不换页，记录列表顶部出现一条**「待同步」**；
   恢复网络后它自己变成正常记录，`fromReminderId`（出处）要跟着重放走、不丢。
7. **归档孩子的路径**：把那条提醒关联的孩子归档，再等到点 —— 芯片应当退化成「去记一笔」，
   点进表单由表单自己说清楚为什么记不进去。
8. **状态栏那条推送点下去**：仍然只是落到提醒列表的「待办」那一栏，不直接进弹框、也不会自己记一笔。
   这是**刻意没改**的（一期不往推送体里塞预填，理由在设计文档里），这一步验的是它没被顺手改坏。
9. **编辑一条带动作的老提醒**：只改标题再保存 —— 到点那一枪的预填必须一个字都不少（用药的「用法」这种
   在这一格里根本没有栏的可选项，尤其容易被抹掉）。

第 3、6 步是这期唯一"点了就写库"的路径，也是最值得在真机上看一眼的两步。
