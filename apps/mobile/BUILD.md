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

### 2b. 用命令行驱动云打包（HBuilderX 4.x+ 的 `cli.exe`）

第 2 节的菜单点击不是唯一通路。HBuilderX 安装目录下有 `cli.exe`，它能完成导入和云打包，
只是**仍然要 DCloud 账号登录，仍然要真 appid** —— 这两步 cli 代劳不了：

```
# 一次性：把 apps/mobile 导进 HBuilderX（HBuilderX 需要处于打开状态）
<E:\software\HBuilderX>\cli.exe project open --path D:\mine\moonBud\apps\mobile
<E:\software\HBuilderX>\cli.exe project list          # 应能看到 mobile(UniApp_VUE)

# 每次打包
cli.exe pack --project D:\mine\moonBud\apps\mobile --platform android \
  --android.packagename com.moonbud.app --android.androidpacktype 1 --ignoreWarnings true
```

`--android.androidpacktype` 取值：0 自有证书、1 DCloud 公共证书、2 DCloud 老版证书、3 云端证书。
先用 1 跑通，正式上架再换 0。产物（APK 下载链接）出现在 HBuilderX 的下拉列表里，
`cli.exe logcat pack` 能看打包控制台日志，`cli.exe pack status --project <路径>` 能看任务状态。

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
- `plus.push` 的本地排期**只在 APP 端存在**（`src/notifications/local-notify.ts` 用条件编译隔离）。
  在 H5/小程序上这个调用会 `console.warn` 一句"当前平台不支持本地通知"，不是 bug。
- **APK 必须打进 push 模块**，`plus.push` 才存在：`manifest.json` 里要写
  `"app-plus": { "modules": { "Push": {} } }`。只声明模块、不配 `sdkConfigs.push.unipush` ——
  我们要的是本机定时通知，不接个推/厂商通道，省掉 uni-push 后台开通那一堆配置。
  真机实测（2026-10-20）：没打这个模块时每次排期都抛"打包时未添加push模块，请参考…"，
  家长看到的是一句莫名其妙的原生报错。现在 `local-notify.ts` 把两处原生调用都包进 try/catch，
  登记表照写、调用方不被炸断、这句只在第一次落一条 `console.warn`（有单测钉住），
  但**提醒依然只剩站内提醒中心和应用内到点提示** —— 想要锁屏通知就得按上面那行声明重新打包。
- 已知限制，界面上"我的 → 关于"也写了：**APP 被关闭、或被系统在后台回收时，本地推送可能不响。**
  国产 ROM 的省电策略尤其激进 —— 需要在系统设置里给 moonBud 开"允许后台运行/自启动"。
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
（欢迎页 → 功能预览 → 主题切换 → 注册/登录）。这是本仓库能给出的**最终**验证，
但它验证的是"代码正确"，不是"APP 可用" —— 后者只有第 2 节走通才算数。
