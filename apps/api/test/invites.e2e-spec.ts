import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'
import { PrismaService } from '../src/prisma/prisma.service'

describe('邀请码', () => {
  let app: INestApplication
  let prisma: PrismaService
  let owner: { token: string; id: string }
  let admin: { token: string; id: string }
  let joiner: { token: string; id: string }
  let outsider: { token: string; id: string }
  let familyId: string

  const register = async (username: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username, password: 'pass12345', nickname: username, timezone: 'Asia/Shanghai' })
      .expect(201)
    return { token: res.body.accessToken as string, id: res.body.user.id as string }
  }

  const seedMember = async (userId: string, role: 'OWNER' | 'ADMIN' | 'MEMBER') =>
    prisma.familyMember.create({ data: { familyId, userId, role } })

  const createInvite = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/families/${familyId}/invites`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send(body)

  const accept = (code: string, token: string) =>
    request(app.getHttpServer())
      .post(`/api/invites/${code}/accept`)
      .set('Authorization', `Bearer ${token}`)

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
  })

  beforeEach(async () => {
    await resetDatabase()
    owner = await register('inv_owner')
    admin = await register('inv_admin')
    joiner = await register('inv_join1')
    outsider = await register('inv_out1')
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

  it('生成的邀请码为 8 位且不含易混字符', async () => {
    const res = await createInvite({ role: 'MEMBER' }).expect(201)
    expect(res.body.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/)
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('不能生成 OWNER 角色的邀请码', async () => {
    await createInvite({ role: 'OWNER' }).expect(400)
  })

  it('接受邀请后成为成员，家庭出现在自己的列表里', async () => {
    const inv = await createInvite({ role: 'MEMBER' }).expect(201)
    const accepted = await accept(inv.body.code, joiner.token).expect(201)
    expect(accepted.body.id).toBe(familyId)

    const list = await request(app.getHttpServer())
      .get('/api/families')
      .set('Authorization', `Bearer ${joiner.token}`)
      .expect(200)
    expect(list.body.map((f: { id: string }) => f.id)).toEqual([familyId])
    expect(list.body[0].role).toBe('MEMBER')
  })

  it('邀请上的角色决定加入后的角色（ADMIN 邀请进来就是 ADMIN）', async () => {
    const inv = await createInvite({ role: 'ADMIN' }).expect(201)
    await accept(inv.body.code, joiner.token).expect(201)
    const row = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId, userId: joiner.id } },
    })
    expect(row.role).toBe('ADMIN')
  })

  it('已加入的人重复接受不会重复插入，也不消耗使用次数（幂等）', async () => {
    const inv = await createInvite({ role: 'MEMBER', maxUses: 5 }).expect(201)
    await accept(inv.body.code, joiner.token).expect(201)
    await accept(inv.body.code, joiner.token).expect(201)

    const detail = await request(app.getHttpServer())
      .get(`/api/families/${familyId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200)
    expect(detail.body.members).toHaveLength(2)

    const invites = await request(app.getHttpServer())
      .get(`/api/families/${familyId}/invites`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200)
    expect(invites.body[0].usedCount).toBe(1)
  })

  it('超过使用次数上限后拒绝', async () => {
    const inv = await createInvite({ role: 'MEMBER', maxUses: 0 }).expect(201)
    await accept(inv.body.code, joiner.token).expect(400)
  })

  it('撤销后的邀请码不可用', async () => {
    const inv = await createInvite({ role: 'MEMBER' }).expect(201)
    await request(app.getHttpServer())
      .delete(`/api/families/${familyId}/invites/${inv.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(204)
    await accept(inv.body.code, joiner.token).expect(400)
  })

  it('过期的邀请码不可用', async () => {
    // 直接落库造一条已过期的邀请：等真实时间过期会让测试变慢且不确定。
    const expired = await prisma.familyInvite.create({
      data: {
        familyId,
        code: 'EXPIRED2',
        role: 'MEMBER',
        createdBy: owner.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    })
    await accept(expired.code, joiner.token).expect(400)
  })

  it('归档家庭的邀请码不能把人加进已归档的家庭（归档是硬边界）', async () => {
    const inv = await createInvite({ role: 'MEMBER' }).expect(201)
    await request(app.getHttpServer())
      .post(`/api/families/${familyId}/archive`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200)

    await accept(inv.body.code, joiner.token).expect(400)

    const row = await prisma.familyMember.findUnique({
      where: { familyId_userId: { familyId, userId: joiner.id } },
    })
    expect(row).toBeNull()
  })

  it('不存在的邀请码返回 400，且不泄露家庭信息', async () => {    const named = await request(app.getHttpServer())
      .post('/api/families')
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ name: '别泄露这个家庭名' })
      .expect(201)
    expect(named.body.id).toBeTruthy()

    const res = await accept('NOTEXIST', joiner.token).expect(400)
    expect(JSON.stringify(res.body)).not.toContain('别泄露这个家庭名')
    expect(JSON.stringify(res.body)).not.toContain(familyId)
  })

  it('邀请是家庭作用域数据：非成员不能创建、查看或撤销', async () => {
    const inv = await createInvite({ role: 'MEMBER' }).expect(201)
    const endpoints: Array<[string, string]> = [
      ['get', `/api/families/${familyId}/invites`],
      ['post', `/api/families/${familyId}/invites`],
      ['delete', `/api/families/${familyId}/invites/${inv.body.id}`],
    ]
    for (const [method, path] of endpoints) {
      await (request(app.getHttpServer()) as never as Record<string, (p: string) => request.Test>)
        [method](path)
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({ role: 'MEMBER' })
        .expect(403)
    }
  })

  it('MEMBER 不能创建邀请（需要 ADMIN 及以上）', async () => {
    await seedMember(joiner.id, 'MEMBER')
    await request(app.getHttpServer())
      .post(`/api/families/${familyId}/invites`)
      .set('Authorization', `Bearer ${joiner.token}`)
      .send({ role: 'ADMIN' })
      .expect(403)
  })

  it('ADMIN 可以创建邀请，但接受邀请不需要家庭上下文（未加入者也能调）', async () => {
    await seedMember(admin.id, 'ADMIN')
    const inv = await request(app.getHttpServer())
      .post(`/api/families/${familyId}/invites`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ role: 'MEMBER' })
      .expect(201)
    // 未登录一律 401；已登录但不是任何家庭的成员也能接受邀请。
    await request(app.getHttpServer()).post(`/api/invites/${inv.body.code}/accept`).expect(401)
    await accept(inv.body.code, outsider.token).expect(201)
  })

  it('创建邀请不能把 maxUses 设成负数', async () => {
    await createInvite({ role: 'MEMBER', maxUses: -1 }).expect(400)
  })
})
