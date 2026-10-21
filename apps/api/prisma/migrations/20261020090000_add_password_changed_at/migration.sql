-- 改密要能立刻作废还在有效期内的 access token（无状态 JWT 撤不掉，只能比对 iat）。
ALTER TABLE "users" ADD COLUMN "passwordChangedAt" TIMESTAMPTZ(3);

-- 存量行填成注册时间：那一刻之前不可能有还在使用的会话，填了才不会让"无法判断"
-- 变成"永远不撤销"。留在 null 上，第一次改密之前的旧 token 就抓不到了。
UPDATE "users" SET "passwordChangedAt" = "createdAt" WHERE "passwordChangedAt" IS NULL;
