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
# `@moonbud/api...` 末尾那三个点是必需的，不是排版：pnpm 的 `--filter <pkg>` 只选**那一个包**，
# 而 `--filter <pkg>...` 才是"这个包加上它的依赖"。写成前者时 workspace 包 @moonbud/shared
# 只是被软链过来，它自己 package.json 里的 zod、rrule 一个都不装，
# 于是容器起来第一行 import 就死在 `Error: Cannot find module 'zod'`。
RUN pnpm install --prod --filter "@moonbud/api..."
# Prisma 用 `openssl` 命令行的版本号决定下载哪一个引擎。node:22-alpine（3.24）里
# 只有 libssl.so.3 而**没有 openssl 命令**，检测失败时它不报错，只 warn 一句
# "Defaulting to openssl-1.1.x"，然后下载链接 libssl.so.1.1 的旧 musl 引擎
# （libquery_engine-linux-musl.so.node）。那个引擎在容器里根本加载不起来，
# 表现是 `Error: Could not parse schema engine response: ... Error loading shared library`，
# 迁移失败、CMD 失败、restart: unless-stopped 把容器变成重启循环。
# 装上 openssl 让检测拿到 3.0.x；必须在下面装 CLI 之前，装 CLI 时它会拉自己的引擎。
# Alpine 官方 CDN（dl-cdn.alpinelinux.org）从国内拉不动——这台服务器上是 TLS 直接失败，
# 换一次网络又可能变成超时——所以先换阿里云镜像。留成构建参数：不在国内构建的人
# 用 `--build-arg ALPINE_MIRROR=dl-cdn.alpinelinux.org` 就能换回官方源。
ARG ALPINE_MIRROR=mirrors.aliyun.com
RUN sed -i "s|dl-cdn.alpinelinux.org|${ALPINE_MIRROR}|g" /etc/apk/repositories \
 && apk add --no-cache openssl
# CMD 那句 `npx prisma` 会在**容器启动的那一刻**去 registry 取 prisma CLI：prisma 是
# devDependency，上面的 --prod 安装里没有它，而镜像里也没有 npx 缓存。于是网络抖一下
# 迁移就失败，`restart: unless-stopped` 把容器反复拉起又反复失败，表现是
# "API 突然连不上，日志里全是 npm 报错"。
# 用 npm 装成**全局**包而不是 pnpm add -D：后者的报错是
# "modules directory was installed with optionalDependencies, dependencies.
# Current install wants ... devDependencies"——pnpm 不允许往 --prod 装好的目录里补 dev 依赖，
# 而 `pnpm install`（不带 --prod）会把 jest/@nestjs/cli 整套拖进生产镜像。
# 版本写死 5.22.0：它必须与 dependencies 里的 @prisma/client 同主版本，否则
# generate 出来的 client 与 CLI 校验的引擎版本不一致，报错是"版本不匹配"这种看不懂的样子。
# registry 沿用仓库根 .npmrc 的 npmmirror（npm 也会读项目目录里的 .npmrc）。
RUN npm install -g prisma@5.22.0

COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist

WORKDIR /repo/apps/api

# 客户端在**运行阶段**生成，不从构建阶段 COPY。原来那两条
# `COPY --from=build /repo/apps/api/node_modules/.prisma` 与 `.../node_modules/@prisma`
# 指向的路径根本不存在，构建会以
# "failed to calculate checksum of ref ...: /repo/apps/api/node_modules/.prisma: not found" 失败：
# pnpm 把生成物写在 /repo/node_modules/.pnpm/@prisma+client@5.22.0*/node_modules/.prisma，
# 而 apps/api/node_modules/@prisma 只是一个装软链的目录，不是可拷贝的内容。
# 在这里 generate 正好落在运行阶段自己装好的 @prisma/client 上，应用按常规解析就能拿到。
RUN prisma generate

EXPOSE 3000

# 启动前先跑迁移：容器是唯一入口，手工步骤一定会被遗漏。
# 这里用 `prisma` 而不是 `npx prisma`：npx 在本地找不到时会先去 registry 装一份，
# 那正是上面要避免的"启动依赖网络"；上面已经把 CLI 装成全局包了。
CMD ["sh", "-c", "prisma migrate deploy && node dist/main.js"]
