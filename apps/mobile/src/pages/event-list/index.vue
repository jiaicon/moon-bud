<script setup lang="ts">
import { EVENT_TYPES, type EventDto, type EventType } from '@moonbud/shared'
import { onLoad, onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app'
import { computed, getCurrentInstance, nextTick, ref, watch, type Ref } from 'vue'
import { eventsApi } from '../../api/endpoints'
import { canModifyEvent, stageForEdit } from '../../events/event-edit'
import { centerScrollLeft } from '../../events/chip-scroll'
import { EVENT_TYPE_META } from '../../events/event-fields'
import { groupByDay } from '../../events/day-groups'
import { formatEventLine } from '../../events/format-event'
import { confirmDanger } from '../../utils/confirm'
import EmptyState from '../../components/EmptyState.vue'
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
const typeSheetOpen = ref(false)

/** 抽屉里要列全：横滑的 tabs 看不见不代表没有这一类。 */
const typeOptions = computed<{ value: EventType | ''; label: string }[]>(() => [
  { value: '', label: '全部' },
  ...EVENT_TYPES.map((t) => ({ value: t, label: `${EVENT_TYPE_META[t].icon} ${EVENT_TYPE_META[t].label}` })),
])

const familyId = computed(() => familyStore.currentFamilyId ?? '')
const children = computed(() => childStore.childrenByFamily[familyId.value] ?? [])
const childId = computed(() => childStore.currentChild(familyId.value)?.id ?? '')
const hasMore = computed(() => events.value.length < total.value)

/** 按天分组：家长回忆"那天下午"，不是"14:32 那条"。 */
const timezone = computed(() => authStore.user?.timezone ?? 'Asia/Shanghai')
const groups = computed(() => groupByDay(events.value, timezone.value))

async function run(reset: boolean): Promise<void> {
  if (!familyId.value) return
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
  }
}

/**
 * 刷新来源有四条（进入、回到本页、下拉、换家庭），并发时后一次必须真的跑，
 * 而不是被"正在加载"挡掉 —— 挡掉的结果就是列表停在旧家庭/旧页码上。
 * 所以排一条链，loading 只用来给 UI 和上拉加载判断"现在忙不忙"。
 */
let queue: Promise<void> = Promise.resolve()

