import { defineStore } from 'pinia'
import type { ChildDto } from '@moonbud/shared'
import { childrenApi } from '../api/endpoints'

const CURRENT_CHILD_KEYS = 'currentChildIdByFamily'

function readPersisted(): Record<string, string> {
  const value = uni.getStorageSync(CURRENT_CHILD_KEYS)
  return value && typeof value === 'object' ? (value as Record<string, string>) : {}
}

export const useChildStore = defineStore('child', {
  state: () => ({
    // 两个映射都必须按 familyId 分键 —— 这是"换家庭不串台"的唯一保证。
    childrenByFamily: {} as Record<string, ChildDto[]>,
    currentChildIdByFamily: readPersisted() as Record<string, string | null>,
    loading: false,
    error: null as string | null,
  }),

  actions: {
    async load(familyId: string): Promise<boolean> {
      this.loading = true
      this.error = null
      try {
        this.childrenByFamily = { ...this.childrenByFamily, [familyId]: await childrenApi.list(familyId) }
        return true
      } catch (err) {
        this.error = err instanceof Error ? err.message : '孩子列表加载失败'
        return false
      } finally {
        this.loading = false
      }
    },

    select(familyId: string, childId: string): void {
      const children = this.childrenByFamily[familyId] ?? []
      if (!children.some((c) => c.id === childId)) return
      this.currentChildIdByFamily = { ...this.currentChildIdByFamily, [familyId]: childId }
      uni.setStorageSync(CURRENT_CHILD_KEYS, this.currentChildIdByFamily)
    },

    async create(familyId: string, input: { name: string; gender: ChildDto['gender']; birthday: string }): Promise<ChildDto | null> {
      try {
        const child = await childrenApi.create(familyId, input)
        this.childrenByFamily = { ...this.childrenByFamily, [familyId]: [...(this.childrenByFamily[familyId] ?? []), child] }
        this.select(familyId, child.id)
        return child
      } catch (err) {
        this.error = err instanceof Error ? err.message : '添加孩子失败'
        return null
      }
    },

    async remove(familyId: string, childId: string): Promise<boolean> {
      try {
        await childrenApi.remove(familyId, childId)
        this.childrenByFamily = {
          ...this.childrenByFamily,
          [familyId]: (this.childrenByFamily[familyId] ?? []).filter((c) => c.id !== childId),
        }
        if (this.currentChildIdByFamily[familyId] === childId) this.select(familyId, '')
        return true
      } catch (err) {
        this.error = err instanceof Error ? err.message : '移除孩子失败'
        return false
      }
    },

    /** 优先级：记住的孩子（仍在列表里才算）→ 第一个 → null。 */
    currentChild(familyId: string): ChildDto | null {
      const children = this.childrenByFamily[familyId] ?? []
      const remembered = this.currentChildIdByFamily[familyId]
      return children.find((c) => c.id === remembered) ?? children[0] ?? null
    },
  },
})
