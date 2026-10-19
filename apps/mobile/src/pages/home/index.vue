<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { EVENT_TYPES, type EventDto } from '@moonbud/shared'
import ChildSwitcher from '../../components/ChildSwitcher.vue'
import FamilySwitcher from '../../components/FamilySwitcher.vue'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { eventsApi, remindersApi } from '../../api/endpoints'
import { EVENT_TYPE_META } from '../../events/event-fields'
import { buildTodaySummary, type TodaySummary } from '../../events/summary'
import { buildOverviewRows, decideHomeView } from './home-view'
import { refreshUnreadTabBadge } from '../../notifications/tab-badge'
import { useAuthStore } from '../../stores/auth'
import { useChildStore } from '../../stores/child'
import { useFamilyStore } from '../../stores/family'

const authStore = useAuthStore()
const familyStore = useFamilyStore()
const childStore = useChildStore()

const summary = ref<TodaySummary | null>(null)
const loading = ref(false)
const familyLoadFailed = ref(false)
const overviewFailed = ref(false)

const familyId = computed(() => familyStore.currentFamilyId ?? '')
const child = computed(() => childStore.currentChild(familyId.value))
const timezone = computed(() => authStore.user?.timezone ?? 'Asia/Shanghai')
// 这个家庭的名单是不是已经读到过。没读到过 != 没有孩子。
const childrenLoaded = computed(() => familyId.value in childStore.childrenByFamily)
// 只在这次请求真的失败了才算失败：error 是全局的，别把上一次/别人的家庭的错误算进来。
const childrenLoadFailed = computed(() => !childrenLoaded.value && !childStore.loading && childStore.error !== null)

let refreshSeq = 0

async function refresh(): Promise<void> {
  if (!familyId.value || !child.value) {
    summary.value = null
    overviewFailed.value = false
    return
  }
  // 切孩子和上一次请求是并发的：序号不是最新的那一次不许落数据，
  // 否则当前孩子名下会显示上一个孩子的记录。
  const seq = ++refreshSeq
  loading.value = true
  try {
    // 概览只要"最近"的少量记录：拉 30 条足够算出今天换了几次尿布。
    // 过期数只借服务端算好的 total（pageSize 1 就够）：重复提醒在列表里 dueAt 是
    // null，自己筛 ACTIVE 会把它数成 0，横幅于是永远安静。
    const [events, overduePage] = await Promise.all([
      eventsApi.list(familyId.value, { childId: child.value.id, pageSize: 30 }),
      remindersApi.list(familyId.value, 'OVERDUE', { pageSize: 1 }),
    ])
    if (seq !== refreshSeq) return
    summary.value = buildTodaySummary({
      events: events.items as EventDto[],
      overdueCount: overduePage.total,
      timezone: timezone.value,
    })
    overviewFailed.value = false
  } catch {
    // 失败也要说"失败了"：summary 置空只用于算不出内容，界面另用 overviewFailed 分辨。
    if (seq !== refreshSeq) return
    summary.value = null
    overviewFailed.value = true
  } finally {
    if (seq === refreshSeq) loading.value = false
  }
}

async function retry(): Promise<void> {
  const ok = await familyStore.load()
  familyLoadFailed.value = !ok
  if (ok && familyId.value) await childStore.load(familyId.value)
  await refresh()
}

/**
 * 临时密码必须改掉才能用（spec 第 5 节）。/me 已带回这个布尔，
 * 所以冷启动刷新页面后守卫同样成立。
 * 标记位防止 onShow 反复触发把修改密码页叠成两层；标记在改完（布尔转假）后复位。
 */
let forcedHandled = false
function guardForcedChange(): void {
  if (!authStore.mustChangePassword || forcedHandled) return
  forcedHandled = true
  // 带 forced=1：改密页才知道自己是"被拦下来的"，既显示原因，也决定改完回首页而不是返回上一层。
  uni.navigateTo({ url: '/pages/change-password/index?forced=1' })
}
watch(
  () => authStore.mustChangePassword,
  (needed) => {
    if (!needed) forcedHandled = false
  },
)

onLoad(async () => {
  familyLoadFailed.value = !(await familyStore.load())
  if (familyId.value) await childStore.load(familyId.value)
  await refresh()
})

onShow(() => {
  guardForcedChange()
  void refresh()
  // tabBar 这时已经挂载，而冷启动的 App.onShow 早于它：角标要在落地页补这一下。
  void refreshUnreadTabBadge()
})

onPullDownRefresh(() => {
  void refresh().finally(() => uni.stopPullDownRefresh())
})

const goReminders = () => uni.switchTab({ url: '/pages/reminder-list/index' })
const goChildForm = () => uni.navigateTo({ url: '/pages/child-form/index' })
const goFamilySelect = () => uni.navigateTo({ url: '/pages/family-select/index' })
const goEvent = (type: string) => uni.navigateTo({ url: `/pages/event-form/index?type=${type}` })
const rowIcon = (key: string) =>
  EVENT_TYPE_META[key as keyof typeof EVENT_TYPE_META].icon

