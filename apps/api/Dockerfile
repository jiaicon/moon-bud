# ── 依赖阶段 ────────────────────────────────────────────────
# 构建上下文是**仓库根**：apps/api 依赖 workspace 包 @moonbud/shared，只拷
# apps/api 的话无法解析 workspace 协议。Docker 里用 pnpm 而不是 npm，
# 因为 npm 不认 pnpm 的 `workspace:*` 写法（EUNSUPPORTEDPROTOCOL）。
#
# 基础镜像用 node:22-alpine 而非 24：本机 Docker Hub 不可达（拉取 node:24-alpine
# 会被直接拒绝），而 node:22-alpine 已在本地缓存。22 满足全部依赖要求
# （bcrypt 5 只要求 node>=10），宿主机开发仍用 Node 24。
FROM node:22-alpine AS deps
WORKDIR /repo
# corepack 默认从 registry.npmjs.org 取 pnpm，本机访问不到。
# COREPACK_NPM_REGISTRY 与 .npmrc 都要设置：前者管 corepack 自己，
# 后者管 pnpm 装业务依赖。
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
COPY package.json pnpm-workspace.yaml .npmrc ./
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
# @moonbud/api 之外还要装 @moonbud/shared 自己的 devDependencies：
# `--filter @moonbud/api` 只会装依赖的运行时部分，而 shared 的构建
# 需要 tsup（devDependency），少了会以 "tsup: not found" 失败。
RUN pnpm install --filter @moonbud/api && pnpm install --filter @moonbud/shared

# ── 构建阶段 ────────────────────────────────────────────────
FROM deps AS build
WORKDIR /repo
COPY packages/shared ./packages/shared
COPY apps/api/nest-cli.json apps/api/tsconfig.json apps/api/tsconfig.build.json ./apps/api/
COPY apps/api/src ./apps/api/src
COPY apps/api/prisma ./apps/api/prisma

# shared 必须先构建：它的 package.json 把 main/types 指向 dist/，
# 而 apps/api 从 Task 8 起会 import 它的校验函数，不构建就解析不到。
RUN pnpm --filter @moonbud/shared build
RUN pnpm --filter @moonbud/api exec prisma generate
RUN pnpm --filter @moonbud/api build

# ── 运行阶段 ────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /repo
ENV NODE_ENV=production
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
COPY package.json pnpm-workspace.yaml .npmrc ./
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --prod --filter @moonbud/api

COPY --from=build /repo/apps/api/node_modules/.prisma ./apps/api/node_modules/.prisma
COPY --from=build /repo/apps/api/node_modules/@prisma ./apps/api/node_modules/@prisma
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist

WORKDIR /repo/apps/api
EXPOSE 3000

# 启动前先跑迁移：容器是唯一入口，手工步骤一定会被遗漏。
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
