<script setup lang="ts">
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { computeDueAt, type MemberDto, type ReminderDto, type ReminderListFilter } from '@moonbud/shared'
import { membersApi, remindersApi } from '../../api/endpoints'
import { cancelLocalNotification, scheduleLocalNotification } from '../../notifications/local-notify'
import { formatDueIn } from '../../reminders/due-label'
import EmptyState from '../../components/EmptyState.vue'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { useFamilyStore } from '../../stores/family'

const TABS = ['待办', '已过期', '已完成']
const FILTERS: ReminderListFilter[] = ['ACTIVE', 'OVERDUE', 'DONE']
const EMPTY_HINTS = [
  '睡前的维生素、明天的体检，都可以让它替你记住。',
  '该做的都按时做完了。',
  '点一下"完成本次"，提醒就会归档到这里。',
]

const familyStore = useFamilyStore()

const tabIndex = ref(0)
const reminders = ref<ReminderDto[]>([])
const members = ref<MemberDto[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const familyId = computed(() => familyStore.currentFamilyId ?? '')

function whoLabel(assigneeId: string | null): string {
  if (!assigneeId) return '全家'
  const member = members.value.find((m) => m.userId === assigneeId)
  return member?.displayName || member?.nickname || '家人'
}

/**
 * 后端列表里重复提醒的 dueAt 是 null（下一次由调度器按周期展开），
 * 直接显示会得到"下次 待定"。客户端用同一个 computeDueAt 把下次触发算出来，
 * 家长才知道"今天这点还要不要做"。
 */
function nextDue(reminder: ReminderDto): Date | null {
  if (reminder.type === 'ONE_TIME') return reminder.dueAt ? new Date(reminder.dueAt) : null
  if (reminder.dueAt) {
    const at = new Date(reminder.dueAt)
    if (!Number.isNaN(at.getTime()) && at.getTime() > Date.now()) return at
  }
  return computeDueAt({
    type: reminder.type,
    dueAt: reminder.dueAt ? new Date(reminder.dueAt) : null,
    rrule: reminder.rrule,
    timezone: reminder.timezone,
    after: new Date(),
  })
}

function dueLabel(reminder: ReminderDto): string {
  const next = nextDue(reminder)
  if (reminder.type === 'ONE_TIME') return next ? formatDueIn(reminder.timezone, next) : '未设定时间'
  const time = next ? formatDueIn(reminder.timezone, next) : '待调度'
  return `${RRULE_HINT(reminder.rrule)} · 下次 ${time}`
}

const RRULE_HINT = (rrule: string | null): string => {
  if (!rrule) return '重复'
  if (rrule.includes('FREQ=DAILY')) return rrule.includes('INTERVAL') ? `每 ${intervalOf(rrule)} 天` : '每天'
  if (rrule.includes('FREQ=WEEKLY')) return '每周'
  if (rrule.includes('FREQ=MONTHLY')) return '每月'
  return '重复'
}

function intervalOf(rrule: string): string {
  const m = /INTERVAL=(\d+)/.exec(rrule)
  return m ? m[1] : '?'
}

async function load(): Promise<void> {
  if (!familyId.value || loading.value) return
  loading.value = true
  error.value = null
  try {
    const [page, list] = await Promise.all([
      remindersApi.list(familyId.value, FILTERS[tabIndex.value], { pageSize: 50 }),
      members.value.length ? Promise.resolve(members.value) : membersApi.list(familyId.value),
    ])
    reminders.value = page.items
    members.value = list
  } catch (err) {
    error.value = err instanceof Error ? err.message : '提醒加载失败'
  } finally {
    loading.value = false
  }
}

/**
 * 完成按钮不能只显示"完成"：重复提醒点一下只完这一次，下一次仍然会来。
 * 文案写成"完成本次"，否则用户会以为整个提醒被关掉了。
 */
async function complete(reminder: ReminderDto): Promise<void> {
  try {
    const updated = await remindersApi.complete(familyId.value, reminder.id)
    const next = computeDueAt({
      type: updated.type,
      dueAt: updated.dueAt ? new Date(updated.dueAt) : null,
      rrule: updated.rrule,
      timezone: updated.timezone,
      after: new Date(),
    })
    if (next) scheduleLocalNotification({ id: updated.id, title: updated.title, body: whoLabel(updated.assigneeId), at: next })
    else cancelLocalNotification(updated.id)
    uni.showToast({ title: '已完成本次', icon: 'none' })
    await load()
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '操作失败', icon: 'none' })
  }
}

