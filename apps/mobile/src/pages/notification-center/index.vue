<script setup lang="ts">
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { notificationsApi } from '../../api/endpoints'
import { refreshUnreadTabBadge } from '../../notifications/tab-badge'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { useAuthStore } from '../../stores/auth'
import { wallStamp } from '../../utils/wall-time'
import type { NotificationDto } from '@moonbud/shared'

const authStore = useAuthStore()
const PAGE_SIZE = 30

const items = ref<NotificationDto[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const error = ref<string | null>(null)
const unreadOnly = ref(true)

const hasMore = computed(() => items.value.length < total.value)
/** 通知的时间按账号时区念：同屏的提醒卡片已经是它了，混用两块表只会自相矛盾。 */
const timezone = computed(() => authStore.user?.timezone ?? 'Asia/Shanghai')

/**
 * 切筛选、下拉、回到本页都可能并发。被"正在加载"挡掉的那一次会让分段标签
 * 和列表内容不是同一个条件，所以排队串行，后一次一定真跑。
 */
let queue: Promise<void> = Promise.resolve()

function load(reset: boolean): Promise<void> {
  const next = queue.then(() => run(reset))
  queue = next.catch(() => undefined)
  return next
}

async function run(reset: boolean): Promise<void> {
  loading.value = true
  error.value = null
  const next = reset ? 1 : page.value + 1
  try {
    const res = await notificationsApi.list({
      unreadOnly: unreadOnly.value ? 'true' : undefined,
      page: next,
      pageSize: PAGE_SIZE,
    })
    items.value = reset ? res.items : [...items.value, ...res.items]
    total.value = res.total
    page.value = next
  } catch (err) {
    error.value = err instanceof Error ? err.message : '通知加载失败'
  } finally {
    loading.value = false
  }
}

async function markRead(item: NotificationDto): Promise<void> {
  if (item.readAt) return
  try {
    await notificationsApi.markRead(item.id)
    item.readAt = new Date().toISOString()
    // 角标数的是服务端的未读总数，本页只改了自己手里这一条的读标记，
    // 不补这一下，头顶那一格会继续显示旧数字。
    void refreshUnreadTabBadge()
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '标记失败', icon: 'none' })
  }
}

/** 点击通知要落到那条提醒上：通知只是路标，家长关心的是"该做什么"。 */
async function open(item: NotificationDto): Promise<void> {
  await markRead(item)
  // switchTab 带不了参数，用一次性 storage 把列表切回"待办"：
  // 停在"已完成"里点一条到点的通知，看到的是无关的旧记录。
  uni.setStorageSync('reminderTabFocus', 'ACTIVE')
  uni.switchTab({ url: '/pages/reminder-list/index' })
}

async function readAll(): Promise<void> {
  try {
    const res = await notificationsApi.readAll()
    items.value = items.value.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }))
    uni.showToast({ title: `已读 ${res.updated} 条`, icon: 'none' })
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '操作失败', icon: 'none' })
    return
  }
  // 头顶的"N 条未读"读的是服务端的 total：不重取，它会停在旧数字上，
  // 而列表里的红点已经全灭了。
  await load(true)
  void refreshUnreadTabBadge()
}

function toggleFilter(): void {
  unreadOnly.value = !unreadOnly.value
  void load(true)
}

const goReminders = () => uni.switchTab({ url: '/pages/reminder-list/index' })

function fmt(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const stamp = wallStamp(timezone.value, at)
  return `${stamp.month}月${stamp.day}日 ${stamp.clock}`
}

// onLoad 已经拉过，onShow 只管"从别处回到本页"，否则首屏发双份请求。
let ready = false

onLoad(async () => {
  // 深链/冷启动直接进这一页时 user 还是 null，时区会退回兜底值，第一屏就念错钟点。
  if (!authStore.user) await authStore.bootstrap()
  await load(true)
  ready = true
})
onShow(() => {
  if (ready) void load(true)
})
onPullDownRefresh(() => {
  void load(true).finally(() => uni.stopPullDownRefresh())
})
</script>

<template>
  <theme-root>
    <view class="page">
      <view class="head">
        <text class="head__count">{{ unreadOnly ? `${total} 条未读` : `${total} 条通知` }}</text>
        <view class="head__actions">
          <text class="link" @click="toggleFilter">{{ unreadOnly ? '查看全部' : '只看未读' }}</text>
          <text class="link" @click="readAll">全部已读</text>
        </view>
      </view>

      <text v-if="error" class="page__error">{{ error }}</text>

      <view
        v-for="item in items"
        :key="item.id"
        class="card"
        :class="{ 'card--read': !!item.readAt }"
        @click="open(item)"
      >
        <view class="card__dot" :class="{ 'card__dot--unread': !item.readAt }" />
        <view class="card__body">
          <text class="card__title">{{ item.title }}</text>
          <text class="card__body-text">{{ item.body }}</text>
          <text class="card__time">{{ fmt(item.createdAt) }}</text>
        </view>
      </view>

      <u-empty
        v-if="!loading && !items.length && !error"
        mode="list"
        :text="unreadOnly ? '没有未读通知' : '还没有通知'"
      />
      <text v-if="loading" class="page__loading">加载中…</text>
      <view v-if="!loading && hasMore" class="more" @click="load(false)"><text class="more__label">加载更多</text></view>
      <view v-if="!unreadOnly || !total" class="foot" @click="goReminders"><text class="foot__label">去提醒列表 ›</text></view>
    </view>
  </theme-root>
</template>

<style scoped>
.page {
  padding: 24rpx 32rpx 96rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.head__count {
  font-size: 26rpx;
  color: var(--mb-color-text-secondary);
}

.head__actions {
  display: flex;
  flex-direction: row;
  gap: 24rpx;
}

.link {
  font-size: 24rpx;
  color: var(--mb-color-primary);
}

.page__error {
  font-size: 26rpx;
  color: var(--mb-color-error);
}

.card {
  display: flex;
  flex-direction: row;
  gap: 16rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  background-color: var(--mb-color-surface);
}

.card--read {
  opacity: 0.6;
}

.card__dot {
  width: 14rpx;
  height: 14rpx;
  margin-top: 12rpx;
  border-radius: 999rpx;
  background-color: transparent;
}

.card__dot--unread {
  background-color: var(--mb-color-error);
}

.card__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6rpx;
}

.card__title {
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
}

.card__body-text {
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
}

.card__time {
  font-size: 22rpx;
  color: var(--mb-color-text-disabled);
}

.page__loading {
  font-size: 24rpx;
  color: var(--mb-color-text-disabled);
  text-align: center;
}

.more,
.foot {
  padding: 20rpx;
  text-align: center;
}

.more__label,
.foot__label {
  font-size: 24rpx;
  color: var(--mb-color-primary);
}
</style>
