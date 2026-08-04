// ============================================================
//  认证模块 auth.js
//  超级账号：A001 / 密码：123（本地硬编码，始终可用）
//  普通用户：手机号 + 密码，注册后需超级账号授权
// ============================================================

// ======== 安全的 showToast 包装（兼容旧版本 app-v3-v5.js） ========
// 旧版 app-v3-v5.js 中 showToast 是 IIFE 内部函数，没暴露到 window
// 这里用安全包装：优先用 window.showToast，其次用全局 showToast，最后降级到 auth-error 元素
function _safeShowToast(msg, type) {
  try {
    if (typeof window.showToast === 'function') { window.showToast(msg, type); return; }
  } catch(e) {}
  try {
    if (typeof showToast === 'function') { showToast(msg, type); return; }
  } catch(e) {}
  // 降级：直接更新页面上的 auth-error 元素（登录/注册页面）
  try {
    var form = (msg && msg.indexOf('登录') >= 0) ? 'login' : (msg && msg.indexOf('注册') >= 0 ? 'register' : 'login');
    var el = document.getElementById(form + '-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; return; }
  } catch(e) {}
  // 最后兜底
  console.log('[toast]', msg);
}

window._safeShowToast = _safeShowToast;

// ======== 超级账号配置 ========
const SUPER_ACCOUNT = {
  id: 'super_admin',
  phone: 'A001',
  account: 'A001',
  password: '123',
  nickname: '超级管理员',
  role: 'admin',
  status: 'active',
  permissions: [],  // admin 不需要权限列表，自动全开
};

// V239: 兜底账号表 — 网络完全卡死时绕过 Supabase 也能登录（CloudBase→Supabase 通道不稳定）
// 平时走 Supabase 实时校验，这里只在「本地无缓存 + Supabase 5s 超时」双重失败时兜底
// V244: 删了 17691374936 兜底账号（与 CloudBase 里 AC 用户手机号重名导致 UI 混乱，CloudBase 已稳定不需要兜底）
// 紧急恢复：用 A001/123 登入控制台即可
const BACKUP_ACCOUNTS = [];

// ======== 简单密码哈希 ========
function hashPassword(pwd) {
  let h = 0;
  for (let i = 0; i < pwd.length; i++) {
    h = ((h << 5) - h) + pwd.charCodeAt(i);
    h |= 0;
  }
  return 'ph_' + Math.abs(h).toString(16) + '_' + pwd.length + '_' + btoa(unescape(encodeURIComponent(pwd))).replace(/=/g,'');
}

// ======== 当前登录用户 ========
let CURRENT_USER = null;

// ======== 所有页面列表（用于权限控制） ========
const ALL_PAGES = ['dashboard','styles','revenue','profit','alert','import','shops','academy'];
const PAGE_NAMES = {
  dashboard: '数据看板',
  styles: '款式分析',
  revenue: '营业额统计',
  profit: '利润计算',
  alert: '预警中心',
  import: '数据导入',
  shops: '店铺管理',
  academy: '知识学院'
};

// ======== 细粒度操作权限（在页面权限基础上进一步控制具体操作） ========
// 格式：action_xxx
const ALL_ACTIONS = [
  'action_shop_create',     // 新建店铺
  'action_shop_delete_own', // 删除自己创建的店铺
  'action_shop_delete_all', // 删除任意店铺（含他人创建）
  'action_data_import',     // 导入数据
  'action_data_delete',     // 删除数据
  'action_member_manage',   // 管理成员（查看权限管理页）
];
const ACTION_NAMES = {
  action_shop_create:     '新建店铺',
  action_shop_delete_own: '删除自己的店铺',
  action_shop_delete_all: '删除任意店铺',
  action_data_import:     '导入数据',
  action_data_delete:     '删除数据',
  action_member_manage:   '管理成员权限',
};
const ACTION_GROUPS = {
  '店铺操作': ['action_shop_create','action_shop_delete_own','action_shop_delete_all'],
  '数据操作': ['action_data_import','action_data_delete'],
  '管理操作': ['action_member_manage'],
};

// 检查当前用户是否有某个操作权限
function canDo(action) {
  if (!CURRENT_USER) return false;
  if (CURRENT_USER.role === 'admin' || CURRENT_USER.id === 'super_admin') return true; // 管理员/超管全开
  // 普通员工默认拥有基础操作权限：创建店铺、删除/重命名自己的店铺、导入数据
  const DEFAULT_ACTIONS = ['action_shop_create', 'action_shop_delete_own', 'action_data_import'];
  if (DEFAULT_ACTIONS.includes(action)) return true;
  const perms = CURRENT_USER.permissions || [];
  return perms.includes(action);
}

// 检查当前用户是否可以查看指定店铺
// 管理员/超管/创建者 可见；普通员工需被授权 shop_view_<shopId> 或 shop_edit_<shopId>
function canViewShop(shopId) {
  if (!CURRENT_USER) return false;
  if (CURRENT_USER.role === 'admin' || CURRENT_USER.id === 'super_admin') return true;
  // 自己创建的店铺
  try {
    var shops = (typeof DB !== 'undefined' && DB.getAllShops) ? DB.getAllShops() : [];
    var shop = shops.find(function(s) { return s.id === shopId; });
    if (shop && shop.created_by === CURRENT_USER.id) return true;
  } catch(e) {}
  // 检查 permissions 表授权
  var perms = CURRENT_USER.permissions || [];
  if (perms.indexOf('shop_view_' + shopId) >= 0) return true;
  if (perms.indexOf('shop_edit_' + shopId) >= 0) return true;
  return false;
}

// 获取当前用户可见的店铺列表
function getVisibleShops() {
  if (!CURRENT_USER) return [];
  var allShops = (typeof DB !== 'undefined' && DB.getAllShops) ? DB.getAllShops() : [];
  if (!allShops.length && DB && DB.getShops) allShops = DB.getShops();
  return allShops.filter(function(s) { return canViewShop(s.id); });
}

window.canViewShop = canViewShop;
window.getVisibleShops = getVisibleShops;

// ======== 本地用户存储（离线模式） ========
const LocalUsers = {
  _key: 'shein_local_users',
  getAll() {
    try { return JSON.parse(localStorage.getItem(this._key) || '[]'); } catch(e) { return []; }
  },
  save(list) {
    localStorage.setItem(this._key, JSON.stringify(list));
  },
  find(phone) {
    return this.getAll().find(u => u.phone === phone || u.account === phone);
  },
  add(user) {
    const list = this.getAll();
    list.push(user);
    this.save(list);
  },
  update(id, updates) {
    const list = this.getAll();
    const idx = list.findIndex(u => u.id === id);
    if (idx >= 0) { Object.assign(list[idx], updates); this.save(list); }
  },
  remove(id) {
    const list = this.getAll().filter(u => u.id !== id);
    this.save(list);
  }
};

// ======== 本地权限存储 ========
const LocalPerms = {
  _key: 'shein_local_perms',
  getAll() {
    try { return JSON.parse(localStorage.getItem(this._key) || '{}'); } catch(e) { return {}; }
  },
  get(userId) {
    return this.getAll()[userId] || [];
  },
  set(userId, pages) {
    const all = this.getAll();
    all[userId] = pages;
    localStorage.setItem(this._key, JSON.stringify(all));
  },
  grant(userId, page) {
    const perms = this.get(userId);
    if (!perms.includes(page)) { perms.push(page); this.set(userId, perms); }
  },
  revoke(userId, page) {
    const perms = this.get(userId).filter(p => p !== page);
    this.set(userId, perms);
  },
  revokeAll(userId) {
    this.set(userId, []);
  },
  grantAll(userId) {
    this.set(userId, [...ALL_PAGES, ...ALL_ACTIONS]);
  },
  // 获取页面权限
  getPages(userId) {
    return this.get(userId).filter(p => !p.startsWith('action_'));
  },
  // 获取操作权限
  getActions(userId) {
    return this.get(userId).filter(p => p.startsWith('action_'));
  }
};

// ======== 初始化认证 ========
async function initAuth() {
  // 启动粒子背景（如果原版有的话，否则是空操作）
  try { if (typeof initParticles === 'function') { initParticles(); } else if (typeof window.initParticles === 'function') { window.initParticles(); } } catch(e) {}

  // 检查本地会话
  const saved = localStorage.getItem('shein_session');
  if (saved) {
    try {
      const session = JSON.parse(saved);

      // 超级账号会话恢复
      if (session.id === 'super_admin') {
        CURRENT_USER = { ...SUPER_ACCOUNT };
        startApp();
        return;
      }

      // 普通用户：从本地或 Supabase 恢复
      let user = null;
      if (SUPABASE_ENABLED) {
        try {
          const users = await sbFetch('users?id=eq.' + encodeURIComponent(session.id) + '&select=*');
          if (users && users.length > 0) user = users[0];
        } catch(e) {}
      }
      if (!user) {
        user = LocalUsers.find(session.phone);
        if (user && user.id !== session.id) user = LocalUsers.getAll().find(u => u.id === session.id);
      }

      if (user) {
        if (user.status === 'disabled') {
          localStorage.removeItem('shein_session');
          showAuthPageWithMsg('您的账号已被禁用，请联系管理员');
          return;
        }
        CURRENT_USER = user; if(window.CloudProfile){ window.CloudProfile.restore().then(function(p){ if(p&&p.current_theme!==undefined&&p.current_theme!==null){ try{ if(window._applyThemeClass){ window._applyThemeClass(p.current_theme); } else { for(var i=1;i<=10;i++){ document.body.classList.remove('theme-v'+i); } if(p.current_theme>=1){ document.body.classList.add('theme-v'+p.current_theme); } } }catch(e){} } }); }
        CURRENT_USER.permissions = await loadUserPermissions(user.id);
        startApp();
        return;
      }
    } catch(e) {}
    localStorage.removeItem('shein_session');
  }

  // 显示登录页
  document.getElementById('auth-page').style.display = 'flex';
}

function showAuthPageWithMsg(msg) {
  document.getElementById('auth-page').style.display = 'flex';
  setTimeout(() => showAuthError('login', msg), 100);
}

// ======== 加载用户权限 ========
async function loadUserPermissions(userId) {
  if (userId === 'super_admin') return ALL_PAGES;

  // 先从本地缓存读
  const localPerms = LocalPerms.get(userId);

  if (SUPABASE_ENABLED) {
    try {
      const perms = await sbFetch('permissions?user_id=eq.' + userId + '&select=page');
      const pages = perms.map(p => p.page);
      // 同步到本地缓存
      LocalPerms.set(userId, pages);
      return pages;
    } catch(e) {
      return localPerms;
    }
  }
  return localPerms;
}

// ======== 切换登录/注册 Tab ========
function switchAuthTab(tab) {
  const container = document.getElementById('auth-container');
  const forms    = document.getElementById('auth-forms');
  const cover    = document.getElementById('auth-cover');
  const coverLogin    = document.getElementById('cover-login');
  const coverRegister = document.getElementById('cover-register');
  const formLogin    = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');
  const formForgot   = document.getElementById('form-forgot');
  const loginError   = document.getElementById('login-error');
  const regError     = document.getElementById('reg-error');

  if (!container) return;

  // 清除错误提示
  if (loginError) loginError.style.display = 'none';
  if (regError) regError.style.display = 'none';

  // 切换容器模式
  container.classList.toggle('auth-mode-register', tab === 'register');
  container.classList.toggle('auth-mode-login', tab === 'login');

  // 切换表单（淡入淡出）
  if (tab === 'login') {
    formLogin.style.opacity = '1';
    formLogin.style.pointerEvents = 'auto';
    formLogin.style.position = 'relative';
    formRegister.style.opacity = '0';
    formRegister.style.pointerEvents = 'none';
    formRegister.style.position = 'absolute';
    if (formForgot) {
      formForgot.style.opacity = '0';
      formForgot.style.pointerEvents = 'none';
      formForgot.style.position = 'absolute';
    }
  } else {
    formRegister.style.opacity = '1';
    formRegister.style.pointerEvents = 'auto';
    formRegister.style.position = 'relative';
    formLogin.style.opacity = '0';
    formLogin.style.pointerEvents = 'none';
    formLogin.style.position = 'absolute';
    if (formForgot) {
      formForgot.style.opacity = '0';
      formForgot.style.pointerEvents = 'none';
      formForgot.style.position = 'absolute';
    }
  }
}

// ======== 显示/隐藏密码 ========
function togglePwd(inputId, btn) {
  const input = document.getElementById(inputId);
  const isText = input.type === 'text';
  input.type = isText ? 'password' : 'text';
  btn.innerHTML = isText
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
}

// V238: 给 sbFetch 包一层 5s 超时（CloudBase → Supabase 网络慢时不阻塞登录）
async function sbFetchWithTimeout(path, method, body, extra, timeoutMs) {
  timeoutMs = timeoutMs || 5000;
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Supabase 请求超时 (' + timeoutMs + 'ms)')), timeoutMs);
  });
  try {
    return await Promise.race([sbFetch(path, method, body, extra), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ======== 登录 ========
async function doLogin() {
  const account = document.getElementById('login-phone').value.trim();
  const pass = document.getElementById('login-pass').value;
  const btn = document.getElementById('btn-login');

  if (!account || !pass) {
    showAuthError('login', '请输入账号和密码');
    return;
  }

  btn.disabled = true;
  document.getElementById('login-btn-text').textContent = '登录中...';

  try {
    // ===== 超级账号检查（不走数据库） =====
    if (account === SUPER_ACCOUNT.account && pass === SUPER_ACCOUNT.password) {
      CURRENT_USER = { ...SUPER_ACCOUNT };
      localStorage.setItem('shein_session', JSON.stringify({ id: 'super_admin', phone: 'A001' }));
      _safeShowToast('欢迎，超级管理员！', 'success');
      startApp();
      return;
    }

    // ===== V239: 普通用户登录 — 本地优先（不查云端）=====
    let user = LocalUsers.find(account);
    let userFromCloud = false;
    let networkOk = true;  // V239: 跟踪网络是否正常

    // 本地没有才查云端（20s 硬超时，CloudBase CDN 偶发冷启动慢）
    if (!user && SUPABASE_ENABLED) {
      try {
        const users = await sbFetchWithTimeout('users?phone=eq.' + encodeURIComponent(account) + '&select=*', null, null, null, 20000);
        if (users && users.length > 0) {
          user = users[0];
          userFromCloud = true;
          // 缓存到本地（下次登录秒进）
          try { LocalUsers.add(user); } catch(e) {}
        }
      } catch(e) {
        // V239: Supabase 超时/失败 — 标记网络失败，去 BACKUP_ACCOUNTS 兜底
        networkOk = false;
        console.warn('[登录] Supabase 查用户失败:', e.message);
      }
    }

    // V239: 本地 + 云端都没找到 → 兜底表匹配（仅当网络失败时用，正常情况绝不走这里）
    if (!user && !networkOk) {
      const backup = BACKUP_ACCOUNTS.find(a => a.phone === account && a.password === pass);
      if (backup) {
        user = {
          id: 'backup_' + account,
          phone: backup.phone,
          account: backup.phone,
          nickname: backup.nickname,
          role: backup.role,
          status: backup.status,
          password_hash: hashPassword(backup.password),
          permissions: [],  // V239 兜底登录无 permissions，由 loadUserPermissions 后台异步加载
          _fromBackup: true,
        };
        console.log('[登录] V239 兜底账号登录:', account);
        // 缓存到本地
        try { LocalUsers.add(user); } catch(e) {}
      }
    }

    if (!user) {
      // V239: 区分网络失败 vs 真未注册
      if (!networkOk) {
        showAuthError('login', '网络慢，请稍后重试（云端用户库暂不可达）');
      } else {
        showAuthError('login', '账号未注册，请先注册');
      }
      btn.disabled = false;
      document.getElementById('login-btn-text').textContent = '登 录';
      return;
    }

    // 验证密码
    const ph = hashPassword(pass);
    if (user.password_hash !== ph) {
      showAuthError('login', '密码错误，请重新输入');
      btn.disabled = false;
      document.getElementById('login-btn-text').textContent = '登 录';
      return;
    }

    if (user.status === 'disabled') {
      showAuthError('login', '账号已被禁用，请联系管理员');
      btn.disabled = false;
      document.getElementById('login-btn-text').textContent = '登 录';
      return;
    }

    // V238: 先放行进应用，权限 / last_login 异步后台跑
    CURRENT_USER = user;
    localStorage.setItem('shein_session', JSON.stringify({ phone: user.phone, id: user.id }));

    _safeShowToast('欢迎回来，' + (user.nickname || user.phone), 'success');
    startApp();

    // 后台异步：恢复主题 + 加载权限 + 更新 last_login（不阻塞）
    setTimeout(async () => {
      try {
        if (window.CloudProfile) {
          const p = await window.CloudProfile.restore();
          if (p && p.current_theme !== undefined && p.current_theme !== null) {
            try { window._applyThemeClass && window._applyThemeClass(p.current_theme); } catch(e) {}
          }
        }
      } catch(e) {}
      try {
        const perms = await loadUserPermissions(user.id);
        CURRENT_USER.permissions = perms;
        if (perms.length === 0 && CURRENT_USER.role !== 'admin') {
          _safeShowToast('部分页面需要管理员授权才能访问', 'info');
        }
      } catch(e) {}
      try {
        if (SUPABASE_ENABLED) {
          await sbFetchWithTimeout('users?id=eq.' + user.id, 'PATCH', { last_login: new Date().toISOString() }, null, 5000);
        }
      } catch(e) {}
    }, 100);
  } catch(e) {
    showAuthError('login', '登录失败：' + e.message);
  } finally {
    btn.disabled = false;
    document.getElementById('login-btn-text').textContent = '登 录';
  }
}

// ======== 注册 ========
async function doRegister() {
  const phone = document.getElementById('reg-phone').value.trim();
  const nickname = document.getElementById('reg-nickname').value.trim();
  const pass = document.getElementById('reg-pass').value;
  const pass2 = document.getElementById('reg-pass2').value;
  const btn = document.getElementById('btn-register');

  if (!phone) { showAuthError('reg', '请输入手机号'); return; }
  if (!/^1\d{10}$/.test(phone)) { showAuthError('reg', '请输入正确的手机号格式（11位）'); return; }
  if (!pass) { showAuthError('reg', '请设置密码'); return; }
  if (pass.length < 6) { showAuthError('reg', '密码至少6位'); return; }
  if (pass !== pass2) { showAuthError('reg', '两次密码不一致'); return; }

  // 不允许用A001注册
  if (phone === 'A001') { showAuthError('reg', '该账号不可注册'); return; }

  btn.disabled = true;
  document.getElementById('reg-btn-text').textContent = '注册中...';

  try {
    // 检查本地是否已注册
    if (LocalUsers.find(phone)) {
      showAuthError('reg', '该手机号已注册，请直接登录');
      return;
    }

    // 检查 Supabase
    if (SUPABASE_ENABLED) {
      try {
        const exists = await sbFetch('users?phone=eq.' + encodeURIComponent(phone) + '&select=id');
        if (exists && exists.length > 0) {
          showAuthError('reg', '该手机号已注册，请直接登录');
          return;
        }
      } catch(e) {}
    }

    const newUser = {
      id: 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      phone,
      password_hash: hashPassword(pass),
      nickname: nickname || ('用户' + phone.slice(-4)),
      role: 'member',
      status: 'active',
      created_at: new Date().toISOString(),
    };

    // 先保存到 Supabase（主要），再保存本地（缓存）
    if (SUPABASE_ENABLED) {
      await sbFetch('users', 'POST', newUser);  // 失败会抛出错误，不再静默忽略
    }

    // 本地也保存一份
    LocalUsers.add(newUser);
    LocalPerms.set(newUser.id, []);

    CURRENT_USER = newUser;
    CURRENT_USER.permissions = [];
    localStorage.setItem('shein_session', JSON.stringify({ phone: newUser.phone, id: newUser.id }));

    _safeShowToast('注册成功！请等待管理员授权页面访问权限', 'success');
    startApp();
  } catch(e) {
    showAuthError('reg', '注册失败：' + e.message);
  } finally {
    btn.disabled = false;
    document.getElementById('reg-btn-text').textContent = '注 册';
  }
}

// ======== 退出登录 ========
function doLogout() {
  if (!confirm('确定要退出登录吗？')) return;
  localStorage.removeItem('shein_session');
  CURRENT_USER = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-page').style.display = 'flex';
  switchAuthTab('login');
  document.getElementById('login-phone').value = '';
  document.getElementById('login-pass').value = '';
}

// ======== 启动主应用 ========
function startApp() {
  document.getElementById('auth-page').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  updateUserPanel();
  applyPermissions();
  // V228: 登录后强制下一次同步走全量（只触发一次），确保清缓存/新设备也能拿到完整数据
  // （initMainApp 内的首次 syncFromSupabase 会消耗此标志 → 拉全量后自动复位）
  window.__needFullSyncOnce = true;
  initMainApp();
}

// ======== 更新侧边栏用户面板 ========
function updateUserPanel() {
  if (!CURRENT_USER) return;
  const name = CURRENT_USER.nickname || CURRENT_USER.phone;
  const role = CURRENT_USER.role === 'admin' ? '管理员' : '成员';
  const el_name = document.getElementById('user-name');
  const el_role = document.getElementById('user-role');
  const el_avatar = document.getElementById('user-avatar');
  if (el_name) el_name.textContent = name;
  if (el_role) el_role.textContent = CURRENT_USER.id === 'super_admin' ? '超级管理员' : role;
  if (el_avatar) el_avatar.textContent = name.charAt(0).toUpperCase();

  // 手机端顶栏头像同步
  const topbarAvatar = document.getElementById('topbar-avatar');
  if (topbarAvatar) topbarAvatar.textContent = name.charAt(0).toUpperCase();

  // 管理员才显示权限管理按钮
  const adminBtn = document.getElementById('btn-admin');
  if (adminBtn) adminBtn.style.display = CURRENT_USER.role === 'admin' ? 'flex' : 'none';
}

// ======== 根据权限控制导航显示 ========
function applyPermissions() {
  if (!CURRENT_USER) return;
  // 所有登录成员（含管理员）默认都可以查看左侧所有导航页面
  // 页面权限仅用于管理员控制是否灰显特殊入口，普通成员默认全开
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.style.opacity = '';
    el.style.pointerEvents = '';
    el.title = '';
  });
  // 管理员额外显示权限管理按钮
  const adminBtn = document.getElementById('btn-admin');
  if (adminBtn) {
    adminBtn.style.display = CURRENT_USER.role === 'admin' || CURRENT_USER.id === 'super_admin' ? 'flex' : 'none';
  }
}

// ======== 检查页面访问权限 ========
function checkPagePermission(page) {
  if (!CURRENT_USER) return false;
  // 所有登录成员默认可访问所有页面
  return true;
}

// ======== 显示认证错误 ========
function showAuthError(form, msg) {
  const el = document.getElementById(form + '-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

// ======== 权限管理页：获取所有用户（含本地+Supabase） ========
async function getAllUsersForAdmin() {
  let users = [];

  if (SUPABASE_ENABLED) {
    try {
      users = await sbFetch('users?select=*&order=created_at.asc');
    } catch(e) {}
  }

  // 合并本地用户（去重）
  const localList = LocalUsers.getAll();
  localList.forEach(lu => {
    if (!users.find(u => u.id === lu.id)) users.push(lu);
  });

  return users;
}

// ======== 权限管理：获取所有权限 ========
async function getAllPermsForAdmin() {
  let serverPerms = [];
  if (SUPABASE_ENABLED) {
    try { serverPerms = await sbFetch('permissions?select=*'); } catch(e) {}
  }

  // 合并本地权限
  const localPermsData = LocalPerms.getAll();
  const result = [...serverPerms];
  Object.keys(localPermsData).forEach(userId => {
    localPermsData[userId].forEach(page => {
      if (!result.find(p => p.user_id === userId && p.page === page)) {
        result.push({ user_id: userId, page });
      }
    });
  });
  return result;
}

// ======== 管理员操作：切换用户权限 ========
async function togglePermission(userId, page, grant) {
  try {
    // 先写云端（如果有），再写本地
    if (SUPABASE_ENABLED) {
      if (grant) {
        // 纯写入（不再先删后插）：绝不删除已有数据，从根上杜绝“写入失败→权限被静默删除”
        try {
          await sbFetch('permissions', 'POST', { user_id: userId, page, granted_by: CURRENT_USER.id }, { Prefer: 'return=minimal' });
        } catch(e) {
          // 23505 = 唯一约束冲突，即该权限已存在（重复授权），视为成功，不报错
          if (e.message && e.message.indexOf('23505') >= 0) { /* 已存在，忽略 */ }
          else throw e;
        }
      } else {
        await sbFetch('permissions?user_id=eq.' + userId + '&page=eq.' + page, 'DELETE');
      }
    }
    // 同步本地缓存
    if (grant) { LocalPerms.grant(userId, page); }
    else { LocalPerms.revoke(userId, page); }

    var permName = PAGE_NAMES[page];
    if (!permName && page.indexOf('shop_view_') === 0) permName = '查看店铺 ' + page.replace('shop_view_', '');
    if (!permName && page.indexOf('shop_edit_') === 0) permName = '编辑店铺 ' + page.replace('shop_edit_', '');
    if (!permName) permName = page;
    _safeShowToast((grant ? '✅ 已开放' : '🔒 已收回') + ' 【' + permName + '】 权限（云端已同步）', grant ? 'success' : 'info');
  } catch(e) {
    _safeShowToast('⚠️ 权限操作失败：' + e.message, 'error');
  }
}

async function grantAllPerms(userId) {
  try {
    if (SUPABASE_ENABLED) {
      // 不再 DELETE 全部，避免误删店铺级权限；改为追加式 upsert，幂等且安全
      const pages = [...ALL_PAGES, ...ALL_ACTIONS];
      // 「开放全部权限」同时开放全部店铺的查看与编辑权限
      try {
        if (typeof DB !== 'undefined' && DB.getShops) {
          DB.getShops().forEach(function(s) { pages.push('shop_view_' + s.id); pages.push('shop_edit_' + s.id); });
        }
      } catch(e) {}
      for (const page of pages) {
        try {
          await sbFetch('permissions', 'POST', { user_id: userId, page, granted_by: CURRENT_USER.id }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
        } catch(e) { /* 单行失败不影响其余 */ }
      }
    }
    LocalPerms.grantAll(userId);
    _safeShowToast('✅ 已开放全部权限（云端已同步）', 'success');
  } catch(e) {
    _safeShowToast('⚠️ 操作失败：' + e.message, 'error');
  }
  await loadAdminUsers();
}

async function revokeAllPerms(userId) {
  try {
    if (SUPABASE_ENABLED) {
      await sbFetch('permissions?user_id=eq.' + userId, 'DELETE');
    }
    LocalPerms.revokeAll(userId);
    _safeShowToast('🔒 已收回全部权限（云端已同步）', 'info');
  } catch(e) {
    _safeShowToast('⚠️ 操作失败：' + e.message, 'error');
  }
  await loadAdminUsers();
}

async function toggleUserStatus(userId, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
  LocalUsers.update(userId, { status: newStatus });
  if (SUPABASE_ENABLED) {
    try { await sbFetch('users?id=eq.' + userId, 'PATCH', { status: newStatus }); } catch(e) {}
  }
  _safeShowToast(newStatus === 'active' ? '账号已启用' : '账号已禁用', 'info');
  await loadAdminUsers();
}

async function deleteUserAccount(userId) {
  if (!userId) return;
  if (!confirm('确定删除该账号？\n\n该账号创建的店铺将自动转交给超级管理员（A001），其权限会被清除，之后可以重新注册同名账号。')) return;

  // 防止删除自己
  const currentUser = CURRENT_USER || {};
  if (userId === currentUser.id) {
    _safeShowToast('不能删除当前登录的账号', 'error');
    return;
  }
  // 防止删除超级管理员
  if (userId === 'super_admin') {
    _safeShowToast('不能删除超级管理员账号', 'error');
    return;
  }

  try {
    // 1. 清理本地权限
    LocalPerms.revokeAll(userId);
    // 2. 从本地用户列表删除
    LocalUsers.remove(userId);
    // 3. 同步到 Supabase：先转店铺 → 再删用户
    if (SUPABASE_ENABLED) {
      // 3a. 把该用户创建的所有店铺转给超级管理员（兜底 trigger 也会做，但前端先做能立即生效）
      try {
        const transferred = await sbFetch(
          'shops?created_by=eq.' + encodeURIComponent(userId),
          'PATCH',
          { created_by: 'super_admin' }
        );
        if (transferred && Array.isArray(transferred) && transferred.length > 0) {
          console.log('[DeleteUser] 已把 ' + transferred.length + ' 个店铺转交给 super_admin');
        }
      } catch(e) {
        console.warn('[DeleteUser] 转移店铺失败（继续删用户）:', e.message);
      }
      // 3b. 删除用户
      try {
        await sbFetch('users?id=eq.' + userId, 'DELETE');
      } catch(e) {
        console.warn('[DeleteUser] Supabase delete failed:', e);
      }
    }
    _safeShowToast('✅ 账号已删除，店铺已转交 A001', 'success');
  } catch(e) {
    _safeShowToast('删除失败：' + e.message, 'error');
  }
  await loadAdminUsers();
}

// ======== 忘记密码：显示/隐藏重置表单 ========
function showForgotForm(show = true) {
  const formLogin    = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');
  const formForgot   = document.getElementById('form-forgot');

  if (show) {
    formLogin.style.opacity = '0';
    formLogin.style.pointerEvents = 'none';
    formLogin.style.position = 'absolute';
    formRegister.style.opacity = '0';
    formRegister.style.pointerEvents = 'none';
    formRegister.style.position = 'absolute';
    formForgot.style.opacity = '1';
    formForgot.style.pointerEvents = 'auto';
    formForgot.style.position = 'relative';
  } else {
    formLogin.style.opacity = '1';
    formLogin.style.pointerEvents = 'auto';
    formLogin.style.position = 'relative';
    formRegister.style.opacity = '0';
    formRegister.style.pointerEvents = 'none';
    formRegister.style.position = 'absolute';
    formForgot.style.opacity = '0';
    formForgot.style.pointerEvents = 'none';
    formForgot.style.position = 'absolute';
  }
  if (show) {
    document.getElementById('forgot-phone').value    = '';
    document.getElementById('forgot-newpass').value  = '';
    document.getElementById('forgot-newpass2').value = '';
    document.getElementById('forgot-error').style.display   = 'none';
    document.getElementById('forgot-success').style.display = 'none';
  } else {
    // 返回登录
    document.getElementById('tab-login').classList.add('active');
    document.getElementById('form-login').style.display = 'block';
    document.getElementById('form-forgot').style.display = 'none';
  }
}

// ======== 忘记密码：提交重置申请 ========
async function doSubmitResetRequest() {
  const phone    = document.getElementById('forgot-phone').value.trim();
  const newPass  = document.getElementById('forgot-newpass').value;
  const newPass2 = document.getElementById('forgot-newpass2').value;
  const btn      = document.getElementById('btn-forgot');
  const errEl    = document.getElementById('forgot-error');
  const okEl     = document.getElementById('forgot-success');

  errEl.style.display = 'none';
  okEl.style.display  = 'none';

  if (!phone)          { errEl.textContent = '请输入手机号'; errEl.style.display = 'block'; return; }
  if (!newPass)        { errEl.textContent = '请输入新密码'; errEl.style.display = 'block'; return; }
  if (newPass.length < 6) { errEl.textContent = '密码至少6位'; errEl.style.display = 'block'; return; }
  if (newPass !== newPass2) { errEl.textContent = '两次密码不一致'; errEl.style.display = 'block'; return; }

  btn.disabled = true;
  document.getElementById('forgot-btn-text').textContent = '提交中...';

  try {
    // 查找用户是否存在
    let user = null;
    if (SUPABASE_ENABLED) {
      try {
        const users = await sbFetch('users?phone=eq.' + encodeURIComponent(phone) + '&select=id,phone,nickname');
        if (users && users.length > 0) user = users[0];
      } catch(e) {}
    }
    if (!user) user = LocalUsers.find(phone);

    if (!user) {
      errEl.textContent = '该手机号未注册，请先注册账号';
      errEl.style.display = 'block';
      return;
    }

    // 将重置申请记录到 Supabase（password_reset_requests 表）
    // 为了不增加额外表，复用 shop_access_requests 机制：
    // 用一个特殊 key 存到 localStorage + Supabase（shop_access_requests reason 字段存密码哈希）
    const reqId = 'pwd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const newHash = hashPassword(newPass);
    const req = {
      id: reqId,
      shopId: '__pwd_reset__',
      shopName: '密码重置申请',
      applicantId: user.id,
      applicantName: user.nickname || user.phone,
      reason: newHash,   // 存密码哈希，管理员批准后直接用
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    // 写本地
    const requests = JSON.parse(localStorage.getItem('shop_access_requests') || '[]');
    requests.push(req);
    localStorage.setItem('shop_access_requests', JSON.stringify(requests));
    // 推送云端
    if (typeof sbPushAccessRequest === 'function') sbPushAccessRequest(req);

    okEl.textContent = '申请已提交！请联系管理员审核，审核通过后即可使用新密码登录。';
    okEl.style.display = 'block';
    document.getElementById('btn-forgot').style.display = 'none';
  } catch(e) {
    errEl.textContent = '提交失败：' + e.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    document.getElementById('forgot-btn-text').textContent = '提交申请';
  }
}

// ======== 管理员：批准密码重置申请 ========
async function approvePasswordReset(reqId, applicantId, newPasswordHash) {
  try {
    // 直接更新用户密码
    if (SUPABASE_ENABLED) {
      await sbFetch('users?id=eq.' + encodeURIComponent(applicantId), 'PATCH', { password_hash: newPasswordHash });
    }
    LocalUsers.update(applicantId, { password_hash: newPasswordHash });

    // 更新申请状态
    const requests = JSON.parse(localStorage.getItem('shop_access_requests') || '[]');
    const req = requests.find(r => r.id === reqId);
    if (req) {
      req.status = 'approved';
      localStorage.setItem('shop_access_requests', JSON.stringify(requests));
    }
    if (typeof sbUpdateAccessRequestStatus === 'function') sbUpdateAccessRequestStatus(reqId, 'approved');

    _safeShowToast('✅ 密码已重置，用户可使用新密码登录', 'success');
    renderAdmin();
  } catch(e) {
    _safeShowToast('⚠️ 操作失败：' + e.message, 'error');
  }
}

// ======== 管理员：拒绝密码重置申请 ========
async function rejectPasswordReset(reqId) {
  const requests = JSON.parse(localStorage.getItem('shop_access_requests') || '[]');
  const req = requests.find(r => r.id === reqId);
  if (req) {
    req.status = 'rejected';
    localStorage.setItem('shop_access_requests', JSON.stringify(requests));
  }
  if (typeof sbUpdateAccessRequestStatus === 'function') sbUpdateAccessRequestStatus(reqId, 'rejected');
  _safeShowToast('已拒绝密码重置申请', 'info');
  renderAdmin();
}

// ======== 覆盖 switchAuthTab，隐藏 forgot 表单 ========
const _origSwitchAuthTab = switchAuthTab;
switchAuthTab = function(tab) {
  document.getElementById('form-forgot').style.display = 'none';
  _origSwitchAuthTab(tab);
};

// ======== 页面初始化入口 ========
window.onload = function() {
  initAuth();
};
