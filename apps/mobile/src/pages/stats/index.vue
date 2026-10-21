<script setup lang="ts">
import type { EventDto } from '@moonbud/shared'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { blockGuestDeepLink } from '../../guest/deep-link'
import { computed, ref } from 'vue'
import { eventsApi } from '../../api/endpoints'
import { buildEventQuery, rangeBounds, type EventListFilters, type EventRange } from '../../events/list-filters'
import { CARE_METRICS, careSeries, careValue, maxCareValue, readAtLabel, uniqueById, type CareMetric } from '../../stats/daily'
import { GROWTH_FIELDS, growthSeries, valueExtent, type GrowthField } from '../../stats/growth'
import { applyPendingUpdates, filterRows, pendingCreateRows, pendingDeletedIds } from '../../sync/pending-view'
import EmptyState from '../../components/EmptyState.vue'
import ThemeRoot from '../../components/ThemeRoot.vue'
import { useAuthStore } from '../../stores/auth'
import { useChildStore } from '../../stores/child'
import { useFamilyStore } from '../../stores/family'
import { useOutboxStore } from '../../stores/outbox'

const authStore = useAuthStore()
const familyStore = useFamilyStore()
const childStore = useChildStore()
const outboxStore = useOutboxStore()

const events = ref<EventDto[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
/** 最近一次成功读到数据的时刻（epoch ms）。失败时界面靠它说清"这些数是几点读到的"。 */
const loadedAt = ref<number | null>(null)
/** 眼前这份数据是为哪个孩子取的：中途切了孩子，标题和待同步行都得跟着数据走，不跟指针。 */
const loadedChildId = ref('')

const familyId = computed(() => familyStore.currentFamilyId ?? '')
const children = computed(() => childStore.childrenByFamily[familyId.value] ?? [])
const childId = computed(() => childStore.currentChild(familyId.value)?.id ?? '')
const childrenLoaded = computed(() => familyId.value in childStore.childrenByFamily)
const childrenLoadFailed = computed(
  () => !childrenLoaded.value && !childStore.loading && childStore.error !== null,
)
const timezone = computed(() => authStore.user?.timezone ?? 'Asia/Shanghai')

// 每日柱状只看窗口；生长曲线看这个孩子的全部测量（家长按月称重，窗口一窄就剩一两点）。
const windowDays = ref<7 | 30>(7)
const metric = ref<CareMetric>('feeding')
const growthField = ref<GrowthField>('weightKg')

const metricDef = computed(() => CARE_METRICS.find((m) => m.key === metric.value) ?? CARE_METRICS[0])
const growthDef = computed(() => GROWTH_FIELDS.find((f) => f.key === growthField.value) ?? GROWTH_FIELDS[0])

// 一个孩子的全部记录要翻好几页，这一趟能跑好几秒；期间家长完全可能又点了别的孩子。
let loadSeq = 0

/** 窗口档位与记录页"近 7 天/近 30 天"是同一件事，共用 rangeBounds 才算得出同一段日子。 */
const RANGE_BY_WINDOW: Record<7 | 30, EventRange> = { 7: '7d', 30: '30d' }

/** 按页取到底：服务端是 skip/take，同一趟里有人记了一条就会行号位移，收尾按 id 去重。 */
async function fetchPages(scopeFamilyId: string, filters: EventListFilters): Promise<EventDto[]> {
  const collected: EventDto[] = []
  let page = 1
  let total = Infinity
  while (collected.length < total) {
    const res = await eventsApi.list(scopeFamilyId, buildEventQuery(filters, page, 100))
    collected.push(...res.items)
    total = res.total
    if (res.items.length === 0) break
    page += 1
  }
  return collected
}

async function runLoad(): Promise<void> {
  const seq = ++loadSeq
  // 作用域在开头定死：中途换了孩子，后几页查的就是新孩子，两半拼起来谁都不像。
  const scopeFamilyId = familyId.value
  const scopeChildId = childId.value
  const scopeWindow = windowDays.value
  const scopeTimezone = timezone.value
  if (!scopeFamilyId || !scopeChildId) {
    events.value = []
    loadedChildId.value = ''
    return
  }
  loading.value = true
  error.value = null
  try {
    // 两段取数：柱子只看窗口，多拉的历史一根都用不上；称重一月一次，
    // 窗口里常剩一两个点，所以生长单独取全量（type=growth 记录本来就少）。
    const [daily, growth] = await Promise.all([
      fetchPages(scopeFamilyId, {
        childId: scopeChildId,
        ...rangeBounds(RANGE_BY_WINDOW[scopeWindow], scopeTimezone),
      }),
      fetchPages(scopeFamilyId, { childId: scopeChildId, type: 'growth' }),
    ])
    // 迟到一步的旧趟（上一个孩子）不能把当前孩子的图盖掉。
    if (seq !== loadSeq) return
    // 翻页期间别人也可能在记：按 id 去重，免得同一条在两页里各出现一次被数两遍。
    events.value = uniqueById([...daily, ...growth])
    // 标题与待同步行跟着这份数据走：中途切了孩子的话，此刻图上还是上一个的。
    loadedChildId.value = scopeChildId
    loadedAt.value = Date.now()
  } catch (err) {
    if (seq !== loadSeq) return
    error.value = err instanceof Error ? err.message : '统计加载失败'
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

let ready = false
onLoad(async () => {
  if (await blockGuestDeepLink()) return
  // 出箱那份是本地存储，不先读回来这里永远看不到"待同步"，图就少算几条。
  outboxStore.load()
  await familyStore.load()
  if (familyId.value) await childStore.load(familyId.value)
  await runLoad()
  ready = true
})
onShow(() => {
  if (ready) void runLoad()
})

/**
 * 图说的是谁：优先说"这份数据是为谁取的"。
 * 一次都没成功读到过时（例如全程离线首启）盘上没有旧数据可混，才退回当前选中——
 * 那时那条待同步的记录正是这个孩子刚记下的，不显示它就等于把它藏了。
 */
const displayChildId = computed(() => loadedChildId.value || childId.value)
const childName = computed(() => children.value.find((c) => c.id === displayChildId.value)?.name ?? '这个孩子')
const readAt = computed(() => readAtLabel(timezone.value, loadedAt.value))

const sessionMeta = computed(() => ({
  userId: authStore.user?.id ?? '',
  nickname: authStore.user?.nickname ?? '',
}))

// 本机压着没传上去的那几条（只算当前家庭，别的家庭的待同步跟这张图无关）。
const pendingHere = computed(() => outboxStore.items.filter((i) => i.familyId === familyId.value))

/**
 * 聚合读的是"眼前那份数据"，不是"上一次从服务器读到的那份"：
 * 记录页明明画着这条还标了"待同步"，统计却不认它——同一屏两个答案，
 * 家长只会以为图坏了或者记录丢了。所以先把删除藏掉、编辑盖上、创建并进，再交给纯函数。
 */
const statsEvents = computed(() => {
  const items = pendingHere.value
  const hidden = pendingDeletedIds(items, familyId.value)
  const server = applyPendingUpdates(
    events.value.filter((e) => !hidden.has(e.id)),
    items,
    familyId.value,
  )
  // 待同步行只按孩子筛：窗口与生长两套口径在同一份 events 上各算各的，
  // 这里再套时间窗就会把"全量生长"那条漏掉。
  const local = filterRows(pendingCreateRows(items, familyId.value, sessionMeta.value), {
    childId: displayChildId.value,
  })
  return uniqueById([...server, ...local])
})

// —— 每日柱状 ——
const buckets = computed(() => careSeries(statsEvents.value, timezone.value, windowDays.value))
const dailyMax = computed(() => maxCareValue(buckets.value, metric.value))
const hasDaily = computed(() => dailyMax.value > 0)
function barHeight(b: (typeof buckets.value)[number]): number {
  if (!dailyMax.value) return 0
  const v = careValue(b, metric.value)
  // 有值就至少给 6% 的高度，不然 1/300 这种柱子在屏上是 0，看着像没记。
  const pct = Math.round((v / dailyMax.value) * 100)
  return v > 0 ? Math.max(6, pct) : 0
}
function dayTick(b: (typeof buckets.value)[number]): string {
  return b.label === '今天' || b.label === '昨天' ? b.label : b.dayKey.slice(8)
}

// —— 生长折线 ——
const growthPoints = computed(() => growthSeries(statsEvents.value, timezone.value, growthField.value))
const growthExtent = computed(() => valueExtent(growthPoints.value))

const CHART_W = 300
const CHART_H = 120
const PAD = 12

/** 把生长点映射到 svg 坐标；点数 <2 时为空（模板用单点/文字表达"点太少"）。 */
const growthCoords = computed(() => {
  const pts = growthPoints.value
  if (pts.length < 2) return []
  const { min, max } = growthExtent.value
  const t0 = pts[0].t
  const spanT = pts[pts.length - 1].t - t0 || 1
  const spanV = max - min || 1
  return pts.map((p) => ({
    x: PAD + ((p.t - t0) / spanT) * (CHART_W - 2 * PAD),
    y: CHART_H - PAD - ((p.v - min) / spanV) * (CHART_H - 2 * PAD),
  }))
})
const polyline = computed(() => growthCoords.value.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' '))
/** 单点也画个圆点，否则"只量过一次"看起来像图坏了。 */
const singleDot = computed(() => {
  const pts = growthPoints.value
  if (pts.length !== 1) return null
  return { x: CHART_W / 2, y: CHART_H / 2, v: pts[0].v, label: pts[0].label }
})
const latestGrowth = computed(() => {
  const pts = growthPoints.value
  return pts.length ? pts[pts.length - 1] : null
})

function pickWindow(days: 7 | 30): void {
  // 窗口变了就是另一段日子：柱子那段是照着窗口取的，得重走一趟。
  if (windowDays.value === days) return
  windowDays.value = days
  void runLoad()
}
function pickMetric(next: CareMetric): void {
  metric.value = next
}
function pickGrowthField(next: GrowthField): void {
  growthField.value = next
}
function pickChild(next: string): void {
  if (!familyId.value) return
  childStore.select(familyId.value, next)
  void runLoad()
}
async function retry(): Promise<void> {
  if (familyId.value) await childStore.load(familyId.value)
  await runLoad()
}
</script>

<template>
  <theme-root>
    <view class="stats">
      <empty-state
        v-if="!familyId"
        icon="🏠"
        title="还没有家庭"
        hint="创建一个家庭，全家才能共用同一份记录。"
      />

      <empty-state
        v-else-if="!childrenLoaded"
        icon="👶"
        :title="childrenLoadFailed ? '孩子名单没加载出来' : '正在读取孩子名单'"
        :hint="childrenLoadFailed ? (childStore.error ?? '网络或后端暂时不可用，重试一下即可。') : '统计要按孩子来看，稍一下下。'"
        :action-label="childrenLoadFailed ? '重试' : undefined"
        @action="retry"
      />

      <empty-state
        v-else-if="!childId"
        icon="👶"
        title="这个家庭还没有孩子"
        hint="先添加孩子，记录才有归属。"
      />

      <template v-else>
        <text v-if="error" class="stats__error">{{ error }}</text>
        <!-- 失败时留着的是上一次读到的数字。只说"失败了"仍可能被读成"这是现在的样子"，
             所以把读到它的时刻一并念出来。 -->
        <text v-if="error && events.length && readAt" class="stats__stale">
          下面这些是 {{ readAt }} 读到的，之后没能再刷新成现在的。
        </text>
        <text v-else-if="loading" class="stats__loading">加载中…</text>

        <scroll-view
          v-if="children.length > 1"
          scroll-x
          class="chips"
          :show-scrollbar="false"
        >
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

        <!-- 每日照护 -->
        <view class="section">
          <view class="section__head">
            <text class="section__title">每日{{ metricDef.label }}</text>
            <view class="win">
              <text
                class="win__opt"
                :class="{ 'win__opt--on': windowDays === 7 }"
                @click="pickWindow(7)"
              >近 7 天</text>
              <text
                class="win__opt"
                :class="{ 'win__opt--on': windowDays === 30 }"
                @click="pickWindow(30)"
              >近 30 天</text>
            </view>
          </view>

          <scroll-view scroll-x class="chips" :show-scrollbar="false">
            <view class="chip-row">
              <view
                v-for="m in CARE_METRICS"
                :key="m.key"
                class="chip"
                :class="{ 'chip--active': m.key === metric }"
                @click="pickMetric(m.key)"
              >
                <text class="chip__label">{{ m.label }}</text>
              </view>
            </view>
          </scroll-view>

          <!-- 图只在该有数的时候画：首屏就失败时数据是空的，画一排 0 高的柱子是在说
               "这七天什么都没记"，而真相是"我没读到"（顶部那行 error 才是实话）。 -->
          <scroll-view v-if="hasDaily" scroll-x class="chart-scroll" :show-scrollbar="false">
            <view class="bars" :style="{ width: (buckets.length * 72) + 'rpx' }">
              <view v-for="b in buckets" :key="b.dayKey" class="bar-col">
                <text class="bar-col__val">{{ careValue(b, metric) || '' }}</text>
                <view class="bar-track">
                  <view class="bar-fill" :style="{ height: barHeight(b) + '%' }" />
                </view>
                <text class="bar-col__tick">{{ dayTick(b) }}</text>
              </view>
            </view>
          </scroll-view>

          <view v-else-if="!error && !loading" class="metric-empty">
            <text class="metric-empty__text">近 {{ windowDays }} 天没有{{ metricDef.label }}记录</text>
          </view>
        </view>

        <!-- 生长曲线 -->
        <view class="section">
          <text class="section__title">生长曲线 · {{ childName }}</text>
          <view class="chip-row chip-row--plain">
            <view
              v-for="f in GROWTH_FIELDS"
              :key="f.key"
              class="chip"
              :class="{ 'chip--active': f.key === growthField }"
              @click="pickGrowthField(f.key)"
            >
              <text class="chip__label">{{ f.label }}</text>
            </view>
          </view>

          <view v-if="growthPoints.length" class="growth">
            <text v-if="latestGrowth" class="growth__now">
              最近 {{ growthDef.label }} {{ latestGrowth.v }}{{ growthDef.unit }} · {{ latestGrowth.label }}
            </text>
            <svg class="growth__svg" :viewBox="`0 0 ${CHART_W} ${CHART_H}`" preserveAspectRatio="none">
              <polyline
                v-if="polyline"
                :points="polyline"
                fill="none"
                stroke="var(--mb-color-primary)"
                stroke-width="2"
              />
              <circle
                v-if="singleDot"
                :cx="singleDot.x"
                :cy="singleDot.y"
                r="3"
                fill="var(--mb-color-primary)"
              />
              <circle
                v-for="(c, i) in growthCoords"
                :key="i"
                :cx="c.x"
                :cy="c.y"
                r="2.5"
                fill="var(--mb-color-primary)"
              />
            </svg>
            <text v-if="growthPoints.length === 1" class="growth__note">只量过一次，暂无趋势</text>
          </view>

          <!-- 同上：空框要留给"确实没量过"，失败时不画框也不念"还没有…记录"。 -->
          <view v-else-if="!error && !loading" class="metric-empty">
            <text class="metric-empty__text">还没有{{ growthDef.label }}记录，去记录页加一条生长发育</text>
          </view>
        </view>

        <text v-if="pendingHere.length" class="stats__caveat">
          本机上还有 {{ pendingHere.length }} 条没传上去的记录，已经一并算进上面的图里；传成功后数字不会变。
        </text>
        <text v-else class="stats__caveat">这些数字来自服务器上已保存的记录，只统计{{ childName }}一个人。</text>
      </template>
    </view>
  </theme-root>
</template>

<style scoped>
.stats {
  display: flex;
  flex-direction: column;
  gap: 28rpx;
  min-height: calc(100vh - var(--window-top) - var(--window-bottom));
  padding: 24rpx 32rpx 40rpx;
  box-sizing: border-box;
}

.stats__error {
  display: block;
  font-size: 26rpx;
  color: var(--mb-color-error);
}

.stats__stale {
  display: block;
  font-size: 22rpx;
  color: var(--mb-color-text-disabled);
}

.stats__loading {
  display: block;
  font-size: 24rpx;
  color: var(--mb-color-text-disabled);
}

.chips {
  white-space: nowrap;
}

.chip-row {
  display: flex;
  flex-direction: row;
  gap: 12rpx;
  width: fit-content;
}

.chip-row--plain {
  width: auto;
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

.section {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  background-color: var(--mb-color-surface);
}

.section__head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.section__title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--mb-color-text-primary);
}

.win {
  display: flex;
  flex-direction: row;
  gap: 16rpx;
}

.win__opt {
  font-size: 24rpx;
  color: var(--mb-color-text-disabled);
}

.win__opt--on {
  color: var(--mb-color-primary);
  font-weight: 600;
}

.chart-scroll {
  width: 100%;
}

.bars {
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  gap: 8rpx;
  height: 240rpx;
}

.bar-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
  width: 64rpx;
}

.bar-col__val {
  font-size: 18rpx;
  color: var(--mb-color-text-disabled);
  height: 24rpx;
}

.bar-track {
  flex: 1;
  width: 40rpx;
  display: flex;
  align-items: flex-end;
  background-color: var(--mb-color-surface-alt);
  border-radius: 8rpx;
}

.bar-fill {
  width: 100%;
  background-color: var(--mb-color-primary);
  border-radius: 8rpx;
}

.bar-col__tick {
  font-size: 18rpx;
  color: var(--mb-color-text-disabled);
}

.metric-empty {
  padding: 40rpx 0;
  text-align: center;
}

.metric-empty__text {
  font-size: 24rpx;
  color: var(--mb-color-text-disabled);
}

.growth {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.growth__now {
  font-size: 24rpx;
  color: var(--mb-color-text-secondary);
}

.growth__svg {
  width: 100%;
  height: 240rpx;
}

.growth__note {
  font-size: 22rpx;
  color: var(--mb-color-text-disabled);
}

.stats__caveat {
  font-size: 22rpx;
  color: var(--mb-color-text-disabled);
  text-align: center;
}
</style>
