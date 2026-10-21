<script setup lang="ts">
import { computed } from 'vue'
import EmptyState from './EmptyState.vue'
import { LOGIN_ENTRY_URL, TEACH_PATH } from '../guest/gate'
import { GUEST_GUIDE, GUEST_LOGIN_LABEL, GUEST_TEACH_LABEL, type GuestGuidePage } from '../guest/guide'

const props = defineProps<{ page: GuestGuidePage }>()

/** 三格共用的那一句从这里取，页面里不另写文案。 */
const copy = computed(() => GUEST_GUIDE[props.page])

const goLogin = () => uni.navigateTo({ url: LOGIN_ENTRY_URL })
const goTeach = () => uni.navigateTo({ url: TEACH_PATH })
</script>

<template>
  <empty-state
    :icon="copy.icon"
    :title="copy.title"
    :hint="copy.hint"
    :action-label="GUEST_LOGIN_LABEL"
    @action="goLogin"
  >
    <view class="guest__teach" @click="goTeach">
      <text class="guest__teach-label">{{ GUEST_TEACH_LABEL }}</text>
    </view>
  </empty-state>
</template>

<style scoped>
.guest__teach {
  margin-top: 4rpx;
  padding: 8rpx 20rpx;
}

.guest__teach-label {
  font-size: 24rpx;
  color: var(--mb-color-primary);
  text-decoration: underline;
}
</style>
