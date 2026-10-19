<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { invitesApi } from '../../api/endpoints'
import { useChildStore } from '../../stores/child'
import { useFamilyStore } from '../../stores/family'

const familyStore = useFamilyStore()
const childStore = useChildStore()

const name = ref('')
const code = ref('')
const error = ref('')
const busy = ref(false)

const hasFamily = computed(() => familyStore.hasFamily)

const toast = (title: string) => uni.showToast({ title, icon: 'none' })

async function switchTo(familyId: string): Promise<void> {
  familyStore.switchFamily(familyId)
  // 切家庭必须同时把那个家庭的孩子拉进来，否则首页顶部的孩子还是上一个家庭的。
  await childStore.load(familyId)
  uni.switchTab({ url: '/pages/home/index' })
}

async function create(): Promise<void> {
  if (busy.value) return
  const trimmed = name.value.trim()
  if (!trimmed) {
    error.value = '请输入家庭名称'
    return
  }
  if (trimmed.length > 30) {
    error.value = '家庭名称不超过 30 字'
    return
  }
  error.value = ''
  busy.value = true
  const family = await familyStore.create(trimmed)
  busy.value = false
  if (!family) {
    toast(familyStore.error ?? '创建失败')
    return
  }
  await childStore.load(family.id)
  uni.switchTab({ url: '/pages/home/index' })
}

async function join(): Promise<void> {
  if (busy.value) return
  const trimmed = code.value.trim().toUpperCase()
  if (!trimmed) {
    error.value = '请输入邀请码'
    return
  }
  error.value = ''
  busy.value = true
  try {
    const family = await invitesApi.accept(trimmed)
    await familyStore.load()
    if (family) familyStore.switchFamily(family.id)
    await childStore.load(familyStore.currentFamilyId ?? '')
    busy.value = false
    uni.switchTab({ url: '/pages/home/index' })
  } catch (err) {
    busy.value = false
    toast(err instanceof Error ? err.message : '加入失败，请检查邀请码')
  }
}

onLoad(() => {
  void familyStore.load()
})
</script>

<template>
  <theme-root>
    <view class="page">
      <text class="page__title">{{ hasFamily ? '我的家庭' : '先创建一个家庭' }}</text>
      <text v-if="!hasFamily" class="page__hint">
        家庭是记录、提醒和成员的归属。也可以直接输入家人给的邀请码加入。
      </text>

      <view v-if="hasFamily" class="list">
        <view v-for="family in familyStore.families" :key="family.id" class="list__item" @click="switchTo(family.id)">
          <view class="list__body">
            <text class="list__name">{{ family.name }}</text>
            <text class="list__role">{{ family.role === 'OWNER' ? '我创建的家庭' : `成员（${family.role === 'ADMIN' ? '管理员' : '普通成员'}）` }}</text>
          </view>
          <text v-if="family.id === familyStore.currentFamilyId" class="list__check">✓</text>
        </view>
      </view>

      <view class="panel">
        <text class="panel__label">创建家庭</text>
        <input v-model="name" class="panel__input" maxlength="30" placeholder="如：小月一家" />
        <view class="btn" :class="{ 'btn--disabled': busy }" @click="create">
          <text class="btn__label">创建</text>
        </view>
      </view>

      <view class="panel">
        <text class="panel__label">用邀请码加入</text>
        <input v-model="code" class="panel__input" maxlength="8" placeholder="8 位邀请码" />
        <view class="btn btn--ghost" :class="{ 'btn--disabled': busy }" @click="join">
          <text class="btn__label">加入</text>
        </view>
      </view>

      <text v-if="error" class="page__error">{{ error }}</text>
    </view>
  </theme-root>
</template>

<style scoped>
.page {
  padding: 40rpx;
  display: flex;
  flex-direction: column;
  gap: 28rpx;
}

.page__title {
  font-size: 38rpx;
  font-weight: 700;
  color: var(--mb-color-text-primary);
}

.page__hint {
  font-size: 26rpx;
  line-height: 1.6;
  color: var(--mb-color-text-secondary);
}

.page__error {
  font-size: 24rpx;
  color: var(--mb-color-error);
}

.list {
  display: flex;
  flex-direction: column;
  border-radius: 24rpx;
  background-color: var(--mb-color-surface);
  border: 1rpx solid var(--mb-color-border);
  overflow: hidden;
}

.list__item {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 26rpx 30rpx;
  border-bottom: 1rpx solid var(--mb-color-divider);
}

.list__body {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.list__name {
  font-size: 30rpx;
  color: var(--mb-color-text-primary);
}

.list__role {
  font-size: 22rpx;
  color: var(--mb-color-text-secondary);
}

.list__check {
  font-size: 28rpx;
  color: var(--mb-color-primary);
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 18rpx;
  padding: 30rpx;
  border-radius: 24rpx;
  background-color: var(--mb-color-surface-alt);
}

.panel__label {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--mb-color-text-primary);
}

.panel__input {
  /* uni-app 把 uni-input 宿主定成 height:1.4em + overflow:hidden：宿主上的上下 padding
     会把真正可输入的 inner input 挤成约 1px，打进去的字被裁掉。 */
  height: 80rpx;
  padding: 0 22rpx;
  border-radius: 16rpx;
  border: 1rpx solid var(--mb-color-border);
  background-color: var(--mb-color-surface);
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-primary);
}

.btn--ghost {
  background-color: var(--mb-color-surface);
}

.btn--disabled {
  opacity: 0.5;
}

.btn__label {
  font-size: 30rpx;
  color: var(--mb-color-on-primary);
}

.btn--ghost .btn__label {
  color: var(--mb-color-primary);
}
</style>
