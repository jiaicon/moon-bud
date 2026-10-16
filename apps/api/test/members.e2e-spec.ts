import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'
import { PrismaService } from '../src/prisma/prisma.service'

describe('成员管理', () => {
  let app: INestApplication
  let prisma: PrismaService
  let owner: { token: string; id: string }
  let admin: { token: string; id: string }
  let member: { token: string; id: string }
  let outsider: { token: string; id: string }
  let familyId: string

  const register = async (username: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username, password: 'pass12345', nickname: username, timezone: 'Asia/Shanghai' })
      .expect(201)
    return { token: res.body.accessToken as string, id: res.body.user.id as string }
  }

  /**
   * 直接把成员行写进库，而不是走邀请码。
   *
   * 邀请码是 Task 7 的交付物，本任务对它没有依赖；用不存在的端点铺测试数据
   * 会让这一整套测试在 Task 7 之前永远红着，等于没测。邀请码路径由
   * invites.e2e-spec.ts 从 API 正面覆盖。
   */
  const seedMember = async (userId: string, role: 'OWNER' | 'ADMIN' | 'MEMBER') => {
    const row = await prisma.familyMember.create({ data: { familyId, userId, role } })
    return row.id
  }

  const listMembers = async (token: string) => {
    const res = await request(app.getHttpServer())
      .get(`/api/families/${familyId}/members`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    return res.body as Array<{ id: string; userId: string; role: string; displayName: string | null }>
  }

  const memberRowId = async (userId: string) => {
    const row = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId, userId } },
    })
    return row.id
  }

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
  })

  beforeEach(async () => {
    await resetDatabase()
    owner = await register('owner_u1')
    admin = await register('admin_u1')
    member = await register('mem_u1')
    outsider = await register('out_u1')

    const f = await request(app.getHttpServer())
      .post('/api/families')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'F' })
      .expect(201)
    familyId = f.body.id as string
  })

  afterAll(async () => {
    await resetDatabase()
    await app.close()
  })

  it('成员列表返回称呼与账号，且不泄露密码哈希', async () => {
    await seedMember(member.id, 'MEMBER')
    const res = await request(app.getHttpServer())
      .get(`/api/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200)

    expect(res.body).toHaveLength(2)
    const row = res.body.find((m: { userId: string }) => m.userId === member.id)
    expect(row.username).toBe('mem_u1')
    expect(row.nickname).toBe('mem_u1')
    expect(row.displayName).toBeNull()
    expect(JSON.stringify(res.body)).not.toContain('$2')
  })

  it('最后一名 OWNER 不能退出家庭', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/families/${familyId}/leave`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(400)
    expect(JSON.stringify(res.body)).toMatch(/所有者|转让/)
  })

  it('最后一名 OWNER 不能被移除', async () => {
    const ownerRowId = await memberRowId(owner.id)
    await request(app.getHttpServer())
      .delete(`/api/families/${familyId}/members/${ownerRowId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(400)
    // 回滚必须是真的：家庭里仍应有一名 OWNER。
    expect(await listMembers(owner.token)).toHaveLength(1)
  })

  it('最后一名 OWNER 不能被降级为 ADMIN', async () => {
    const ownerRowId = await memberRowId(owner.id)
    await request(app.getHttpServer())
      .patch(`/api/families/${familyId}/members/${ownerRowId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ role: 'ADMIN' })
      .expect(400)
    const rows = await listMembers(owner.token)
    expect(rows[0].role).toBe('OWNER')
  })

  it('有两名 OWNER 时其中一人可以退出，家庭仍由剩下的 OWNER 掌握', async () => {
    await seedMember(member.id, 'MEMBER')
    await request(app.getHttpServer())
      .post(`/api/families/${familyId}/transfer`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ toUserId: member.id })
      .expect(200)

    await request(app.getHttpServer())
      .post(`/api/families/${familyId}/leave`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(204)

    const rows = await listMembers(member.token)
    expect(rows).toHaveLength(1)
    expect(rows[0].role).toBe('OWNER')
  })

  it('OWNER 可以把成员的称呼与角色一起改掉', async () => {
    await seedMember(member.id, 'MEMBER')
    const rowId = await memberRowId(member.id)
    const res = await request(app.getHttpServer())
      .patch(`/api/families/${familyId}/members/${rowId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ role: 'ADMIN', displayName: '奶奶' })
      .expect(200)

    expect(res.body.role).toBe('ADMIN')
    expect(res.body.displayName).toBe('奶奶')
  })

  it('不能通过成员接口把自己提成 OWNER（所有权只能靠转让）', async () => {
    await seedMember(admin.id, 'ADMIN')
    const rowId = await memberRowId(admin.id)
    await request(app.getHttpServer())
      .patch(`/api/families/${familyId}/members/${rowId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ role: 'OWNER' })
      .expect(400)
    expect((await listMembers(admin.token)).find((m) => m.userId === admin.id)?.role).toBe('ADMIN')
  })

  it('ADMIN 不能移除 OWNER，也不能改 OWNER 的角色', async () => {
    await seedMember(admin.id, 'ADMIN')
    const ownerRowId = await memberRowId(owner.id)
    await request(app.getHttpServer())
      .delete(`/api/families/${familyId}/members/${ownerRowId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(403)
    await request(app.getHttpServer())
      .patch(`/api/families/${familyId}/members/${ownerRowId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ displayName: '被改了' })
      .expect(403)
    expect(await listMembers(owner.token)).toHaveLength(2)
  })

  it('MEMBER 不能移除他人，也不能改角色或称呼', async () => {
    await seedMember(admin.id, 'ADMIN')
    await seedMember(member.id, 'MEMBER')
    const adminRowId = await memberRowId(admin.id)
    await request(app.getHttpServer())
      .delete(`/api/families/${familyId}/members/${adminRowId}`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(403)
    await request(app.getHttpServer())
      .patch(`/api/families/${familyId}/members/${adminRowId}`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ displayName: '我说了算' })
      .expect(403)
    await request(app.getHttpServer())
      .post(`/api/families/${familyId}/members/${adminRowId}/reset-password`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(403)
  })

  it('ADMIN 可以移除 MEMBER', async () => {
    await seedMember(admin.id, 'ADMIN')
    await seedMember(member.id, 'MEMBER')
    const targetRowId = await memberRowId(member.id)
    await request(app.getHttpServer())
      .delete(`/api/families/${familyId}/members/${targetRowId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(204)
    expect(await listMembers(owner.token)).toHaveLength(2)
  })

  it('重置成员密码返回一次性临时密码，成员用它登录会被要求改密，旧密码立即失效', async () => {
    await seedMember(member.id, 'MEMBER')
    const rowId = await memberRowId(member.id)
    const res = await request(app.getHttpServer())
      .post(`/api/families/${familyId}/members/${rowId}/reset-password`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200)

    const temp = res.body.temporaryPassword as string
    expect(temp).toHaveLength(12)
    expect(JSON.stringify(res.body)).not.toContain('$2')

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'mem_u1', password: 'pass12345' })
      .expect(401)

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'mem_u1', password: temp })
      .expect(200)
    expect(login.body.mustChangePassword).toBe(true)
  })

  it('重置密码会撤销目标成员已登录的会话', async () => {
    await seedMember(member.id, 'MEMBER')
    const rowId = await memberRowId(member.id)
    // 成员先登录，拿到一枚仍在有效期内的 refresh token。
    const loggedIn = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'mem_u1', password: 'pass12345' })
      .expect(200)

    await request(app.getHttpServer())
      .post(`/api/families/${familyId}/members/${rowId}/reset-password`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200)

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: loggedIn.body.refreshToken })
      .expect(401)
  })

  it('不能对自己发起重置密码（那会绕过旧密码校验）', async () => {
    const rowId = await memberRowId(owner.id)
    await request(app.getHttpServer())
      .post(`/api/families/${familyId}/members/${rowId}/reset-password`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(400)
  })

  it('ADMIN 不能重置 OWNER 的密码', async () => {
    await seedMember(admin.id, 'ADMIN')
    const ownerRowId = await memberRowId(owner.id)
    await request(app.getHttpServer())
      .post(`/api/families/${familyId}/members/${ownerRowId}/reset-password`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(403)
  })

  it('不存在的成员返回 404，别的家庭的成员也返回 404', async () => {
    // 正控制：同一条路由对真实成员必须成功。没有这一步，"路由不存在"也返回
    // 404，本用例就成了永远为真的假绿灯。
    const realRowId = await seedMember(member.id, 'MEMBER')
    await request(app.getHttpServer())
      .patch(`/api/families/${familyId}/members/${realRowId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ displayName: '奶奶' })
      .expect(200)

    const other = await register('other_u1')
    const otherFamily = await request(app.getHttpServer())
      .post('/api/families')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ name: '别家' })
      .expect(201)
    const otherRow = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: otherFamily.body.id, userId: other.id } },
    })

    await request(app.getHttpServer())
      .patch(`/api/families/${familyId}/members/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ displayName: 'x' })
      .expect(404)

    await request(app.getHttpServer())
      .delete(`/api/families/${familyId}/members/${otherRow.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(404)
  })

  it('非成员的每一个成员端点都返回 403（新增端点不会漏挂守卫）', async () => {
    await seedMember(member.id, 'MEMBER')
    const rowId = await memberRowId(member.id)
    const endpoints: Array<[string, string]> = [
      ['get', `/api/families/${familyId}/members`],
      ['patch', `/api/families/${familyId}/members/${rowId}`],
      ['delete', `/api/families/${familyId}/members/${rowId}`],
      ['post', `/api/families/${familyId}/members/${rowId}/reset-password`],
    ]
    for (const [method, path] of endpoints) {
      await (request(app.getHttpServer()) as never as Record<string, (p: string) => request.Test>)
        [method](path)
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({ role: 'MEMBER', displayName: 'x' })
        .expect(403)
    }
  })
})
