<script setup lang="ts">
import { computed, ref } from 'vue'
import { useChildStore } from '../stores/child'
import { useFamilyStore } from '../stores/family'

const emit = defineEmits<{ (e: 'change'): void }>()

const familyStore = useFamilyStore()
const childStore = useChildStore()

const open = ref(false)
const familyId = computed(() => familyStore.currentFamilyId ?? '')
const children = computed(() => childStore.childrenByFamily[familyId.value] ?? [])
const current = computed(() => childStore.currentChild(familyId.value))
// 名单还没读到过的时候不能写"未添加"：那是"这个家庭没有孩子"的意思。
const loaded = computed(() => familyId.value in childStore.childrenByFamily)
const display = computed(
  () => current.value?.name ?? (familyId.value && !loaded.value ? '读取中' : '未添加'),
)

function pick(childId: string): void {
  open.value = false
  if (childId === current.value?.id) return
  childStore.select(familyId.value, childId)
  emit('change')
}

const goAdd = () => {
  open.value = false
  uni.navigateTo({ url: '/pages/child-form/index' })
}
</script>

<template>
  <view class="switcher">
    <view class="switcher__trigger" @click="open = true">
      <text class="switcher__label">孩子</text>
      <text class="switcher__value">{{ display }}</text>
      <text class="switcher__caret">▾</text>
    </view>

    <u-popup v-model="open" mode="bottom" border-radius="24" :safe-area-inset-bottom="true">
      <view class="sheet">
        <text class="sheet__title">切换孩子</text>
        <view
          v-for="child in children"
          :key="child.id"
          class="sheet__item"
          :class="{ 'sheet__item--active': child.id === current?.id }"
          @click="pick(child.id)"
        >
          <text class="sheet__item-label">{{ child.name }}</text>
          <text v-if="child.id === current?.id" class="sheet__check">✓</text>
        </view>
        <view class="sheet__actions">
          <text class="sheet__action" @click="goAdd">添加孩子</text>
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
