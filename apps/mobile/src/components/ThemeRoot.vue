<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useThemeStore } from '../stores/theme'
import { applyNativeChrome } from '../theme/native-chrome'
import { themeVarsStyle } from '../theme/uview-bridge'

const themeStore = useThemeStore()

const tokens = computed(() => (themeStore.isDark ? themeStore.preset.dark : themeStore.preset.light))
// 图标文件名里带预设 id：换预设要换图，换明暗也要换图。
const chromeTheme = computed(() => ({ presetId: themeStore.presetId, dark: themeStore.isDark }))

/**
 * 变量必须绑在这个根节点上，H5 也要：documentElement 那份会被 uView 声明在
 * `:root, page` 上的默认值盖掉（`page` 离内容更近），弹层就会在深色模式里留白底。
 */
const rootStyle = computed(() => themeVarsStyle(tokens.value))

// tabBar / 导航栏是 pages.json 里的构建期常量，主题只能运行时覆盖它们。
onMounted(() => applyNativeChrome(tokens.value, chromeTheme.value))
watch([tokens, chromeTheme], () => applyNativeChrome(tokens.value, chromeTheme.value))
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
