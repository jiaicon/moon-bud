<script setup lang="ts">
import { computed } from 'vue'
import PreviewFrame from '../../components/PreviewFrame.vue'
import ThemeRoot from '../../components/ThemeRoot.vue'
import ThemeSwitcher from '../../components/ThemeSwitcher.vue'
import { LOGIN_ENTRY_URL } from '../../guest/gate'
import { EVENT_TYPE_META } from '../../events/event-fields'
import { formatEventLine } from '../../events/format-event'
import { PREVIEW_SCREENS, MOCK_CHILD, MOCK_EVENTS, MOCK_FAMILY, MOCK_REMINDERS } from '../../preview/mock-data'
import { useAuthStore } from '../../stores/auth'
import { wallStamp } from '../../utils/wall-time'

const authStore = useAuthStore()

/**
 * 这一页现在也服务已经登录的人（"我的"里的功能教学）。顶上那格"注册 / 登录"
 * 对他说的是"你还没有账号"，所以只给还没账号的人画。会话还没问出来的那一瞬
 * 先按"没登录"画——它比"登录后消失"更像一个不撒谎的起点。
 */
const loggedIn = computed(() => authStore.session === 'member')

// 游客预览用的是 mock 家庭，它没有账号时区可查，就按样例数据写死的那一个念。
const PREVIEW_TIMEZONE = 'Asia/Shanghai'

// 念法必须走账号时区那套换算：直接读设备本地的钟点，手机不在东八区的游客
// 会看到"上次喂奶 00:30"，以为演示坏了。
const clock = (iso: string): string => wallStamp(PREVIEW_TIMEZONE, new Date(iso)).clock

const latest = (type: string) =>
  MOCK_EVENTS.filter((e) => e.type === type).sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  )[0] ?? null

const lastFeeding = latest('feeding')
const lastSleep = latest('sleep')
const diaperToday = computed(() => MOCK_EVENTS.filter((e) => e.type === 'diaper').length)

const overdue = MOCK_REMINDERS.filter((r) => r.dueAt && new Date(r.dueAt).getTime() < Date.now())
const upcoming = MOCK_REMINDERS.filter((r) => r.dueAt && new Date(r.dueAt).getTime() >= Date.now())

const screen = (key: string) => PREVIEW_SCREENS.find((s) => s.key === key)!

const go = (url: string) => uni.navigateTo({ url })

/** 底部那颗"开始使用"：没账号的人送去注册，已经登录的人送回首页——首页是 Tab 页，navigateTo 进不去。 */
function start(): void {
  if (loggedIn.value) {
    uni.switchTab({ url: '/pages/home/index' })
    return
  }
  uni.navigateTo({ url: LOGIN_ENTRY_URL })
}
</script>

