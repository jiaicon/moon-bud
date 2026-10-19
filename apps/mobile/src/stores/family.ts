import { defineStore } from 'pinia'
import type { FamilyDto } from '@moonbud/shared'
import { familiesApi } from '../api/endpoints'

const CURRENT_FAMILY_KEY = 'currentFamilyId'

function readCurrentFamilyId(): string | null {
  const value = uni.getStorageSync(CURRENT_FAMILY_KEY)
  return typeof value === 'string' && value.length > 0 ? value : null
}

export const useFamilyStore = defineStore('family', {
  state: () => ({
    families: [] as FamilyDto[],
    currentFamilyId: readCurrentFamilyId(),
    loading: false,
    error: null as string | null,
  }),

  getters: {
    currentFamily: (s) => s.families.find((f) => f.id === s.currentFamilyId) ?? null,
    hasFamily: (s) => s.families.length > 0,
  },

  actions: {
    async load(): Promise<boolean> {
      this.loading = true
      this.error = null
      try {
        this.families = await familiesApi.list()
        // 首次进入或原选中家庭已归档/已退出时，落到第一个可用家庭。
        if (this.currentFamilyId && !this.families.some((f) => f.id === this.currentFamilyId)) {
          this.switchFamily(this.families[0]?.id ?? null)
        } else if (!this.currentFamilyId) {
          this.switchFamily(this.families[0]?.id ?? null)
        }
        return true
      } catch (err) {
        this.error = err instanceof Error ? err.message : '家庭列表加载失败'
        return false
      } finally {
        this.loading = false
      }
    },

    async create(name: string): Promise<FamilyDto | null> {
      try {
        const family = await familiesApi.create(name)
        this.families = [...this.families, family]
        this.switchFamily(family.id)
        return family
      } catch (err) {
        this.error = err instanceof Error ? err.message : '创建家庭失败'
        return null
      }
    },

    /** 只改选中的家庭 id 并持久化。孩子状态本就按家庭分键，因此这里不清空它。 */
    switchFamily(familyId: string | null): void {
      this.currentFamilyId = familyId
      uni.setStorageSync(CURRENT_FAMILY_KEY, familyId ?? '')
    },

    async leave(familyId: string): Promise<boolean> {
      try {
        await familiesApi.leave(familyId)
        this.families = this.families.filter((f) => f.id !== familyId)
        if (this.currentFamilyId === familyId) this.switchFamily(this.families[0]?.id ?? null)
        return true
      } catch (err) {
        this.error = err instanceof Error ? err.message : '退出家庭失败'
        return false
      }
    },

    /** 转让后自己的角色从 OWNER 变 ADMIN，本地那份 role 已经过时，只能重拉。 */
    async transfer(familyId: string, toUserId: string): Promise<boolean> {
      try {
        await familiesApi.transfer(familyId, toUserId)
        await this.load()
        return true
      } catch (err) {
        this.error = err instanceof Error ? err.message : '转让所有权失败'
        return false
      }
    },

    async archive(familyId: string): Promise<boolean> {
      try {
        await familiesApi.archive(familyId)
        this.families = this.families.filter((f) => f.id !== familyId)
        if (this.currentFamilyId === familyId) this.switchFamily(this.families[0]?.id ?? null)
        return true
      } catch (err) {
        this.error = err instanceof Error ? err.message : '归档家庭失败'
        return false
      }
    },
  },
})
