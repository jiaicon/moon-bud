<script setup lang="ts">
import { onHide, onLaunch, onShow } from '@dcloudio/uni-app'
import { rearmLocalNotifications } from './notifications/local-notify'
import { resyncActiveReminderSchedules } from './notifications/reminder-arming'
import { useAuthStore } from './stores/auth'
import { useThemeStore } from './stores/theme'

onLaunch(() => {
  // 主题必须在第一帧之前落定，否则冷启动会闪一下默认色；纯本地读取，不发请求。
  useThemeStore().init()
  // 本地通知的排期登记表按"改动时重建"维护；冷启动先按表重放一次，把 App 关着时
  // 已经过期的条目清掉，接下来的重算才不会被旧时刻污染。
  rearmLocalNotifications()
  // 冷启动静默登录：不这么做，刷新一次页面后本地只剩 refresh token，
  // 每个请求都带着已过期的 access token 出门，用户看到的是莫名其妙的 401。
  void useAuthStore().bootstrap()
})
onShow(() => {
  // 每次回到前台都重排这一家的提醒：本地推送是"某一刻响一次"，只在建/改的那一刻
  // 排一次的话，重复提醒响过第一下就再也哑掉，而家长本来就不会回头编辑它。
  void resyncActiveReminderSchedules()
})
onHide(() => {})
</script>

<style lang="scss">
@import 'uview-pro/index.scss';

page {
  background-color: var(--mb-color-background, #f5f7fa);
  color: var(--mb-color-text-primary, #1f2329);
}
</style>
