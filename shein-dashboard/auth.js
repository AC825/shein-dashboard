// ============================================================
//  认证模块 auth.js
//  超级账号：001 / 密码：123（本地硬编码，始终可用）
//  普通用户：手机号 + 密码，注册后需超级账号授权
// ============================================================

// ======== 超级账号配置 ========
const SUPER_ACCOUNT = {
  id: 'super_admin',
  phone: '001',
  account: '001',
  password: '123',
  nickname: '超级管理员',
  role: 'admin',
  status: 'active',
  permissions: [],  // admin 不需要权限列表，自动全开
};

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
    this.set(userId, [...ALL_PAGES]);
  }
};

// ======== 初始化认证 ========
async function initAuth() {
  initParticles();

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
        CURRENT_USER = user;
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
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('form-login').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('form-register').style.display = tab === 'register' ? 'block' : 'none';
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('reg-error').style.display = 'none';
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
      localStorage.setItem('shein_session', JSON.stringify({ id: 'super_admin', phone: '001' }));
      showToast('欢迎，超级管理员！', 'success');
      startApp();
      return;
    }

    // ===== 普通用户登录 =====
    let user = null;

    // 先查本地
    user = LocalUsers.find(account);

    // 再查 Supabase
    if (!user && SUPABASE_ENABLED) {
      try {
        const users = await sbFetch('users?phone=eq.' + encodeURIComponent(account) + '&select=*');
        if (users && users.length > 0) user = users[0];
      } catch(e) {}
    }

    if (!user) {
      showAuthError('login', '账号未注册，请先注册');
      return;
    }

    // 验证密码
    const ph = hashPassword(pass);
    if (user.password_hash !== ph) {
      showAuthError('login', '密码错误，请重新输入');
      return;
    }

    if (user.status === 'disabled') {
      showAuthError('login', '账号已被禁用，请联系管理员');
      return;
    }

    // 加载权限
    CURRENT_USER = user;
    CURRENT_USER.permissions = await loadUserPermissions(user.id);

    // 检查是否有任何权限（刚注册未授权）
    if (CURRENT_USER.permissions.length === 0 && CURRENT_USER.role !== 'admin') {
      // 仍然允许登录，但提示
      showToast('登录成功！部分页面需要管理员授权才能访问', 'info');
    } else {
      showToast('欢迎回来，' + (user.nickname || user.phone), 'success');
    }

    localStorage.setItem('shein_session', JSON.stringify({ phone: user.phone, id: user.id }));

    // 更新最后登录时间
    if (SUPABASE_ENABLED) {
      try { await sbFetch('users?id=eq.' + user.id, 'PATCH', { last_login: new Date().toISOString() }); } catch(e) {}
    }
    LocalUsers.update(user.id, { last_login: new Date().toISOString() });

    startApp();
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

  // 不允许用001注册
  if (phone === '001') { showAuthError('reg', '该账号不可注册'); return; }

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

    showToast('注册成功！请等待管理员授权页面访问权限', 'success');
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
  const perms = CURRENT_USER.permissions || [];
  const isAdmin = CURRENT_USER.role === 'admin';

  if (isAdmin) {
    // 管理员全部可见可点
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.style.opacity = '';
      el.style.pointerEvents = '';
      el.title = '';
    });
    return;
  }

  // 普通成员：无权限页面灰显
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    const page = el.dataset.page;
    if (!page) return;
    if (!perms.includes(page)) {
      el.style.opacity = '0.35';
      el.style.pointerEvents = 'none';
      el.title = '暂无权限，请联系管理员授权';
    } else {
      el.style.opacity = '';
      el.style.pointerEvents = '';
      el.title = '';
    }
  });
}

// ======== 检查页面访问权限 ========
function checkPagePermission(page) {
  if (!CURRENT_USER) return false;
  if (CURRENT_USER.role === 'admin') return true;
  return (CURRENT_USER.permissions || []).includes(page);
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
        // 先删后插，防止重复
        try { await sbFetch('permissions?user_id=eq.' + userId + '&page=eq.' + page, 'DELETE'); } catch(e) {}
        await sbFetch('permissions', 'POST', { user_id: userId, page, granted_by: CURRENT_USER.id });
      } else {
        await sbFetch('permissions?user_id=eq.' + userId + '&page=eq.' + page, 'DELETE');
      }
    }
    // 同步本地缓存
    if (grant) { LocalPerms.grant(userId, page); }
    else { LocalPerms.revoke(userId, page); }

    showToast((grant ? '✅ 已开放' : '🔒 已收回') + ' 【' + PAGE_NAMES[page] + '】 权限（云端已同步）', grant ? 'success' : 'info');
  } catch(e) {
    showToast('⚠️ 权限操作失败：' + e.message, 'error');
  }
}

async function grantAllPerms(userId) {
  try {
    // 先清空再全量写入，避免重复
    if (SUPABASE_ENABLED) {
      try { await sbFetch('permissions?user_id=eq.' + userId, 'DELETE'); } catch(e) {}
      for (const page of ALL_PAGES) {
        await sbFetch('permissions', 'POST', { user_id: userId, page, granted_by: CURRENT_USER.id });
      }
    }
    LocalPerms.grantAll(userId);
    showToast('✅ 已开放全部权限（云端已同步）', 'success');
  } catch(e) {
    showToast('⚠️ 操作失败：' + e.message, 'error');
  }
  await loadAdminUsers();
}

async function revokeAllPerms(userId) {
  try {
    if (SUPABASE_ENABLED) {
      await sbFetch('permissions?user_id=eq.' + userId, 'DELETE');
    }
    LocalPerms.revokeAll(userId);
    showToast('🔒 已收回全部权限（云端已同步）', 'info');
  } catch(e) {
    showToast('⚠️ 操作失败：' + e.message, 'error');
  }
  await loadAdminUsers();
}

async function toggleUserStatus(userId, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
  LocalUsers.update(userId, { status: newStatus });
  if (SUPABASE_ENABLED) {
    try { await sbFetch('users?id=eq.' + userId, 'PATCH', { status: newStatus }); } catch(e) {}
  }
  showToast(newStatus === 'active' ? '账号已启用' : '账号已禁用', 'info');
  await loadAdminUsers();
}

// ======== 页面初始化入口 ========
window.onload = function() {
  initAuth();
};
