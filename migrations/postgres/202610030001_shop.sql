-- 本示例使用 PostgreSQL 18 起支持的 ICU 非确定性排序规则 LIKE。
DO $$
BEGIN
    IF current_setting('server_version_num')::integer < 180000 THEN
        RAISE EXCEPTION 'multi-database-demo 需要 PostgreSQL 18 或更高版本及 ICU 支持';
    END IF;
END
$$;

-- PostgreSQL 18 店铺基线；ICU 比较规则用于大小写与重音等价。
CREATE COLLATION "starter_unicode_ci" (provider = icu, locale = 'und-u-ks-level1', deterministic = false);
CREATE TABLE "shop" ("id" bigserial,"name" varchar(255) COLLATE "starter_unicode_ci" NOT NULL,"slug" varchar(255) COLLATE "starter_unicode_ci" NOT NULL,"status" varchar(32) COLLATE "starter_unicode_ci" NOT NULL DEFAULT 'active',"created_at" timestamptz NOT NULL,"updated_at" timestamptz NOT NULL,PRIMARY KEY ("id"));
CREATE INDEX IF NOT EXISTS "idx_status" ON "shop" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "uk_slug" ON "shop" ("slug");
COMMENT ON COLUMN "shop"."id" IS '店铺编号';
COMMENT ON COLUMN "shop"."name" IS '店铺名称';
COMMENT ON COLUMN "shop"."slug" IS '店铺唯一标识';
COMMENT ON COLUMN "shop"."status" IS '状态 active 或 inactive';
COMMENT ON COLUMN "shop"."created_at" IS '创建时间';
COMMENT ON COLUMN "shop"."updated_at" IS '更新时间';