function pickTab(index: number): void {
  if (tabIndex.value === index) return
  tabIndex.value = index
  void load()
}

const goDetail = (id: string) => uni.navigateTo({ url: `/pages/reminder-form/index?id=${id}` })
const goCreate = () => uni.navigateTo({ url: '/pages/reminder-form/index' })
const goFamily = () => uni.navigateTo({ url: '/pages/family-select/index' })
const goNotifications = () => uni.navigateTo({ url: '/pages/notification-center/index' })

// onLoad 已经拉过；onShow 只代表"从别处回到本页"。两边都拉会让首屏发双份请求。
let ready = false

onLoad(async () => {
  await familyStore.load()
  await load()
  ready = true
})

onShow(() => {
  // 提醒中心点了某条通知跳回来时，要落在"待办"而不是上次停留的分段。
  if (uni.getStorageSync('reminderTabFocus') === 'ACTIVE') {
    uni.removeStorageSync('reminderTabFocus')
    tabIndex.value = 0
  }
  if (ready) void load()
})

onPullDownRefresh(() => {
  void load().finally(() => uni.stopPullDownRefresh())
})
</script>

<template>
  <theme-root>
    <view class="page">
      <empty-state
        v-if="!familyId"
        icon="🏠"
        title="还没有家庭"
        hint="创建一个家庭，提醒才能分给家人。"
        action-label="去创建家庭"
        @action="goFamily"
      />

      <template v-else>
        <u-subsection :list="TABS" :current="tabIndex" active-color="var(--mb-color-primary)" @change="pickTab" />

        <view class="link-row">
          <text class="link" @click="goNotifications">提醒中心 ›</text>
        </view>

        <text v-if="error" class="page__error">{{ error }}</text>

        <view v-for="item in reminders" :key="item.id" class="card" @click="goDetail(item.id)">
          <view class="card__main">
            <text class="card__title">{{ item.title }}</text>
            <text class="card__due">{{ dueLabel(item) }}</text>
            <text v-if="item.note" class="card__note">{{ item.note }}</text>
          </view>
          <view class="card__side">
            <text class="card__who">{{ whoLabel(item.assigneeId) }}</text>
            <view v-if="FILTERS[tabIndex] !== 'DONE'" class="done-btn" @click.stop="complete(item)">
              <text class="done-btn__label">完成本次</text>
            </view>
          </view>
        </view>

        <view v-if="reminders.length" class="bottom-spacer" />

        <empty-state
          v-if="!loading && !reminders.length && !error"
          :icon="FILTERS[tabIndex] === 'DONE' ? '✅' : '⏰'"
          :title="`没有${TABS[tabIndex]}的提醒`"
          :hint="EMPTY_HINTS[tabIndex]"
          action-label="＋ 设一个提醒"
          @action="goCreate"
        />
        <text v-if="loading" class="page__loading">加载中…</text>
      </template>

      <view v-if="familyId" class="fab" @click="goCreate"><text class="fab__label">＋</text></view>
    </view>
  </theme-root>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  min-height: calc(100vh - var(--window-top) - var(--window-bottom));
  box-sizing: border-box;
  padding: 24rpx 32rpx 40rpx;
}

/* 列表末尾留白：高度让最后一张卡片能滚到 FAB 之上。空状态不给这段，
   否则 min-height 会被内容顶开，"居中"就变成偏下。 */
.bottom-spacer {
  height: 140rpx;
}

.link-row {
  display: flex;
  justify-content: flex-end;
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
  justify-content: space-between;
  gap: 20rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  background-color: var(--mb-color-surface);
}

.card__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6rpx;
}

.card__title {
  font-size: 30rpx;
  color: var(--mb-color-text-primary);
}

.card__due {
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
}

.card__note {
  font-size: 22rpx;
  color: var(--mb-color-text-disabled);
}

.card__side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12rpx;
}

.card__who {
  font-size: 22rpx;
  color: var(--mb-color-text-disabled);
}

.done-btn {
  padding: 10rpx 22rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-primary-light);
}

.done-btn__label {
  font-size: 22rpx;
  color: var(--mb-color-primary);
}

.page__loading {
  font-size: 24rpx;
  color: var(--mb-color-text-disabled);
  text-align: center;
}

.fab {
  position: fixed;
  right: 40rpx;
  /* 不加 --window-bottom 的话，按钮的下半截正好被 tabBar 盖住。 */
  bottom: calc(var(--window-bottom) + 40rpx);
  width: 108rpx;
  height: 108rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.18);
}

.fab__label {
  font-size: 48rpx;
  color: var(--mb-color-on-primary);
}
</style>
