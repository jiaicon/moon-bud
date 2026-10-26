<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AssistantIntentHint } from '@moonbud/shared'
import { ApiRequestError } from '../api/errors'
import { assistantApi } from '../api/endpoints'
import { ASK_EXAMPLES } from '../assistant/ask-flow'
import { stageDraft } from '../assistant/draft-handoff'
import { assistantTarget } from '../assistant/draft-target'

const props = defineProps<{ open: boolean; childId: string | null }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const text = ref('')
const asking = ref(false)
/**
 * 听不懂时那一句「是要记一笔，还是设提醒？」只在面板里发生：换页把人带去一张空表单，
 * 比留在原地更坏——人已经说了话，界面却一个字都没接住。
 */
const clarify = ref(false)

// u-popup 认 v-model，而 v-model 不能直接绑在 prop 上：这一层换掉开合的归属，
// 页面只管"要不要开"，面板自己管"要不要关"。
const shown = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
})

function close(): void {
  emit('update:open', false)
}

/** 例句点一下就替人说完整句：例句存在的意义是"不用想词"，所以它直接发送。 */
function askWith(example: string): void {
  text.value = example
  void send()
}

async function send(hint?: AssistantIntentHint): Promise<void> {
  const said = text.value.trim()
  if (!said || asking.value) return
  asking.value = true
  try {
    const result = await assistantApi.parse(said, hint)
    const target = assistantTarget(result, hint)
    if (target.kind === 'unknown') {
      // 不换页、不清空：话留着，人只要点一下那两种意图之一，同一句话再说一次。
      clarify.value = true
      return
    }
    // 草稿走本地一次性交接，url 上只有页名（原因见 assistant/draft-handoff.ts）。
    // 空手去那张表单时什么都不交接——不然表单顶部会念一句"助手按你说的话填好了"。
    if (target.draft) stageDraft({ draft: target.draft, childId: props.childId })
    uni.navigateTo({ url: target.url })
    text.value = ''
    clarify.value = false
    close()
  } catch (err) {
    // 429、超时、没配密钥：服务端已经写好了一句话，念它。原话一个字都不清——
    // "助手暂时用不了"之后让人把那句话重打一遍，是把故障转嫁给人。
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
  <u-popup v-model="shown" mode="bottom" border-radius="24" :safe-area-inset-bottom="true" @close="close">
    <view class="ask">
      <view class="ask__head">
        <text class="ask__title">说一句话</text>
        <text class="ask__close" @click="close">关闭</text>
      </view>

      <input
        v-model="text"
        class="ask__input"
        maxlength="200"
        placeholder="如：刚刚瓶喂 120 毫升"
        confirm-type="done"
        :adjust-position="true"
        @confirm="send()"
      />

      <view class="ask__rows">
        <text class="ask__rows-label">不知道怎么说？点一句：</text>
        <view class="ask__chips">
          <view v-for="example in ASK_EXAMPLES" :key="example" class="chip" @click="askWith(example)">
            <text class="chip__label">{{ example }}</text>
          </view>
        </view>
      </view>

      <view v-if="clarify" class="ask__clarify">
        <text class="ask__clarify-text">这句我没能判断，您想让我做哪一件？</text>
        <view class="ask__chips">
          <view class="chip chip--go" @click="send('event')"><text class="chip__label">记一笔</text></view>
          <view class="chip chip--go" @click="send('reminder')"><text class="chip__label">设提醒</text></view>
        </view>
      </view>

      <view class="ask__go" :class="{ 'ask__go--busy': asking }" @click="send()">
        <text class="ask__go-label">{{ asking ? '在看…' : '记下' }}</text>
      </view>
    </view>
  </u-popup>
</template>

<style scoped>
.ask {
  padding: 32rpx 40rpx 40rpx;
  background-color: var(--mb-color-surface);
}

.ask__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ask__title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--mb-color-text-primary);
}

.ask__close {
  font-size: 26rpx;
  color: var(--mb-color-text-disabled);
}

.ask__input {
  margin-top: 24rpx;
  /* 宿主不自带高度就会被 uni-app 定成 1.4em，inner 压成 1px：字打进去看不见（见 input-surface 门禁）。 */
  height: 88rpx;
  box-sizing: border-box;
  padding: 0 24rpx;
  border-radius: 16rpx;
  background-color: var(--mb-color-surface-alt);
  font-size: 30rpx;
  color: var(--mb-color-text-primary);
}

.ask__rows {
  margin-top: 24rpx;
}

.ask__rows-label {
  font-size: 24rpx;
  color: var(--mb-color-text-disabled);
}

.ask__chips {
  display: flex;
  flex-wrap: wrap;
  margin-top: 12rpx;
}

.chip {
  margin: 0 16rpx 16rpx 0;
  padding: 12rpx 20rpx;
  border-radius: 999rpx;
  border: 2rpx solid var(--mb-color-border);
}

.chip--go {
  border-color: var(--mb-color-primary);
  background-color: var(--mb-color-primary);
}

.chip__label {
  font-size: 26rpx;
  color: var(--mb-color-text-primary);
}

.chip--go .chip__label {
  color: var(--mb-color-on-primary);
}

.ask__clarify {
  margin-top: 8rpx;
}

.ask__clarify-text {
  font-size: 26rpx;
  color: var(--mb-color-text-primary);
}

.ask__go {
  margin-top: 24rpx;
  height: 88rpx;
  border-radius: 999rpx;
  background-color: var(--mb-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ask__go--busy {
  opacity: 0.6;
}

.ask__go-label {
  font-size: 30rpx;
  color: var(--mb-color-on-primary);
}
</style>
