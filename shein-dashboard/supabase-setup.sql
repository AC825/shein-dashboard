-- ================================================================
--  SHEIN 数据中台 · Supabase 建表脚本
--  在 Supabase 控制台 → SQL Editor 里粘贴并运行
-- ================================================================

-- 1. 店铺表
CREATE TABLE IF NOT EXISTS shops (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  platform    TEXT DEFAULT 'SHEIN',
  color       TEXT DEFAULT '#6366f1',
  target      NUMERIC DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 销售数据表
CREATE TABLE IF NOT EXISTS sales (
  id            BIGSERIAL PRIMARY KEY,
  date          DATE NOT NULL,
  shop_id       TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  style_id      TEXT NOT NULL,
  style_name    TEXT NOT NULL,
  orders        INT DEFAULT 0,
  refund_orders INT DEFAULT 0,
  revenue       NUMERIC(12,2) DEFAULT 0,
  price         NUMERIC(10,2) DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  -- 唯一约束：同一天同一店铺同一款式只有一条记录
  UNIQUE (date, shop_id, style_id)
);

-- 3. 建索引（加速查询）
CREATE INDEX IF NOT EXISTS idx_sales_date    ON sales (date);
CREATE INDEX IF NOT EXISTS idx_sales_shop_id ON sales (shop_id);
CREATE INDEX IF NOT EXISTS idx_sales_style_id ON sales (style_id);

-- 4. 开启行级安全（RLS），允许匿名读写
-- ⚠ 注意：这是简化配置，适合内部团队使用
-- 如需限制权限，请参考 Supabase 文档添加更细粒度的策略

ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

-- 允许所有人读取
CREATE POLICY "允许所有人读" ON shops FOR SELECT USING (true);
CREATE POLICY "允许所有人读" ON sales  FOR SELECT USING (true);

-- 允许所有人写入（内部使用）
CREATE POLICY "允许所有人写" ON shops FOR INSERT WITH CHECK (true);
CREATE POLICY "允许所有人写" ON sales  FOR INSERT WITH CHECK (true);

-- 允许所有人更新
CREATE POLICY "允许所有人更新" ON shops FOR UPDATE USING (true);
CREATE POLICY "允许所有人更新" ON sales  FOR UPDATE USING (true);

-- 允许所有人删除
CREATE POLICY "允许所有人删除" ON shops FOR DELETE USING (true);
CREATE POLICY "允许所有人删除" ON sales  FOR DELETE USING (true);

-- ✅ 运行完毕后，回到 data.js 填写 SUPABASE_URL 和 SUPABASE_KEY
