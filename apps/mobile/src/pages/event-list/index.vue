<script setup lang="ts">
import { EVENT_TYPES, type EventDto, type EventType } from '@moonbud/shared'
import { onLoad, onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { eventsApi } from '../../api/endpoints'
import { canModifyEvent, stageForEdit } from '../../events/event-edit'
import { EVENT_TYPE_META } from '../../events/event-fields'
import { formatEventLine } from '../../events/format-event'
import { confirmDanger } from '../../utils/confirm'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { useAuthStore } from '../../stores/auth'
import { useChildStore } from '../../stores/child'
import { useFamilyStore } from '../../stores/family'

const PAGE_SIZE = 20

const authStore = useAuthStore()
const familyStore = useFamilyStore()
const childStore = useChildStore()

const events = ref<EventDto[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const error = ref<string | null>(null)
const typeFilter = ref<EventType | ''>('')

const familyId = computed(() => familyStore.currentFamilyId ?? '')
const children = computed(() => childStore.childrenByFamily[familyId.value] ?? [])
const childId = computed(() => childStore.currentChild(familyId.value)?.id ?? '')
const hasMore = computed(() => events.value.length < total.value)

/** 按天分组：家长回忆"那天下午"，不是"14:32 那条"。 */
const groups = computed(() => {
  const out: { key: string; label: string; items: EventDto[] }[] = []
  for (const event of events.value) {
    const key = dayKey(event.occurredAt)
    const last = out[out.length - 1]
    if (last && last.key === key) last.items.push(event)
    else out.push({ key, label: dayLabel(key), items: [event] })
  }
  return out
})

function dayKey(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'unknown' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(key: string): string {
  if (key === 'unknown') return '未知时间'
  const [y, m, d] = key.split('-').map(Number)
  const now = new Date()
  const today = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  const yesterday = new Date(now.getTime() - 86_400_000)
  if (key === today) return '今天'
  if (key === `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`) return '昨天'
  return `${m + 1}月${d}日`
}

async function load(reset: boolean): Promise<void> {
  if (!familyId.value) return
  if (loading.value) return
  loading.value = true
  error.value = null
  const next = reset ? 1 : page.value + 1
  try {
    const res = await eventsApi.list(familyId.value, {
      childId: childId.value || undefined,
      type: typeFilter.value || undefined,
      page: next,
      pageSize: PAGE_SIZE,
    })
    events.value = reset ? res.items : [...events.value, ...res.items]
    total.value = res.total
    page.value = next
  } catch (err) {
    error.value = err instanceof Error ? err.message : '记录加载失败'
  } finally {
    loading.value = false
    uni.stopPullDownRefresh()
  }
}

// onLoad 里已经拉过一次；onShow 只负责"从别处回到本页"的那些场合。
// 用 ready 而不是"列表非空"来判定：第一条记录保存回来时列表正是空的。
let ready = false

onLoad(async () => {
  await familyStore.load()
  if (familyId.value) await childStore.load(familyId.value)
  await load(true)
  ready = true
})

// 从表单返回时必须看到新记录，比"表单在返回前刷新列表"更可靠：
// 任何回到本页的路径都会触发，不只是保存成功那一条。
onShow(() => {
  if (ready) void load(true)
})

onPullDownRefresh(() => void load(true))
onReachBottom(() => {
  if (hasMore.value && !loading.value) void load(false)
})

function pickType(next: EventType | '') {
  if (typeFilter.value === next) return
  typeFilter.value = next
  void load(true)
}

function pickChild(next: string) {
  if (!familyId.value) return
  childStore.select(familyId.value, next)
  void load(true)
}

const goForm = () => uni.navigateTo({ url: '/pages/event-form/index' })
const goFamily = () => uni.navigateTo({ url: '/pages/family-select/index' })
const goChild = () => uni.navigateTo({ url: '/pages/child-form/index' })

const myRole = computed(() => familyStore.currentFamily?.role ?? null)

function editEvent(event: EventDto): void {
  if (!canModifyEvent(event, authStore.user?.id ?? null, myRole.value)) {
    uni.showToast({ title: '只有记这条的人或管理员能改', icon: 'none' })
    return
  }
  // 后端没有 GET /events/:id，整条记录由这里交接给表单（见 events/event-edit.ts）。
  stageForEdit(event)
  uni.navigateTo({ url: `/pages/event-form/index?id=${event.id}` })
}

async function removeEvent(event: EventDto): Promise<void> {
  if (!canModifyEvent(event, authStore.user?.id ?? null, myRole.value)) {
    uni.showToast({ title: '只有记这条的人或管理员能删', icon: 'none' })
    return
  }
  const go = await confirmDanger({
    title: '删掉这条记录？',
    content: `${formatEventLine(event)} —— ${event.createdByNickname} 记的。删掉后全家都看不到它了。`,
    confirmText: '删除',
  })
  if (!go) return
  try {
    await eventsApi.remove(familyId.value, event.id)
    events.value = events.value.filter((e) => e.id !== event.id)
    total.value = Math.max(0, total.value - 1)
    uni.showToast({ title: '已删除', icon: 'none' })
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '删除失败', icon: 'none' })
  }
}
</script>

<template>
  <theme-root>
    <view class="timeline">
      <view v-if="!familyId" class="timeline__notice">
        <text class="timeline__notice-text">还没有家庭，先创建一个才能记录。</text>
        <view class="btn btn--ghost" @click="goFamily"><text class="btn__label">去创建家庭</text></view>
      </view>

      <view v-else-if="!childId" class="timeline__notice">
        <text class="timeline__notice-text">这个家庭还没有孩子，先添加一个才能记。</text>
        <view class="btn btn--ghost" @click="goChild"><text class="btn__label">添加孩子</text></view>
      </view>

      <view v-else class="timeline__filters">
        <scroll-view scroll-x class="chips">
          <view class="chip-row">
            <view
              class="chip"
              :class="{ 'chip--active': typeFilter === '' }"
              @click="pickType('')"
            >
              <text class="chip__label">全部</text>
            </view>
            <view
              v-for="t in EVENT_TYPES"
              :key="t"
              class="chip"
              :class="{ 'chip--active': typeFilter === t }"
              @click="pickType(t)"
            >
              <text class="chip__label">{{ EVENT_TYPE_META[t].icon }} {{ EVENT_TYPE_META[t].label }}</text>
            </view>
          </view>
        </scroll-view>

        <scroll-view v-if="children.length > 1" scroll-x class="chips">
          <view class="chip-row">
            <view
              v-for="c in children"
              :key="c.id"
              class="chip"
              :class="{ 'chip--active': c.id === childId }"
              @click="pickChild(c.id)"
            >
              <text class="chip__label">{{ c.name }}</text>
            </view>
          </view>
        </scroll-view>
      </view>

      <text v-if="error" class="timeline__error">{{ error }}</text>

      <view v-for="group in groups" :key="group.key" class="group">
        <text class="group__label">{{ group.label }}</text>
        <view v-for="event in group.items" :key="event.id" class="card">
          <view class="card__main" @click="editEvent(event)">
            <text class="card__line">{{ formatEventLine(event) }}</text>
            <text class="card__who">{{ event.createdByNickname }} 记 · 点此编辑</text>
          </view>
          <view class="card__delete" @click="removeEvent(event)">
            <text class="card__delete-label">删除</text>
          </view>
        </view>
      </view>

      <u-empty
        v-if="!loading && !groups.length && !error"
        mode="list"
        text="还没有记录，点右下角记一笔"
      />
      <text v-if="loading" class="timeline__loading">加载中…</text>

      <view v-if="childId" class="fab" @click="goForm"><text class="fab__label">＋</text></view>
    </view>
  </theme-root>
</template>

<style scoped>
.timeline {
  padding: 24rpx 32rpx 160rpx;
}

.timeline__notice {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  padding: 40rpx 0;
}

.timeline__notice-text {
  font-size: 28rpx;
  color: var(--mb-color-text-secondary);
}

.timeline__filters {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.chips {
  white-space: nowrap;
}

.chip-row {
  display: flex;
  flex-direction: row;
  gap: 12rpx;
}

.chip {
  padding: 10rpx 22rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-surface-alt);
}

.chip--active {
  background-color: var(--mb-color-primary);
}

.chip__label {
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
}

.chip--active .chip__label {
  color: var(--mb-color-on-primary);
}

.timeline__error {
  display: block;
  margin: 20rpx 0;
  font-size: 26rpx;
  color: var(--mb-color-error);
}

.group {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  margin-top: 32rpx;
}

.group__label {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--mb-color-text-secondary);
}

.card {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  background-color: var(--mb-color-surface);
}

.card__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.card__delete {
  padding: 10rpx 20rpx;
  border-radius: 999rpx;
  border: 1rpx solid var(--mb-color-border);
}

.card__delete-label {
  font-size: 22rpx;
  color: var(--mb-color-error);
}

.card__line {
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
}

.card__who {
  font-size: 22rpx;
  color: var(--mb-color-text-disabled);
}

.timeline__loading {
  display: block;
  margin-top: 24rpx;
  font-size: 24rpx;
  color: var(--mb-color-text-disabled);
  text-align: center;
}

.fab {
  position: fixed;
  right: 40rpx;
  bottom: 60rpx;
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

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 80rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-primary);
}

.btn--ghost {
  align-self: flex-start;
  padding: 0 32rpx;
  background-color: var(--mb-color-surface-alt);
}

.btn__label {
  font-size: 28rpx;
  color: var(--mb-color-on-primary);
}

.btn--ghost .btn__label {
  color: var(--mb-color-text-primary);
}
</style>
