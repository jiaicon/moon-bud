<script setup lang="ts">
import { computed } from 'vue'
import { useThemeStore } from '../stores/theme'
import { themeVarsStyle } from '../theme/uview-bridge'

const themeStore = useThemeStore()

/**
 * 变量必须绑在这个根节点上，H5 也要：documentElement 那份会被 uView 声明在
 * `:root, page` 上的默认值盖掉（`page` 离内容更近），弹层就会在深色模式里留白底。
 */
const rootStyle = computed(() =>
  themeVarsStyle(themeStore.isDark ? themeStore.preset.dark : themeStore.preset.light),
)
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
