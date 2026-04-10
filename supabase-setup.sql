-- ============================================================
--  SHEIN 数据中台 - 数据库结构（完整版）
--  请在 Supabase SQL Editor 中执行此文件
-- ============================================================

-- 1. 用户表（手机号+密码注册，无需验证码）
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT DEFAULT '新用户',
  role TEXT DEFAULT 'member',  -- 'admin' 或 'member'
  status TEXT DEFAULT 'active', -- 'active' | 'disabled'
  created_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP
);

-- 2. 权限表（主账号可授权哪些页面给哪些用户）
CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  page TEXT NOT NULL,  -- 'dashboard' | 'styles' | 'revenue' | 'profit' | 'alert' | 'import' | 'shops' | 'academy'
  granted_by TEXT REFERENCES users(id),
  granted_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, page)
);

-- 3. 店铺表
CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  region TEXT,
  color TEXT DEFAULT '#6366f1',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

-- 4. 销售数据表
CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  shop_id TEXT REFERENCES shops(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  style_id TEXT,
  style_name TEXT,
  revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  orders INTEGER NOT NULL DEFAULT 0,
  refund_orders INTEGER DEFAULT 0,
  price NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(shop_id, date, style_id)
);

-- 5. 知识学院文章表
CREATE TABLE IF NOT EXISTS academy (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT '运营经验',
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT,
  likes INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
--  开启行级安全策略（RLS）
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy ENABLE ROW LEVEL SECURITY;

-- ============================================================
--  策略配置（允许匿名读写，由前端逻辑控制权限）
-- ============================================================
DROP POLICY IF EXISTS "anon_users" ON users;
CREATE POLICY "anon_users" ON users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_permissions" ON permissions;
CREATE POLICY "anon_permissions" ON permissions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_shops" ON shops;
CREATE POLICY "anon_shops" ON shops FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_sales" ON sales;
CREATE POLICY "anon_sales" ON sales FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_academy" ON academy;
CREATE POLICY "anon_academy" ON academy FOR ALL USING (true) WITH CHECK (true);
