<script setup lang="ts">
import { computed, ref } from 'vue'
import { useChildStore } from '../stores/child'
import { useFamilyStore } from '../stores/family'

const emit = defineEmits<{ (e: 'change'): void }>()

const familyStore = useFamilyStore()
const childStore = useChildStore()

const open = ref(false)
const currentName = computed(() => familyStore.currentFamily?.name ?? '选择家庭')

/**
 * 切换后必须重新拉这个家庭的孩子列表：孩子本就按家庭分键，
 * 不拉的话顶部会停在另一个家庭的孩子名字上（换家庭串台）。
 */
async function pick(familyId: string): Promise<void> {
  open.value = false
  if (familyId === familyStore.currentFamilyId) return
  familyStore.switchFamily(familyId)
  await childStore.load(familyId)
  emit('change')
}

const goManage = () => {
  open.value = false
  uni.navigateTo({ url: '/pages/family-select/index' })
}
</script>

<template>
  <view class="switcher">
    <view class="switcher__trigger" @click="open = true">
      <text class="switcher__label">家庭</text>
      <text class="switcher__value">{{ currentName }}</text>
      <text class="switcher__caret">▾</text>
    </view>

    <u-popup v-model="open" mode="bottom" border-radius="24" :safe-area-inset-bottom="true">
      <view class="sheet">
        <text class="sheet__title">切换家庭</text>
        <view
          v-for="family in familyStore.families"
          :key="family.id"
          class="sheet__item"
          :class="{ 'sheet__item--active': family.id === familyStore.currentFamilyId }"
          @click="pick(family.id)"
        >
          <text class="sheet__item-label">{{ family.name }}</text>
          <text v-if="family.id === familyStore.currentFamilyId" class="sheet__check">✓</text>
        </view>
        <view class="sheet__actions">
          <text class="sheet__action" @click="goManage">创建 / 加入家庭</text>
        </view>
      </view>
    </u-popup>
  </view>
</template>

<style scoped>
.switcher__trigger {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
  padding: 14rpx 22rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-surface-alt);
}

.switcher__label {
  font-size: 22rpx;
  color: var(--mb-color-text-secondary);
}

.switcher__value {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--mb-color-text-primary);
}

.switcher__caret {
  font-size: 22rpx;
  color: var(--mb-color-text-secondary);
}

.sheet {
  padding: 32rpx 40rpx 40rpx;
}

.sheet__title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--mb-color-text-primary);
}

.sheet__item {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 26rpx 0;
  border-bottom: 1rpx solid var(--mb-color-divider);
}

.sheet__item--active .sheet__item-label {
  color: var(--mb-color-primary);
  font-weight: 600;
}

.sheet__item-label {
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
}

.sheet__check {
  font-size: 28rpx;
  color: var(--mb-color-primary);
}

.sheet__actions {
  margin-top: 24rpx;
}

.sheet__action {
  font-size: 26rpx;
  color: var(--mb-color-primary);
}
</style>
