<script setup lang="ts">
import type { ThemeMode } from '@moonbud/shared'
import { THEME_PRESETS } from '../theme/presets'
import { useThemeStore } from '../stores/theme'

const themeStore = useThemeStore()
const presets = Object.values(THEME_PRESETS)
const modes: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'auto', label: '自动' },
]
</script>

<template>
  <view class="theme-switcher">
    <view class="swatches">
      <view
        v-for="preset in presets"
        :key="preset.id"
        class="swatch"
        :class="{ 'swatch--active': themeStore.presetId === preset.id }"
        @click="themeStore.setPreset(preset.id)"
      >
        <view class="swatch__dot" :style="{ backgroundColor: preset.light.primary }" />
        <text class="swatch__name">{{ preset.name }}</text>
      </view>
    </view>

    <view class="modes">
      <view
        v-for="mode in modes"
        :key="mode.value"
        class="mode"
        :class="{ 'mode--active': themeStore.mode === mode.value }"
        @click="themeStore.setMode(mode.value)"
      >
        <text class="mode__label">{{ mode.label }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.theme-switcher {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.swatches {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
}

.swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10rpx;
  padding: 12rpx 16rpx;
  border-radius: 16rpx;
  border: 2rpx solid transparent;
}

.swatch--active {
  border-color: var(--mb-color-primary);
  background-color: var(--mb-color-surface-alt);
}

.swatch__dot {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  border: 2rpx solid var(--mb-color-border);
}

.swatch__name {
  font-size: 22rpx;
  color: var(--mb-color-text-secondary);
}

.modes {
  display: flex;
  flex-direction: row;
  border-radius: 999rpx;
  background-color: var(--mb-color-surface-alt);
  padding: 6rpx;
}

.mode {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10rpx 0;
  border-radius: 999rpx;
}

.mode--active {
  background-color: var(--mb-color-primary);
}

.mode__label {
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
}

.mode--active .mode__label {
  color: var(--mb-color-on-primary);
}
</style>
