-- =====================================================
-- 电商数据平台 - 新增表建表 SQL
-- 在 Supabase 控制台 → SQL Editor 中执行此文件
-- =====================================================

-- 1. 跨境商品成本库（全平台共用）
CREATE TABLE IF NOT EXISTS cb_product_costs (
  id          TEXT PRIMARY KEY,
  sku         TEXT NOT NULL,
  name        TEXT DEFAULT '',
  cost        NUMERIC(10,4) DEFAULT 0,
  shipping    NUMERIC(10,4) DEFAULT 0,
  note        TEXT DEFAULT '',
  image       TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 跨境订单列表
CREATE TABLE IF NOT EXISTS cb_orders (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL,
  date        DATE NOT NULL,
  sku         TEXT DEFAULT '',
  sale_amount NUMERIC(10,4) DEFAULT 0,
  remark      TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cb_orders_shop_id ON cb_orders(shop_id);
CREATE INDEX IF NOT EXISTS idx_cb_orders_date ON cb_orders(date);

-- 3. 退货退款记录
CREATE TABLE IF NOT EXISTS cb_refunds (
  id            TEXT PRIMARY KEY,
  shop_id       TEXT NOT NULL,
  date          DATE NOT NULL,
  sku           TEXT DEFAULT '',
  qty           INTEGER DEFAULT 0,
  refund_amount NUMERIC(10,4) DEFAULT 0,
  reason        TEXT DEFAULT '',
  status        TEXT DEFAULT '处理中',
  remark        TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cb_refunds_shop_id ON cb_refunds(shop_id);

-- 4. 差评率记录
CREATE TABLE IF NOT EXISTS cb_reviews (
  id               TEXT PRIMARY KEY,
  shop_id          TEXT NOT NULL,
  date             TEXT NOT NULL,
  total_reviews    INTEGER DEFAULT 0,
  negative_reviews INTEGER DEFAULT 0,
  negative_rate    NUMERIC(8,4) DEFAULT 0,
  remark           TEXT DEFAULT '',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cb_reviews_shop_id ON cb_reviews(shop_id);

-- 5. 跨境每日数据
CREATE TABLE IF NOT EXISTS cb_daily (
  id        TEXT PRIMARY KEY,
  shop_id   TEXT NOT NULL,
  date      DATE NOT NULL,
  visitors  NUMERIC DEFAULT 0,
  buyers    NUMERIC DEFAULT 0,
  qty       NUMERIC DEFAULT 0,
  amount    NUMERIC(10,4) DEFAULT 0,
  remark    TEXT DEFAULT '',
  UNIQUE(shop_id, date)
);
CREATE INDEX IF NOT EXISTS idx_cb_daily_shop_id ON cb_daily(shop_id);

-- 6. 店铺商品
CREATE TABLE IF NOT EXISTS shop_products (
  id         TEXT PRIMARY KEY,
  shop_id    TEXT NOT NULL,
  name       TEXT DEFAULT '',
  product_id TEXT DEFAULT '',
  sku        TEXT DEFAULT '',
  remark     TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shop_products_shop_id ON shop_products(shop_id);

-- 7. 国内数据（生意参谋日报）— 字段较多，含广告数据
CREATE TABLE IF NOT EXISTS domestic_stats (
  id               TEXT PRIMARY KEY,
  shop_id          TEXT NOT NULL,
  date             DATE NOT NULL,
  product_id       TEXT DEFAULT '',
  visitors         NUMERIC DEFAULT 0,
  pv               NUMERIC DEFAULT 0,
  fav_count        NUMERIC DEFAULT 0,
  pay_amount       NUMERIC(12,4) DEFAULT 0,
  actual_pay       NUMERIC(12,4) DEFAULT 0,
  refund_amount    NUMERIC(12,4) DEFAULT 0,
  refund_count     NUMERIC DEFAULT 0,
  search_buyers    NUMERIC DEFAULT 0,
  -- 全站推广
  zst_cost      NUMERIC(12,4) DEFAULT 0,
  zst_imp       NUMERIC DEFAULT 0,
  zst_clk       NUMERIC DEFAULT 0,
  zst_fav       NUMERIC DEFAULT 0,
  zst_cart      NUMERIC DEFAULT 0,
  zst_order     NUMERIC DEFAULT 0,
  zst_order_amt NUMERIC(12,4) DEFAULT 0,
  -- 直通车
  ztc_cost      NUMERIC(12,4) DEFAULT 0,
  ztc_imp       NUMERIC DEFAULT 0,
  ztc_clk       NUMERIC DEFAULT 0,
  ztc_fav       NUMERIC DEFAULT 0,
  ztc_cart      NUMERIC DEFAULT 0,
  ztc_order     NUMERIC DEFAULT 0,
  ztc_order_amt NUMERIC(12,4) DEFAULT 0,
  -- 引力魔方
  ylmf_cost      NUMERIC(12,4) DEFAULT 0,
  ylmf_imp       NUMERIC DEFAULT 0,
  ylmf_clk       NUMERIC DEFAULT 0,
  ylmf_fav       NUMERIC DEFAULT 0,
  ylmf_cart      NUMERIC DEFAULT 0,
  ylmf_order     NUMERIC DEFAULT 0,
  ylmf_order_amt NUMERIC(12,4) DEFAULT 0,
  remark         TEXT DEFAULT '',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_domestic_stats_shop_id ON domestic_stats(shop_id);
CREATE INDEX IF NOT EXISTS idx_domestic_stats_date ON domestic_stats(date);

-- =====================================================
-- 开启行级安全（RLS）并允许匿名读写（和现有表保持一致）
-- =====================================================
ALTER TABLE cb_product_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_refunds       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_reviews       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_daily         ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE domestic_stats   ENABLE ROW LEVEL SECURITY;

-- 允许匿名用户全部操作（和 shops/sales/academy 表保持一致）
CREATE POLICY "allow_all_cb_product_costs" ON cb_product_costs FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_cb_orders"        ON cb_orders        FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_cb_refunds"       ON cb_refunds       FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_cb_reviews"       ON cb_reviews       FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_cb_daily"         ON cb_daily         FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_shop_products"    ON shop_products    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_domestic_stats"   ON domestic_stats   FOR ALL TO anon USING (true) WITH CHECK (true);

-- 8. 统一运费设置（按店铺）
CREATE TABLE IF NOT EXISTS cb_shipping_rates (
  shop_id    TEXT PRIMARY KEY,
  rate       NUMERIC(10,4) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE cb_shipping_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_cb_shipping_rates" ON cb_shipping_rates FOR ALL TO anon USING (true) WITH CHECK (true);

-- 9. 店铺访问申请
CREATE TABLE IF NOT EXISTS shop_access_requests (
  id             TEXT PRIMARY KEY,
  shop_id        TEXT NOT NULL,
  shop_name      TEXT DEFAULT '',
  applicant_id   TEXT NOT NULL,
  applicant_name TEXT DEFAULT '',
  reason         TEXT DEFAULT '',
  status         TEXT DEFAULT 'pending',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shop_access_requests_status ON shop_access_requests(status);
ALTER TABLE shop_access_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_shop_access_requests" ON shop_access_requests FOR ALL TO anon USING (true) WITH CHECK (true);

-- 10. 款式差评明细（按货号记录每条差评内容）
CREATE TABLE IF NOT EXISTS cb_sku_reviews (
  id               TEXT PRIMARY KEY,
  shop_id          TEXT NOT NULL,
  date             DATE NOT NULL,
  sku              TEXT NOT NULL DEFAULT '',
  negative_content TEXT DEFAULT '',
  rating           INTEGER DEFAULT NULL,        -- 评分 1-5，可选
  reviewer         TEXT DEFAULT '',             -- 买家ID/昵称，可选
  status           TEXT DEFAULT '待处理',       -- 待处理/已回复/已解决
  remark           TEXT DEFAULT '',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cb_sku_reviews_shop_id ON cb_sku_reviews(shop_id);
CREATE INDEX IF NOT EXISTS idx_cb_sku_reviews_sku ON cb_sku_reviews(sku);
ALTER TABLE cb_sku_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_cb_sku_reviews" ON cb_sku_reviews FOR ALL TO anon USING (true) WITH CHECK (true);

