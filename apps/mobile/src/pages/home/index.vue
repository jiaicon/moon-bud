<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { EVENT_TYPES, type EventDto } from '@moonbud/shared'
import ChildSwitcher from '../../components/ChildSwitcher.vue'
import FamilySwitcher from '../../components/FamilySwitcher.vue'
import GuestGuide from '../../components/GuestGuide.vue'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { assistantTarget } from '../../assistant/draft-target'
import { ApiRequestError } from '../../api/errors'
import { assistantApi, eventsApi, remindersApi } from '../../api/endpoints'
import { EVENT_TYPE_META } from '../../events/event-fields'
import { buildTodaySummary, type TodaySummary } from '../../events/summary'
import { buildGuestOverviewRows, buildOverviewRows, decideHomeView } from './home-view'
import { guardForcedChange } from '../../utils/forced-change'
import { refreshUnreadTabBadge } from '../../notifications/tab-badge'
import { mergePendingRows } from '../../sync/pending-view'
import { useAuthStore } from '../../stores/auth'
import { useChildStore } from '../../stores/child'
import { useFamilyStore } from '../../stores/family'
import { useOutboxStore } from '../../stores/outbox'

const authStore = useAuthStore()
const familyStore = useFamilyStore()
const childStore = useChildStore()
const outboxStore = useOutboxStore()

const summary = ref<TodaySummary | null>(null)
const loading = ref(false)
const familyLoadFailed = ref(false)
const overviewFailed = ref(false)