<template>
  <theme-root>
    <view class="preview">
      <view class="preview__top">
        <view class="preview__heading">
          <text class="preview__title">它能做什么</text>
          <text class="preview__hint">下面是真实界面，数据是示例。想试配色可以直接换。</text>
        </view>
        <view v-if="!loggedIn" class="preview__login" @click="go('/pages/login/index?mode=login')">
          <text class="preview__login-label">注册 / 登录</text>
        </view>
      </view>

      <view class="preview__theme">
        <theme-switcher />
      </view>

      <preview-frame :title="screen('home').title" :caption="screen('home').caption">
        <view class="card card--stat">
          <text class="card__label">上次喂奶</text>
          <text class="card__value">{{ lastFeeding ? clock(lastFeeding.occurredAt) : '—' }}</text>
          <text class="card__meta">{{ lastFeeding ? `${lastFeeding.createdByNickname} · 奶瓶 120ml` : '' }}</text>
        </view>
        <view class="card card--stat">
          <text class="card__label">上次睡眠</text>
          <text class="card__value">{{ lastSleep ? clock(lastSleep.occurredAt) : '—' }}</text>
          <text class="card__meta">{{ lastSleep ? `${lastSleep.createdByNickname} · 睡得不错` : '' }}</text>
        </view>
        <view class="card card--stat">
          <text class="card__label">今天换尿布</text>
          <text class="card__value">{{ diaperToday }} 次</text>
        </view>
        <view class="chips">
          <view v-for="(meta, type) in EVENT_TYPE_META" :key="type" class="chip">
            <text class="chip__label">{{ meta.icon }} {{ meta.label }}</text>
          </view>
        </view>
      </preview-frame>

      <preview-frame :title="screen('timeline').title" :caption="screen('timeline').caption">
        <view v-for="event in MOCK_EVENTS.slice(0, 4)" :key="event.id" class="card card--row">
          <view class="card__dot" :style="{ backgroundColor: event.type === 'feeding' ? 'var(--mb-color-primary)' : 'var(--mb-color-surface-alt)' }" />
          <view class="card__main">
            <text class="card__title">{{ formatEventLine(event, PREVIEW_TIMEZONE) }}</text>
            <text class="card__meta">{{ event.createdByNickname }}{{ event.note ? ` · ${event.note}` : '' }}</text>
          </view>
        </view>
      </preview-frame>

      <preview-frame :title="screen('reminders').title" :caption="screen('reminders').caption">
        <view v-for="reminder in overdue" :key="reminder.id" class="card card--overdue">
          <text class="card__title">{{ reminder.title }}</text>
          <text class="card__meta">已过点 {{ clock(reminder.dueAt!) }} · 指派给{{ reminder.assigneeId ? '爸爸' : '全家' }}</text>
        </view>
        <view v-for="reminder in upcoming" :key="reminder.id" class="card">
          <text class="card__title">{{ reminder.title }}</text>
          <text class="card__meta">今天 {{ clock(reminder.dueAt!) }}{{ reminder.note ? ` · ${reminder.note}` : '' }}</text>
        </view>
      </preview-frame>

      <preview-frame :title="screen('family').title" :caption="screen('family').caption">
        <view class="card">
          <text class="card__title">{{ MOCK_FAMILY.name }}</text>
          <text class="card__meta">你是创建者，可以邀请成员并分配角色</text>
        </view>
        <view class="card">
          <text class="card__title">{{ MOCK_CHILD.name }}</text>
          <text class="card__meta">{{ MOCK_CHILD.birthday }} 出生 · 这个孩子的记录全家共享</text>
        </view>
        <view class="card">
          <text class="card__title">邀请码</text>
          <text class="card__meta">家人输入这串码即可加入，无需注册链接</text>
        </view>
      </preview-frame>

      <view class="preview__footer">
        <view class="btn btn--primary" @click="start">
          <text class="btn__label">开始使用</text>
        </view>
      </view>
    </view>
  </theme-root>
</template>

<style scoped>
.preview {
  display: flex;
  flex-direction: column;
  gap: 28rpx;
  padding: 40rpx 32rpx 160rpx;
}

.preview__top {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
}

.preview__heading {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  min-width: 0;
}

.preview__title {
  font-size: 40rpx;
  font-weight: 700;
  color: var(--mb-color-text-primary);
}

.preview__hint {
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--mb-color-text-secondary);
}

.preview__login {
  flex-shrink: 0;
  padding: 10rpx 24rpx;
  border-radius: 999rpx;
  border: 2rpx solid var(--mb-color-border);
}

.preview__login-label {
  font-size: 24rpx;
  white-space: nowrap;
  color: var(--mb-color-primary);
}

.chips {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12rpx;
}

.chip {
  padding: 10rpx 20rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-surface-alt);
}

.chip__label {
  font-size: 22rpx;
  color: var(--mb-color-text-secondary);
}

.card {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  padding: 20rpx 24rpx;
  border-radius: 18rpx;
  background-color: var(--mb-color-surface-alt);
}

.card--row {
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
}

.card__dot {
  width: 20rpx;
  height: 20rpx;
  border-radius: 50%;
}

.card__main {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.card--overdue {
  border: 2rpx solid var(--mb-color-error);
}

.card__label {
  font-size: 22rpx;
  color: var(--mb-color-text-secondary);
}

.card__value {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--mb-color-text-primary);
}

.card__title {
  font-size: 26rpx;
  color: var(--mb-color-text-primary);
}

.card__meta {
  font-size: 22rpx;
  line-height: 1.5;
  color: var(--mb-color-text-secondary);
}

.preview__footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 20rpx 32rpx 32rpx;
  background-color: var(--mb-color-surface);
  border-top: 2rpx solid var(--mb-color-divider);
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 92rpx;
  border-radius: 999rpx;
}

.btn--primary {
  background-color: var(--mb-color-primary);
}

.btn__label {
  font-size: 28rpx;
  color: var(--mb-color-on-primary);
}
</style>
