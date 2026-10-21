<script setup lang="ts">
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import type { MemberDto, ReminderDto, ReminderListFilter } from '@moonbud/shared'
import { membersApi, remindersApi } from '../../api/endpoints'
import { confirmLoginGate } from '../../guest/gate'
import { guardForcedChange } from '../../utils/forced-change'
import { resyncActiveReminderSchedules, assigneeLabel } from '../../notifications/reminder-arming'
import { refreshUnreadTabBadge } from '../../notifications/tab-badge'
import { reminderCardLabel } from '../../reminders/card-label'
import EmptyState from '../../components/EmptyState.vue'
import GuestGuide from '../../components/GuestGuide.vue'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { useAuthStore } from '../../stores/auth'
import { useFamilyStore } from '../../stores/family'

const TABS = ['待办', '已过期', '已完成']
const PAGE_SIZE = 50
const FILTERS: ReminderListFilter[] = ['ACTIVE', 'OVERDUE', 'DONE']
const EMPTY_HINTS = [
  '睡前的维生素、明天的体检，都可以让它替你记住。',
  '该做的都按时做完了。',
  '一次性提醒完成后归档到这里；重复提醒只完当天那一次，不会离开待办。',
]

const authStore = useAuthStore()
const familyStore = useFamilyStore()

const isGuest = computed(() => authStore.isGuest)

const tabIndex = ref(0)
const reminders = ref<ReminderDto[]>([])
const members = ref<MemberDto[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
// 服务端说的总数与已经拿到手的条数：只有这两个数能证明"这一档还有没显示的"。
const total = ref(0)
const page = ref(1)
const hasMore = computed(() => reminders.value.length < total.value)

const familyId = computed(() => familyStore.currentFamilyId ?? '')

/**
 * 卡片上"该谁"和推送正文必须是同一句话，所以用同一个函数，别各写一份。
 */
const whoLabel = (assigneeId: string | null) => assigneeLabel(members.value, assigneeId)

/**
 * 切分段、下拉、回到本页都可能并发。被"正在加载"挡掉的那一次会让高亮的分段
 * 和列表内容不是同一个筛选条件，所以排队串行，后一次一定真跑。
 */
let queue: Promise<void> = Promise.resolve()

function load(reset = true): Promise<void> {
  const next = queue.then(() => run(reset))
  queue = next.catch(() => undefined)
  return next
}

async function run(reset: boolean): Promise<void> {
  if (!familyId.value) return
  loading.value = true
  error.value = null
  const target = reset ? 1 : page.value + 1
  try {
    const [res, list] = await Promise.all([
      remindersApi.list(familyId.value, FILTERS[tabIndex.value], { page: target, pageSize: PAGE_SIZE }),
      members.value.length ? Promise.resolve(members.value) : membersApi.list(familyId.value),
    ])
    // 第一页要换掉旧内容，后面的页是接着往下长：写成覆盖会让人以为卡片被吞了。
    reminders.value = reset ? res.items : [...reminders.value, ...res.items]
    total.value = res.total
    page.value = target
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
    await remindersApi.complete(familyId.value, reminder.id)
    uni.showToast({ title: '已完成本次', icon: 'none' })
    await load()
    // 排期交给这一家的 ACTIVE 集合重算：本机点完这一次，下一次该在什么时候响
    // 不由这里猜，而由"服务端还列出它吗"决定 —— 别的设备上的改动也一起跟上。
    await resyncActiveReminderSchedules()
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '操作失败', icon: 'none' })
  }
}

/**
 * 游客看得到分段与提醒中心，点其中任何一处只问一句。判断集中在这里，
 * 不散进模板：加一格分段就有人忘记问。
 */
function gate(key: string): boolean {
  if (!authStore.isGuest) return false
  void confirmLoginGate(key)
  return true
}

function pickTab(index: number): void {
  if (gate('提醒分段')) return
  if (tabIndex.value === index) return
  tabIndex.value = index
  void load()
}

const goDetail = (id: string) => uni.navigateTo({ url: `/pages/reminder-form/index?id=${id}` })
const goCreate = () => uni.navigateTo({ url: '/pages/reminder-form/index' })
const goFamily = () => uni.navigateTo({ url: '/pages/family-select/index' })