function load(reset: boolean): Promise<void> {
  const next = queue.then(() => run(reset))
  queue = next.catch(() => undefined)
  return next
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

// 换家庭时孩子缓存属于上一个家庭：不重拉就把"有孩子的家庭"说成没有孩子，
// 而且 childId 为空时列表请求不带过滤条件，全家记录混在一起。
watch(familyId, async (next, prev) => {
  if (!next || next === prev || !ready) return
  await childStore.load(next)
  await load(true)
})

// 转圈由发起刷新的这一侧来停：run 里的提前 return（还没有家庭）不会走到 finally。
onPullDownRefresh(() => {
  void load(true).finally(() => uni.stopPullDownRefresh())
})
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

/**
 * 选中的芯片滚到容器中间：横滑条上"当前筛的是哪一类"不该藏在屏幕外，
 * 从右侧抽屉里选完尤其如此 —— 抽屉列的是全集，滑不到那一项。
 * 芯片的 scroll-view 不挂 scroll-with-animation：H5 带动画的 scroll-left 走
 * transform 覆盖层，一旦和真实 scrollLeft 对不上，后续值会被 uni 判为"无需动"而丢掉。
 */
const instance = getCurrentInstance()
const typeScrollLeft = ref(0)
const childScrollLeft = ref(0)
const typeIndex = computed(() => typeOptions.value.findIndex((o) => o.value === typeFilter.value))
const childIndex = computed(() => children.value.findIndex((c) => c.id === childId.value))

function centerChip(containerId: string, rowId: string, chipId: string, index: number, target: Ref<number>): void {
  if (!instance || index < 0) return
  const query = uni.createSelectorQuery().in(instance)
  query.select(`#${containerId}`).boundingClientRect()
  query.select(`#${rowId}`).boundingClientRect()
  query.select(`#${chipId}`).boundingClientRect()
  query.exec((res) => {
    const [box, row, chip] = (res ?? []) as Array<Record<string, number> | null>
    if (!box || !row || !chip) return
    applyScroll(target, centerScrollLeft({
      containerWidth: box.width ?? 0,
      rowLeft: row.left ?? 0,
      rowWidth: row.width ?? 0,
      chipLeft: chip.left ?? 0,
      chipWidth: chip.width ?? 0,
    }))
  })
}

/**
 * uni 的 scroll-left 是"变了才滚"，用户手动滑过之后光靠赋值滚不回来，
 * 所以同值时借 1px 走一圈：先顶出去，下一帧再落回真正想要的位置。
 */
function applyScroll(target: Ref<number>, value: number): void {
  if (target.value !== value) {
    target.value = value
    return
  }
  target.value = value + 1
  void nextTick(() => {
    target.value = value
  })
}

watch([typeIndex, childIndex], ([t, c]) => {
  centerChip('type-chips', 'type-chip-row', `chip-type-${t}`, t, typeScrollLeft)
  centerChip('child-chips', 'child-chip-row', `chip-child-${c}`, c, childScrollLeft)
}, { flush: 'post' })

/** 抽屉里点一次就完事：选完立刻收起，不然用户还得再点一次遮罩。 */
function chooseType(next: EventType | '') {
  typeSheetOpen.value = false
  pickType(next)
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
      <empty-state
        v-if="!familyId"
        icon="🏠"
        title="还没有家庭"
        hint="创建一个家庭，全家才能共用同一份记录。"
        action-label="去创建家庭"
        @action="goFamily"
      />

      <empty-state
        v-else-if="!childId"
        icon="👶"
        title="这个家庭还没有孩子"
        hint="记录要有归属的孩子才记得下。"
        action-label="添加孩子"
        @action="goChild"
      />

      <template v-else>
        <view class="timeline__filters">
          <view class="filter-bar">
            <scroll-view
              id="type-chips"
              scroll-x
              class="chips"
              :show-scrollbar="false"
              :scroll-left="typeScrollLeft"
            >
              <view id="type-chip-row" class="chip-row">
                <view
                  v-for="(opt, oi) in typeOptions"
                  :id="`chip-type-${oi}`"
                  :key="opt.value"
                  class="chip"
                  :class="{ 'chip--active': typeFilter === opt.value }"
                  @click="pickType(opt.value)"
                >
                  <text class="chip__label">{{ opt.label }}</text>
                </view>
              </view>
            </scroll-view>

            <!-- 横滑看不见的类型在这里全给出来，按钮本身不跟着滚。 -->
            <view class="expand" @click="typeSheetOpen = true">
              <text class="expand__glyph">☰</text>
            </view>
          </view>

          <scroll-view
            v-if="children.length > 1"
            id="child-chips"
            scroll-x
            class="chips"
            :show-scrollbar="false"
            :scroll-left="childScrollLeft"
          >
            <view id="child-chip-row" class="chip-row">
              <view
                v-for="(c, ci) in children"
                :id="`chip-child-${ci}`"
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

        <view v-if="groups.length" class="bottom-spacer" />

        <empty-state
          v-if="!loading && !groups.length && !error"
          icon="🌱"
          title="还没有记录"
          hint="点右下角 ＋，喂奶、换尿布、睡觉都能记一条。"
        />
        <text v-if="loading" class="timeline__loading">加载中…</text>
      </template>

      <view v-if="childId" class="fab" @click="goForm"><text class="fab__label">＋</text></view>

      <u-popup
        v-model="typeSheetOpen"
        mode="right"
        length="520rpx"
        :safe-area-inset-bottom="true"
        @close="typeSheetOpen = false"
      >
        <view class="sheet">
          <text class="sheet__title">按类型筛选</text>
          <view
            v-for="opt in typeOptions"
            :key="opt.value"
            class="sheet__item"
            :class="{ 'sheet__item--active': typeFilter === opt.value }"
            @click="chooseType(opt.value)"
          >
            <text class="sheet__item-label">{{ opt.label }}</text>
          </view>
        </view>
      </u-popup>
    </view>
  </theme-root>
</template>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  /* 可视区高度：状态栏/导航栏与 tabBar 各占掉的量由 uni-app 变量给出。 */
  min-height: calc(100vh - var(--window-top) - var(--window-bottom));
  padding: 24rpx 32rpx 40rpx;
  box-sizing: border-box;
}

/* 列表末尾留白：高度让最后一张卡片能滚到 FAB 之上。空状态不给这段，
   否则 min-height 会被内容顶开，"居中"就变成偏下。 */
.bottom-spacer {
  height: 140rpx;
}

.timeline__filters {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.filter-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
}

.chips {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
}

.chip-row {
  display: flex;
  flex-direction: row;
  gap: 12rpx;
  /* 让行自己的盒子等于芯片总宽：不撑开的话它只有容器宽，
     居中要用的"内容有多长"量不到，芯片全靠溢出显示。 */
  width: fit-content;
  min-width: 100%;
}

.chip {
  flex-shrink: 0;
  padding: 10rpx 22rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-surface-alt);
}

.chip--active {
  background-color: var(--mb-color-primary);
}

.chip__label {
  white-space: nowrap;
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
}

.chip--active .chip__label {
  color: var(--mb-color-on-primary);
}

.expand {
  flex-shrink: 0;
  width: 72rpx;
  height: 60rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999rpx;
  border: 1rpx solid var(--mb-color-border);
  background-color: var(--mb-color-surface);
}

.expand__glyph {
  font-size: 30rpx;
  line-height: 1;
  color: var(--mb-color-text-primary);
}

.sheet {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 60rpx 24rpx 40rpx;
}

.sheet__title {
  margin-bottom: 16rpx;
  font-size: 26rpx;
  color: var(--mb-color-text-secondary);
}

.sheet__item {
  padding: 22rpx 20rpx;
  border-radius: 16rpx;
}

.sheet__item--active {
  background-color: var(--mb-color-surface-alt);
}

.sheet__item-label {
  font-size: 28rpx;
  color: var(--mb-color-text-primary);
}

.sheet__item--active .sheet__item-label {
  color: var(--mb-color-primary);
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
