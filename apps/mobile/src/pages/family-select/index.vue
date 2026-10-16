<script setup lang="ts">
import ThemeRoot from '../../components/ThemeRoot.vue'
</script>

<template>
  <theme-root>
    <view class="shell">
      <text class="shell__label">选择或创建家庭</text>
    </view>
  </theme-root>
</template>

<style scoped>
.shell {
  padding: 48rpx;
}

.shell__label {
  font-size: 28rpx;
  color: var(--mb-color-text-secondary);
}
</style>