function goNotifications(): void {
  if (gate('/pages/notification-center/index')) return
  uni.navigateTo({ url: '/pages/notification-center/index' })
}

// onLoad 已经拉过；onShow 只代表"从别处回到本页"。两边都拉会让首屏发双份请求。
/**
 * 这一份实例在"游客 → 登录 → 切回本页"时不会被重建：记一下它为哪个账号拉过家庭列表。
 * 不记的话刚登录的人会站在"还没有家庭"上——那是上一个身份（没人）留下的骨架。
 */
let loadedForUser: string | null = null

/** 进入这一屏：会话没落定之前不读，游客这一屏一条请求都不发。 */
async function enter(): Promise<void> {
  // isLoggedIn 是内存态，冷启动第一帧必然是 null；不等它就判游客，
  // 老用户打开应用会先看一眼"来登录吧"。
  if (authStore.session === 'unknown') await authStore.bootstrap()
  if (!authStore.isLoggedIn) return
  const userId = authStore.user?.id ?? ''
  if (loadedForUser !== userId) {
    await familyStore.load()
    loadedForUser = userId
  }
  await load()
}

onLoad(() => void enter())

onShow(() => {
  guardForcedChange(authStore.mustChangePassword)
  // 这一格头顶的数字就是本页的入口信号：读完通知切回来要跟着掉。
  // 游客（以及会话还没问出来的那一趟）不画它——那是上一个账号留下的未读数。
  if (!authStore.isLoggedIn) return
  // 提醒中心点了某条通知跳回来时，要落在"待办"而不是上次停留的分段。
  if (uni.getStorageSync('reminderTabFocus') === 'ACTIVE') {
    uni.removeStorageSync('reminderTabFocus')
    tabIndex.value = 0
  }
  void enter()
  void refreshUnreadTabBadge()
})

onPullDownRefresh(() => {
  void load().finally(() => uni.stopPullDownRefresh())
})
</script>

<template>
  <theme-root>
    <view class="page">
      <!-- 会话还没问出来的那一瞬，无论是"来登录吧"还是"去创建家庭"，两句都是谎话。 -->
      <empty-state
        v-if="authStore.session === 'unknown'"
        icon="🌙"
        title="正在确认登录状态"
        hint="稍一下下，这一家的提醒马上就来。"
      />

      <empty-state
        v-else-if="!isGuest && !familyId"
        icon="🏠"
        title="还没有家庭"
        hint="创建一个家庭，提醒才能分给家人。"
        action-label="去创建家庭"
        @action="goFamily"
      />

      <template v-else>
        <!-- 分段与提醒中心和会员看到的是同一副骨架：复制两遍就会有一份跟着不上改动。 -->
        <u-subsection :list="TABS" :current="tabIndex" active-color="var(--mb-color-primary)" @change="pickTab" />

        <view class="link-row">
          <text class="link" @click="goNotifications">提醒中心 ›</text>
        </view>

        <text v-if="error" class="page__error">{{ error }}</text>

        <view v-for="item in reminders" :key="item.id" class="card" @click="goDetail(item.id)">
          <view class="card__main">
            <text class="card__title">{{ item.title }}</text>
            <text class="card__due">{{ reminderCardLabel(item) }}</text>
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

        <!-- 空白区：游客看到的是"来登录吧"，会员看到的是"这一档没有提醒"。 -->
        <guest-guide v-if="isGuest" page="reminders" />

        <empty-state
          v-else-if="!loading && !reminders.length && !error"
          :icon="FILTERS[tabIndex] === 'DONE' ? '✅' : '⏰'"
          :title="`没有${TABS[tabIndex]}的提醒`"
          :hint="EMPTY_HINTS[tabIndex]"
          action-label="＋ 设一个提醒"
          @action="goCreate"
        />
        <text v-if="loading" class="page__loading">加载中…</text>
        <view v-if="!loading && hasMore" class="more" @click="load(false)">
          <text class="more__label">加载更多</text>
        </view>
      </template>

      <view v-if="familyId && !isGuest" class="fab" @click="goCreate"><text class="fab__label">＋</text></view>
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

.more {
  padding: 20rpx;
  text-align: center;
}

.more__label {
  font-size: 24rpx;
  color: var(--mb-color-primary);
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
