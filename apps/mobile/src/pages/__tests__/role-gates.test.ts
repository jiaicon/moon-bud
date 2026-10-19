import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 这一类 bug 是"页面上有个按钮，后端回 403"：权限只有服务端知道，
 * 前端把入口画给了点不动的人。所以把两端的角色要求钉在同一张测试里 ——
 * 后端改了角色，这条测试会要求前端一起改。
 */
const srcDir = join(__dirname, '..', '..')
const familySettings = readFileSync(join(srcDir, 'pages', 'family-settings', 'index.vue'), 'utf8')
const invitePage = readFileSync(join(srcDir, 'pages', 'invite-qrcode', 'index.vue'), 'utf8')
const familiesCtrl = readFileSync(join(srcDir, '../../api/src/families/families.controller.ts'), 'utf8')
const invitesCtrl = readFileSync(join(srcDir, '../../api/src/invites/invites.controller.ts'), 'utf8')

/** 取某个 handler 头上的装饰器，例如 archive 上面写的是 @RequireFamilyRole('OWNER')。 */
function decoratorsFor(source: string, handler: string): string {
  const at = source.indexOf(`async ${handler}(`)
  if (at < 0) throw new Error(`找不到 handler：${handler}`)
  // 前一个方法的收尾大括号就是这段装饰器栈的起点。
  const prevClose = source.lastIndexOf('\n  }', at)
  return source.slice(prevClose < 0 ? 0 : prevClose + 4, at)
}

describe('家庭设置页的角色门禁', () => {
  it('后端：归档只认 OWNER，改名认 OWNER/ADMIN，退出任何角色都行', () => {
    expect(decoratorsFor(familiesCtrl, 'archive')).toContain("@RequireFamilyRole('OWNER')")
    expect(decoratorsFor(familiesCtrl, 'rename')).toContain("@RequireFamilyRole('OWNER', 'ADMIN')")
    expect(decoratorsFor(familiesCtrl, 'leave')).not.toContain('@RequireFamilyRole')
  })

  it('前端：归档入口只画给 OWNER', () => {
    const section = familySettings.slice(familySettings.indexOf('危险操作') - 260, familySettings.indexOf('危险操作'))
    expect(section).toContain('v-if="isOwner"')
  })

  it('前端：改名输入框只画给 OWNER/ADMIN，其他人看到只读名称', () => {
    expect(familySettings).toContain('v-if="canManage"')
    expect(familySettings).toContain('只有管理员能改家庭名称')
  })
})

describe('邀请页的角色门禁', () => {
  it('后端：发码与撤销只认 OWNER/ADMIN，列表任何成员可读', () => {
    expect(decoratorsFor(invitesCtrl, 'create')).toContain("@RequireFamilyRole('OWNER', 'ADMIN')")
    expect(decoratorsFor(invitesCtrl, 'revoke')).toContain("@RequireFamilyRole('OWNER', 'ADMIN')")
    expect(decoratorsFor(invitesCtrl, 'list')).not.toContain('@RequireFamilyRole')
  })

  it('前端：普通成员看不到生成按钮和撤销按钮，只看得到码', () => {
    expect(invitePage).toContain('v-if="canManage"')
    expect(invitePage).toContain('v-if="canManage && !invite.revokedAt"')
    expect(invitePage).toContain('只有管理员能生成或撤销邀请码')
  })
})