const view = computed(() =>
  decideHomeView({
    familyLoadFailed: familyLoadFailed.value,
    familyId: familyId.value,
    hasChild: !!child.value,
    childrenLoaded: childrenLoaded.value,
    childrenLoadFailed: childrenLoadFailed.value,
  }),
)
const rows = computed(() => buildOverviewRows(summary.value, overviewFailed.value, timezone.value))
const overdueCount = computed(() => summary.value?.overdueCount ?? 0)
</script>

<template>
  <theme-root>
    <view class="home">
      <view class="home__switchers">
        <family-switcher @change="refresh" />
        <child-switcher @change="refresh" />
      </view>

      <view v-if="view === 'retry'" class="home__empty">
        <text class="home__empty-title">家庭列表没加载出来</text>
        <text class="home__hint">{{ familyStore.error ?? '网络或后端暂时不可用，重试一下即可。' }}</text>
        <view class="btn" @click="retry"><text class="btn__label">重试</text></view>
      </view>

      <view v-else-if="view === 'create-family'" class="home__empty">
        <text class="home__empty-title">还没有家庭</text>
        <text class="home__hint">创建一个家庭，或凭邀请码加入家人的家庭。</text>
        <view class="btn" @click="goFamilySelect"><text class="btn__label">去创建或加入</text></view>
      </view>

      <view v-else-if="view === 'loading'" class="home__empty">
        <text class="home__empty-title">正在读取孩子名单</text>
        <text class="home__hint">记录、提醒都按孩子来看，稍一下下。</text>
      </view>

      <view v-else-if="view === 'child-retry'" class="home__empty">
        <text class="home__empty-title">孩子名单没加载出来</text>
        <text class="home__hint">{{ childStore.error ?? '网络或后端暂时不可用，重试一下即可。' }}</text>
        <view class="btn" @click="retry"><text class="btn__label">重试</text></view>
      </view>

      <view v-else-if="view === 'add-child'" class="home__empty">
        <text class="home__empty-title">还没有孩子</text>
        <text class="home__hint">记录都要挂在一个孩子身上，先添加一个。</text>
        <view class="btn" @click="goChildForm"><text class="btn__label">添加孩子</text></view>
      </view>

      <template v-else>
        <view v-if="overdueCount > 0" class="alert" @click="goReminders">
          <text class="alert__text">{{ overdueCount }} 条提醒已过期，点此查看</text>
        </view>

        <view v-if="overviewFailed" class="alert alert--retry" @click="retry">
          <text class="alert__text">概览没加载出来，点此重试（下面的数字现在不可信）</text>
        </view>

        <view class="card">
          <view v-for="row in rows" :key="row.key" class="card__row">
            <text class="card__icon">{{ rowIcon(row.key) }}</text>
            <view class="card__body">
              <text class="card__label">{{ row.label }}</text>
              <text class="card__value" :class="{ 'card__value--failed': row.failed }">{{ row.value }}</text>
            </view>
          </view>
        </view>

        <text class="section__title">记一笔</text>
        <view class="grid">
          <view v-for="type in EVENT_TYPES" :key="type" class="grid__cell" @click="goEvent(type)">
            <text class="grid__icon">{{ EVENT_TYPE_META[type].icon }}</text>
            <text class="grid__label">{{ EVENT_TYPE_META[type].label }}</text>
          </view>
        </view>
      </template>
    </view>
  </theme-root>
</template>

<style scoped>
.home {
  padding: 32rpx 40rpx 96rpx;
  display: flex;
  flex-direction: column;
  gap: 28rpx;
}

.home__switchers {
  display: flex;
  flex-direction: row;
  gap: 16rpx;
}

.home__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
  padding: 80rpx 24rpx;
}

.home__empty-title {
  font-size: 34rpx;
  font-weight: 700;
  color: var(--mb-color-text-primary);
}

.home__hint {
  font-size: 26rpx;
  color: var(--mb-color-text-secondary);
  text-align: center;
}

.alert {
  padding: 22rpx 26rpx;
  border-radius: 16rpx;
  background-color: var(--mb-color-surface-alt);
  border-left: 6rpx solid var(--mb-color-error);
}

.alert__text {
  font-size: 26rpx;
  color: var(--mb-color-error);
}

.alert--retry {
  background-color: var(--mb-color-error);
}

.alert--retry .alert__text {
  color: var(--mb-color-on-primary);
}

.card__value--failed {
  color: var(--mb-color-error);
}

.card {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  padding: 32rpx;
  border-radius: 24rpx;
  background-color: var(--mb-color-surface);
  border: 1rpx solid var(--mb-color-border);
}

.card__row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 20rpx;
}

.card__icon {
  font-size: 40rpx;
}

.card__body {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.card__label {
  font-size: 22rpx;
  color: var(--mb-color-text-secondary);
}

.card__value {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--mb-color-text-primary);
}

.section__title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--mb-color-text-primary);
}

.grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.grid__cell {
  width: 25%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
  padding: 26rpx 0;
}

.grid__icon {
  font-size: 46rpx;
}

.grid__label {
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  padding: 0 48rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-primary);
}

.btn__label {
  font-size: 30rpx;
  color: var(--mb-color-on-primary);
}
</style>
