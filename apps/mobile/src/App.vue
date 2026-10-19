<script setup lang="ts">
import { onHide, onLaunch, onShow } from '@dcloudio/uni-app'
import { rearmLocalNotifications } from './notifications/local-notify'
import { resyncActiveReminderSchedules } from './notifications/reminder-arming'
import { resetDueWatch, startDueWatch, stopDueWatch } from './notifications/due-watch'
import { refreshUnreadTabBadge } from './notifications/tab-badge'
import { useAuthStore } from './stores/auth'
import { useDupWindowStore } from './stores/dup-window'
import { useThemeStore } from './stores/theme'

onLaunch(() => {
  // 主题必须在第一帧之前落定，否则冷启动会闪一下默认色；纯本地读取，不发请求。
  useThemeStore().init()
  // 防重复提示窗口同样是本地偏好：先恢复，第一张表单才知道该用哪一档窗口。
  useDupWindowStore().init()
  // 本地通知的排期登记表按"改动时重建"维护；冷启动先按表重放一次，把 App 关着时
  // 已经过期的条目清掉，接下来的重算才不会被旧时刻污染。
  rearmLocalNotifications()
  // 冷启动静默登录要等出结果才能开始轮询：没有会话的那一趟轮询只会白跑，
  // 而"第一次只记底不弹"这条规矩一旦被它用掉，真登录之后攒下的提醒
  // 就永远弹不出来了。
  void useAuthStore()
    .bootstrap()
    .then(() => startDueWatch())
})
onShow(() => {
  // 每次回到前台都重排这一家的提醒：本地推送是"某一刻响一次"，只在建/改的那一刻
  // 排一次的话，重复提醒响过第一下就再也哑掉，而家长本来就不会回头编辑它。
  void resyncActiveReminderSchedules()
  // 未读数也是回前台时补一次：App 关着的那段时间里服务端可能又攒了几条。
  void refreshUnreadTabBadge()
  // 应用开着的时候本地推送不一定响，而盯着屏幕的这一刻最容易被错过。
  // 只在有会话时开始：冷启动的 onShow 早于静默登录，没有会话的那一趟轮询会把
  // "第一次只记底"的额度白白用掉，真登录之后攒下的提醒就再也弹不出来了。
  if (useAuthStore().isLoggedIn) startDueWatch()
})
onHide(() => {
  // 看不见屏幕就别再轮询：那段时间该响的是系统通知，回来时 onShow 会重新接手。
  stopDueWatch()
})
</script>

<style lang="scss">
@import 'uview-pro/index.scss';

page {
  background-color: var(--mb-color-background, #f5f7fa);
  color: var(--mb-color-text-primary, #1f2329);
}
</style>