const familyId = computed(() => familyStore.currentFamilyId ?? '')
const child = computed(() => childStore.currentChild(familyId.value))
const timezone = computed(() => authStore.user?.timezone ?? 'Asia/Shanghai')
// 待同步那条还没经过服务端，"谁记的"只能是当前账号自己。
const sessionMeta = computed(() => ({
  userId: authStore.user?.id ?? '',
  nickname: authStore.user?.nickname ?? '',
}))
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
  // 内存里那份队列是空的，上次断网记下的东西在盘上：不先捞回来就等于没看见。
  outboxStore.load()
  try {
    // 概览只要"最近"的少量记录：拉 30 条足够算出今天换了几次尿布。
    // 过期数只借服务端算好的 total（pageSize 1 就够）：重复提醒在列表里 dueAt 是
    // null，自己筛 ACTIVE 会把它数成 0，横幅于是永远安静。
    const [events, overduePage] = await Promise.all([
      eventsApi.list(familyId.value, { childId: child.value.id, pageSize: 30 }),
      remindersApi.list(familyId.value, 'OVERDUE', { pageSize: 1 }),
    ])
    if (seq !== refreshSeq) return
    // 断网时记下的那几笔也要数：记录页挂着它们，概览说"今天 0 次"就是两数打脸。
    summary.value = buildTodaySummary({
      events: mergePendingRows(
        events.items as EventDto[],
        outboxStore.items,
        familyId.value,
        sessionMeta.value,
      ).filter((e) => e.childId === child.value?.id),
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

/**
 * 这一份页面实例在"游客 → 登录 → switchTab 回首页"这一趟里不会被重建：
 * 记一下它为哪个账号拉过家庭列表，换了账号就重拉。不记的话刚登录的人会站在
 * "还没有家庭"上，而他其实早就有——那是上一个身份（没人）留下的骨架。
 */
let loadedForUser: string | null = null

/** 进入这一屏：先问清会话，再按身份决定读什么、说哪一句。 */
async function doEnter(): Promise<void> {
  // isLoggedIn 读的是内存里的 access token，冷启动第一帧必然是 null。不等会话落定
  // 就判游客，每个老用户打开应用都会先被问一遍"要不要登录"。
  if (authStore.session === 'unknown') await authStore.bootstrap()
  // 游客（以及问不出来的那一趟）不发任何取数请求，也不画角标：角标上的数字是
  // 上一个账号的未读，留着不放等于替他保管。
  if (!authStore.isLoggedIn) return
  const userId = authStore.user?.id ?? ''
  if (loadedForUser !== userId) {
    familyLoadFailed.value = !(await familyStore.load())
    if (familyId.value) await childStore.load(familyId.value)
    // 拉失败时不记下这个账号：下一次进这一屏还要再试，否则首页永远停在"重试"。
    if (!familyLoadFailed.value) loadedForUser = userId
  }
  await refresh()
  // tabBar 这时已经挂载，而冷启动的 App.onShow 早于它：角标要在落地页补这一下。
  void refreshUnreadTabBadge()
}

/**
 * onLoad 和紧随其后的 onShow 会同时在等这次会话：两边都等出结果后各自跑一趟，
 * 首屏就发了双份家庭列表。并入同一次。
 */
let enterFlight: Promise<void> | null = null

function enter(): Promise<void> {
  if (enterFlight) return enterFlight
  enterFlight = doEnter().finally(() => {
    enterFlight = null
  })
  return enterFlight
}

async function retry(): Promise<void> {
  const ok = await familyStore.load()
  familyLoadFailed.value = !ok
  if (ok && familyId.value) await childStore.load(familyId.value)
  if (ok) loadedForUser = authStore.user?.id ?? null
  await refresh()
}

onLoad(() => void enter())

// 临时密码没改掉就不许在本页停留（四个 tabBar 页各拦一次，判据是改密页在不在栈顶）。
onShow(() => {
  guardForcedChange(authStore.mustChangePassword)
  void enter()
})

onPullDownRefresh(() => {
  void enter().finally(() => uni.stopPullDownRefresh())
})

const goReminders = () => uni.switchTab({ url: '/pages/reminder-list/index' })
const goChildForm = () => uni.navigateTo({ url: '/pages/child-form/index' })
const goFamilySelect = () => uni.navigateTo({ url: '/pages/family-select/index' })
const goEvent = (type: string) => uni.navigateTo({ url: `/pages/event-form/index?type=${type}` })
const goStats = () => uni.navigateTo({ url: '/pages/stats/index' })
const rowIcon = (key: string) =>
  EVENT_TYPE_META[key as keyof typeof EVENT_TYPE_META].icon

const isGuest = computed(() => authStore.isGuest)

const view = computed(() =>
  decideHomeView({
    session: authStore.session,
    familyLoadFailed: familyLoadFailed.value,
    familyId: familyId.value,
    hasChild: !!child.value,
    childrenLoaded: childrenLoaded.value,
    childrenLoadFailed: childrenLoadFailed.value,
  }),
)
const rows = computed(() => buildOverviewRows(summary.value, overviewFailed.value, timezone.value))
const guestRows = computed(() => buildGuestOverviewRows())
const overdueCount = computed(() => summary.value?.overdueCount ?? 0)

// ---- 说一句话 ----
// 话交给服务端换成草稿，这一屏只做两件事：把人搬进表单，以及没说清时不装懂。
const askText = ref('')
const asking = ref(false)

async function submitAssistant(): Promise<void> {
  if (!askText.value.trim() || asking.value) return
  const text = askText.value.trim()
  asking.value = true
  try {
    const result = await assistantApi.parse(text)
    const target = assistantTarget(result, {
      familyId: familyId.value,
      // 只跟着当前孩子走：草稿里没有"孩子"这个概念，不替人猜一个。
      childId: child.value?.id ?? null,
    })
    if (target.kind === 'unknown') {
      uni.showToast({ title: '这句我没看懂，手动记一下', icon: 'none' })
      return
    }
    // 服务端丢掉的字段要说出来，否则人会以为表单里已经填全了。
    if (result.dropped.length > 0) {
      uni.showToast({ title: '有些字段没填上，表单里补一下', icon: 'none' })
    }
    uni.navigateTo({ url: target.url })
    askText.value = ''
  } catch (err) {
    // 429、超时这类服务端已经写好了一句话，用它；没有就说不看懂，别静默。
    uni.showToast({
      title: err instanceof ApiRequestError ? err.message : '这句我没看懂，手动记一下',
      icon: 'none',
    })
  } finally {
    asking.value = false
  }
}
</script>

<template>
  <theme-root>
    <view class="home">
      <view v-if="authStore.session === 'member'" class="home__switchers">
        <family-switcher @change="refresh" />
        <child-switcher @change="refresh" />
      </view>
      <!-- 游客也画这两格：它们定的是"看哪一家、给哪个孩子"，游客名下没有，所以写"无"。 -->
      <view v-else-if="isGuest" class="home__switchers">
        <view class="home__switcher">
          <text class="home__switcher-label">家庭</text>
          <text class="home__switcher-value">无</text>
        </view>
        <view class="home__switcher">
          <text class="home__switcher-label">孩子</text>
          <text class="home__switcher-value">无</text>
        </view>
      </view>

      <!-- 会话还没问出来的那一瞬，无论是"来登录吧"还是"去创建家庭"，两句都是谎话。 -->
      <view v-if="view === 'checking'" class="home__empty">
        <text class="home__empty-title">正在确认登录状态</text>
        <text class="home__hint">稍一下下，这一家的记录马上就来。</text>
      </view>

      <!--
        游客这一屏画的是同一副骨架：概览行留着、值给"无"，引导坐在内容区。
        记一笔与曲线整块不给——前者要落在一个孩子身上，后者要读这一家的记录，
        游客两样都没有，留一颗点了没反应的按钮比不给更骗人。
      -->
      <template v-else-if="view === 'guest'">
        <view class="card">
          <view v-for="row in guestRows" :key="row.key" class="card__row">
            <text class="card__icon">{{ rowIcon(row.key) }}</text>
            <view class="card__body">
              <text class="card__label">{{ row.label }}</text>
              <text class="card__value">{{ row.value }}</text>
            </view>
          </view>
        </view>

        <guest-guide page="home" />
      </template>

      <view v-else-if="view === 'retry'" class="home__empty">
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
        <!-- 一句话记录：只有既登了进来又有家庭又有孩子的人才看得见这一格。 -->
        <view class="ask">
          <input
            v-model="askText"
            class="ask__input"
            maxlength="200"
            placeholder="说一句话，如：刚刚瓶喂 120 毫升"
            confirm-type="done"
            @confirm="submitAssistant"
          />
          <view class="ask__go" :class="{ 'ask__go--busy': asking }" @click="submitAssistant">
            <text class="ask__go-label">{{ asking ? '在看…' : '记下' }}</text>
          </view>
        </view>

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

        <view class="stats-entry" @click="goStats">
          <text class="stats-entry__label">📊 看趋势 / 生长曲线</text>
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

/* 游客那两格占位长得和真切换器一样：同一副圆角胶囊，只是值是一个"无"字。 */
.home__switcher {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
  padding: 14rpx 22rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-surface-alt);
}

.home__switcher-label {
  font-size: 22rpx;
  color: var(--mb-color-text-secondary);
}

.home__switcher-value {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--mb-color-text-primary);
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

.ask {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
  padding: 12rpx 12rpx 12rpx 26rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-surface);
  border: 1rpx solid var(--mb-color-border);
}

.ask__input {
  flex: 1;
  /* 宿主不自带高度就会被 uni-app 定成 1.4em，inner 压成 1px：字打进去看不见（见 input-surface 门禁）。 */
  height: 68rpx;
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
}

.ask__go {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 68rpx;
  padding: 0 32rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-primary);
}

.ask__go--busy {
  opacity: 0.55;
}

.ask__go-label {
  font-size: 26rpx;
  color: var(--mb-color-on-primary);
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

.stats-entry {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24rpx;
  border-radius: 20rpx;
  border: 1rpx solid var(--mb-color-border);
  background-color: var(--mb-color-surface);
}

.stats-entry__label {
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
}
</style>
