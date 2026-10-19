<script setup lang="ts">
import { onHide, onLaunch, onShow } from '@dcloudio/uni-app'
import { rearmLocalNotifications } from './notifications/local-notify'
import { useAuthStore } from './stores/auth'
import { useThemeStore } from './stores/theme'

onLaunch(() => {
  // 主题必须在第一帧之前落定，否则冷启动会闪一下默认色；纯本地读取，不发请求。
  useThemeStore().init()
  // 本地通知的排期登记表只在改动时重建过；冷启动不补一次，App 关着时攒下的
  // 过期条目会在下一次任何改动时被一起重放。
  rearmLocalNotifications()
  // 冷启动静默登录：不这么做，刷新一次页面后本地只剩 refresh token，
  // 每个请求都带着已过期的 access token 出门，用户看到的是莫名其妙的 401。
  void useAuthStore().bootstrap()
})
onShow(() => {})
onHide(() => {})
</script>

<style lang="scss">
@import 'uview-pro/index.scss';

page {
  background-color: var(--mb-color-background, #f5f7fa);
  color: var(--mb-color-text-primary, #1f2329);
}
</style>
