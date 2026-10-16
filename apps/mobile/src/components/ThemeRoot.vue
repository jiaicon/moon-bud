<script setup lang="ts">
import { computed } from 'vue'
import { useThemeStore } from '../stores/theme'
import { toCssVars } from '../theme/presets'

const themeStore = useThemeStore()

/**
 * H5 端 applyTheme 已把变量写进 documentElement，这里不必再绑；小程序与 APP 端没有
 * document，变量必须由这个根节点带着，否则子树里的 var(--mb-color-*) 全部落空。
 */
const rootStyle = computed(() => {
  // #ifdef H5
  return ''
  // #endif
  // #ifndef H5
  const tokens = themeStore.isDark ? themeStore.preset.dark : themeStore.preset.light
  return Object.entries(toCssVars(tokens))
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
  // #endif
})
</script>

<template>
  <view class="theme-root" :style="rootStyle">
    <slot />
  </view>
</template>

<style scoped>
.theme-root {
  min-height: 100vh;
  background-color: var(--mb-color-background);
  color: var(--mb-color-text-primary);
}
</style>
