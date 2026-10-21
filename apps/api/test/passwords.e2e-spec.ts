import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, resetDatabase } from './utils/db'
import { PrismaService } from '../src/prisma/prisma.service'

describe('密码', () => {
  let app: INestApplication
  let prisma: PrismaService

  const register = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/auth/register').send({
      password: 'pass12345',
      nickname: 'A',
      timezone: 'Asia/Shanghai',
      ...body,
    })

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
  })
  beforeEach(async () => {
    await resetDatabase()
  })
  afterAll(async () => {
    await resetDatabase()
    await app.close()
  })

  it('修改密码成功后旧 refresh token 失效，新 token 可用', async () => {
    const reg = await register({ username: 'pw_u1' }).expect(201)
    const changed = await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ oldPassword: 'pass12345', newPassword: 'newpass12345' })
      .expect(200)
    expect(changed.body.accessToken).toBeTruthy()
    expect(changed.body.refreshToken).toBeTruthy()

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: reg.body.refreshToken })
      .expect(401)

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'pw_u1', password: 'newpass12345' })
      .expect(200)

    // 新签发的 refresh token 必须能用：撤销旧会话不能连新会话一起撤销。
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: changed.body.refreshToken })
      .expect(200)
  })

  it('改密后，另一台设备上还没过期的 access token 立刻作废', async () => {
    const reg = await register({ username: 'pw_stolen' }).expect(201)
    // access token 是无状态的，TTL 默认 2 小时：此刻它在字面上仍然有效。
    const stolen = reg.body.accessToken as string
    await request(app.getHttpServer()).get('/api/me').set('Authorization', `Bearer ${stolen}`).expect(200)

    const changed = await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ oldPassword: 'pass12345', newPassword: 'newpass12345' })
      .expect(200)

    // 撤销了全部 refresh 会话却留着 access 不管，等于"改了密码、别人还能继续用"。
    const revoked = await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${stolen}`)
      .expect(401)
    // 客户端把这行文案直接显示给用户，英文到这里就是漏网。
    expect(revoked.body.message).toContain('密码已变更')
    await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${changed.body.accessToken}`)
      .expect(200)

    // 改密之后续期出来的 token 也算"改密之后"：水位要跟着新 token 走，
    // 否则用户只能重新登录一次才能用。
    const renewed = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: changed.body.refreshToken })
      .expect(200)
    await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${renewed.body.accessToken}`)
      .expect(200)
  })

  it('管理员重置临时密码，本人那一台正在用的会话也被踢下线', async () => {
    const a = await register({ username: 'pw_kick_owner' }).expect(201)
    const b = await register({ username: 'pw_kick_member' }).expect(201)
    const family = await request(app.getHttpServer())
      .post('/api/families')
      .set('Authorization', `Bearer ${a.body.accessToken}`)
      .send({ name: 'F' })
      .expect(201)
    const bRow = await prisma.familyMember.create({
      data: { familyId: family.body.id, userId: b.body.user.id, role: 'MEMBER' },
    })

    // B 正登录着用，密码被家人改掉了——B 的会话不该还能继续写数据。
    await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${b.body.accessToken}`)
      .expect(200)

    await request(app.getHttpServer())
      .post(`/api/families/${family.body.id}/members/${bRow.id}/reset-password`)
      .set('Authorization', `Bearer ${a.body.accessToken}`)
      .expect(200)

    await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${b.body.accessToken}`)
      .expect(401)
  })

  it('旧密码错误时拒绝修改，且原密码仍然有效', async () => {
    const reg = await register({ username: 'pw_u2' }).expect(201)
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ oldPassword: 'wrongpass1', newPassword: 'newpass12345' })
      .expect(401)
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'pw_u2', password: 'pass12345' })
      .expect(200)
  })

  it('新密码过短被拒绝，且密码没有被改动', async () => {
    const reg = await register({ username: 'pw_u3' }).expect(201)
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ oldPassword: 'pass12345', newPassword: 'short' })
      .expect(400)
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'pw_u3', password: 'pass12345' })
      .expect(200)
  })

  it('未登录不能修改密码', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .send({ oldPassword: 'pass12345', newPassword: 'newpass12345' })
      .expect(401)
  })

  it('reset-request 对存在与不存在的账号返回相同状态码与相同响应体', async () => {
    await register({ username: 'pw_u4' }).expect(201)
    const known = await request(app.getHttpServer())
      .post('/api/auth/reset-request')
      .send({ username: 'pw_u4' })
      .expect(202)
    const unknown = await request(app.getHttpServer())
      .post('/api/auth/reset-request')
      .send({ username: 'ghost999' })
      .expect(202)
    expect(known.body).toEqual(unknown.body)
  })

  it('reset-request 只登记请求，不自行重置任何人的密码', async () => {
    const reg = await register({ username: 'pw_u5' }).expect(201)
    await request(app.getHttpServer())
      .post('/api/auth/reset-request')
      .send({ username: 'pw_u5' })
      .expect(202)
    // 原密码必须照旧可用：没有家庭成员的当面确认，v1 不提供自助重置。
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'pw_u5', password: 'pass12345' })
      .expect(200)
    expect(reg.body.user.username).toBe('pw_u5')
  })

  it('临时密码首登被要求改密，改完后 mustChangePassword 复位——完整闭环', async () => {
    // 家人 A 建家庭，家人 B 加入；B 忘记密码，由 A 在成员页重置。
    const a = await register({ username: 'pw_owner' }).expect(201)
    const b = await register({ username: 'pw_member' }).expect(201)
    const family = await request(app.getHttpServer())
      .post('/api/families')
      .set('Authorization', `Bearer ${a.body.accessToken}`)
      .send({ name: 'F' })
      .expect(201)
    const bRow = await prisma.familyMember.create({
      data: { familyId: family.body.id, userId: b.body.user.id, role: 'MEMBER' },
    })

    const reset = await request(app.getHttpServer())
      .post(`/api/families/${family.body.id}/members/${bRow.id}/reset-password`)
      .set('Authorization', `Bearer ${a.body.accessToken}`)
      .expect(200)
    const temp = reset.body.temporaryPassword as string

    const firstLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'pw_member', password: temp })
      .expect(200)
    expect(firstLogin.body.mustChangePassword).toBe(true)

    // 冷启动静默续期后，客户端只能靠 /me 知道还要强制改密：refresh 不返回这个布尔。
    const meDuringForced = await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${firstLogin.body.accessToken}`)
      .expect(200)
    expect(meDuringForced.body.mustChangePassword).toBe(true)

    // 临时密码凭据是一次性的：登录成功那一刻就作废（spec 第 5 节）。
    const pending = await prisma.passwordResetToken.findMany({
      where: { userId: b.body.user.id, usedAt: null },
    })
    expect(pending).toHaveLength(0)

    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${firstLogin.body.accessToken}`)
      .send({ oldPassword: temp, newPassword: 'brandnew12345' })
      .expect(200)

    // 临时密码作废，新密码生效，且不再要求改密。
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'pw_member', password: temp })
      .expect(401)
    const after = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'pw_member', password: 'brandnew12345' })
      .expect(200)
    expect(after.body.mustChangePassword).toBe(false)
  })

  describe('找回请求要真的通知到能帮忙的人', () => {
    /** 一个 OWNER、一个 ADMIN、一个 MEMBER，请求人是那个 MEMBER。 */
    async function threeRoleFamily() {
      const owner = await register({ username: 'rr_owner' }).expect(201)
      const admin = await register({ username: 'rr_admin' }).expect(201)
      const member = await register({ username: 'rr_member' }).expect(201)
      const family = await request(app.getHttpServer())
        .post('/api/families')
        .set('Authorization', `Bearer ${owner.body.accessToken}`)
        .send({ name: '奶奶家' })
        .expect(201)
      await prisma.familyMember.create({
        data: { familyId: family.body.id, userId: admin.body.user.id, role: 'ADMIN' },
      })
      await prisma.familyMember.create({
        data: { familyId: family.body.id, userId: member.body.user.id, role: 'MEMBER' },
      })
      return { owner, admin, member, familyId: family.body.id as string }
    }

    const requestReset = (username: string) =>
      request(app.getHttpServer()).post('/api/auth/reset-request').send({ username })

    it('给同家庭的 OWNER 与 ADMIN 各生成一条通知，普通成员收不到', async () => {
      const { owner, admin, member, familyId } = await threeRoleFamily()

      await requestReset('rr_member').expect(202)

      const notifications = await prisma.notification.findMany({
        where: { familyId },
      })
      expect(notifications.map((n) => n.userId).sort()).toEqual(
        [owner.body.user.id, admin.body.user.id].sort(),
      )
      for (const notification of notifications) {
        expect(notification.body).toContain('rr_member')
        expect(notification.title).toContain('密码')
      }
      // 请求者本人不该收到——他登不进去，通知他也无法自助重置。
      expect(notifications.some((n) => n.userId === member.body.user.id)).toBe(false)
    })

    it('账号不存在时一条通知都不生成', async () => {
      await threeRoleFamily()

      await requestReset('rr_ghost').expect(202)

      expect(await prisma.notification.count()).toBe(0)
    })

    it('请求者自己就是唯一的 OWNER 时，没有别人可通知，但请求照样登记', async () => {
      const solo = await register({ username: 'rr_solo' }).expect(201)
      await request(app.getHttpServer())
        .post('/api/families')
        .set('Authorization', `Bearer ${solo.body.accessToken}`)
        .send({ name: '一个人的家' })
        .expect(201)

      await requestReset('rr_solo').expect(202)

      expect(await prisma.notification.count()).toBe(0)
      expect(await prisma.passwordResetToken.count({ where: { userId: solo.body.user.id } })).toBe(
        1,
      )
    })

    it('连续点击提交只通知一次，不给管理员刷屏', async () => {
      const { owner } = await threeRoleFamily()

      await requestReset('RR_Member').expect(202)
      await requestReset('rr_member').expect(202)

      expect(
        await prisma.notification.count({ where: { userId: owner.body.user.id } }),
      ).toBe(1)
    })

    it('请求人名下有两个同名家庭时，通知挂在管理员真的在的那一家', async () => {
      const manager = await register({ username: 'rr_mgr' }).expect(201)
      const seeker = await register({ username: 'rr_seeker' }).expect(201)

      const createFamily = (name: string) =>
        request(app.getHttpServer())
          .post('/api/families')
          .set('Authorization', `Bearer ${seeker.body.accessToken}`)
          .send({ name })
          .expect(201)

      // 两个都叫"奶奶家"：前一个只有请求人自己，后一个才有管理员。
      const onlySeeker = await createFamily('奶奶家')
      const shared = await createFamily('奶奶家')
      await prisma.familyMember.create({
        data: { familyId: shared.body.id, userId: manager.body.user.id, role: 'ADMIN' },
      })

      await requestReset('rr_seeker').expect(202)

      const [notification] = await prisma.notification.findMany({
        where: { userId: manager.body.user.id },
      })
      // 按名字回找家庭会找到请求人独占的那一家——管理员不在那里，
      // 点开通知看到的成员列表与这条请求无关。
      expect(notification.familyId).toBe(shared.body.id)
      expect(notification.body).toContain('奶奶家')
    })
  })
})
