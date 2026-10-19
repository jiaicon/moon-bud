import { describe, expect, it, vi } from 'vitest'
import { confirmDanger } from '../confirm'

interface ModalOptions {
  title?: string
  content?: string
  confirmText?: string
  cancelText?: string
  success?: (res: { confirm: boolean }) => void
  fail?: () => void
}

const uniAny = globalThis as unknown as { uni: Record<string, unknown> }

function withModal(handler: (opts: ModalOptions) => void) {
  const original = uniAny.uni.showModal
  uniAny.uni.showModal = vi.fn((opts: ModalOptions) => handler(opts))
  return {
    restore: () => {
      uniAny.uni.showModal = original
    },
  }
}

describe('危险操作确认', () => {
  it('用户点取消就不执行，并且真的弹了带后果说明的框', async () => {
    let seen: ModalOptions = {}
    const { restore } = withModal((opts) => {
      seen = opts
      opts.success?.({ confirm: false })
    })
    await expect(
      confirmDanger({ title: '归档这个家庭？', content: '归档后你和家人都无法再打开它。' }),
    ).resolves.toBe(false)
    restore()
    expect(seen.content).toContain('无法再打开')
  })

  it('点确认才执行', async () => {
    const { restore } = withModal((opts) => opts.success?.({ confirm: true }))
    await expect(confirmDanger({ title: '移除这个孩子？', content: '历史记录会一起看不到。' })).resolves.toBe(
      true,
    )
    restore()
  })

  it('确认按钮默认文案是"确认"，可覆盖成具体动作', async () => {
    let seen: ModalOptions = {}
    const { restore } = withModal((opts) => {
      seen = opts
      opts.success?.({ confirm: false })
    })
    await confirmDanger({ title: 't', content: 'c' })
    await confirmDanger({ title: 't', content: 'c', confirmText: '归档' })
    restore()
    expect(seen.confirmText).toBe('归档')
  })

  it('平台没有 showModal 时返回 false（宁可不做，也不静默执行）', async () => {
    const original = uniAny.uni.showModal
    uniAny.uni.showModal = undefined
    await expect(confirmDanger({ title: 't', content: 'c' })).resolves.toBe(false)
    uniAny.uni.showModal = original
  })
})
