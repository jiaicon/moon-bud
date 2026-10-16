<script setup lang="ts">
import { onHide, onLaunch, onShow } from '@dcloudio/uni-app'
import { useThemeStore } from './stores/theme'

onLaunch(() => {
  // 主题必须在第一帧之前落定，否则冷启动会闪一下默认色；纯本地读取，不发请求。
  useThemeStore().init()
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
