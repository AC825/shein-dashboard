/* ==========================================================================
 * cb-order-import-fix-v1.js  (V176)
 * 修复「批量导入订单」上传文件后长时间无反应的问题
 *
 * 原因: readFileAsCSVText 用 SheetJS 默认配置解析 xlsx,会读取每个单元格的
 *       cellStyles / cellHTML / cellNF / cellText,对几万行 xlsx 极慢(30-60s),
 *       且无进度提示,用户以为卡死。
 *
 * 优化:
 *   1) SheetJS.read 选项关闭无关读取 (cellStyles:false 等)  → 提速 3-5 倍
 *   2) sheet_to_csv 用 raw:true + defval:''               → 再提速 3-5 倍
 *   3) 上传后立即 toast "正在解析 xxx...",让用户看到状态     → 体验修复
 *   4) CSV/TXT 路径去掉 UTF-8 BOM 头                        → 兼容性
 *
 * 入口: monkey-patch handleCBOFileSelect / handleCBOFileDrop (function decl)
 * ========================================================================== */
(function(){
  'use strict';

  // ---------- 1. 等主程序加载完 (modal-cb-order-import-* DOM 存在即就绪) ----------
  function waitForApp(cb){
    if (typeof document !== 'undefined' &&
        document.getElementById('modal-cb-order-import-shop_001')) {
      return cb();
    }
    setTimeout(function(){ waitForApp(cb); }, 80);
  }

  // ---------- 2. 工具函数 ----------
  function showInfo(msg){
    if (typeof window.showToast === 'function') window.showToast(msg, 'info', 30000);
  }
  function showOK(msg){
    if (typeof window.showToast === 'function') window.showToast(msg, 'success', 4000);
  }
  function showErr(msg){
    if (typeof window.showToast === 'function') window.showToast(msg, 'error', 6000);
  }
  function stripBOM(s){
    return (s && s.charCodeAt(0) === 0xFEFF) ? s.slice(1) : s;
  }

  // ---------- 3. 优化版 readFileAsCSVText ----------
  function optimizedReadFile(file){
    var name = file.name || '';
    var lower = name.toLowerCase();
    var isExcel = /\.(xlsx|xls|ods|xlsm)$/i.test(lower);

    if (!isExcel) {
      // CSV / TXT: 异步读文本,自动去 BOM
      return file.text().then(stripBOM);
    }

    // Excel: 需要 XLSX 库
    if (typeof XLSX === 'undefined') {
      return Promise.reject(new Error('Excel 解析库未加载,请刷新页面重试'));
    }

    // 进度提示 (30s 长 toast,避免期间被新 toast 挤掉)
    showInfo('📊 正在解析 "' + name + '" ...');

    return file.arrayBuffer().then(function(buf){
      // 优化 1: 关闭样式/HTML/数字格式/公式文本读取 (巨大提速)
      var wb = XLSX.read(buf, {
        type: 'array',
        cellStyles:  false,   // 不读样式
        cellHTML:    false,   // 不读 HTML
        cellNF:      false,   // 不读数字格式
        cellText:    false,   // 不读公式文本
        cellDates:   false    // 日期当字符串处理(用户后续解析)
      });

      var sheetName = wb.SheetNames[0];
      var sheet = wb.Sheets[sheetName];
      if (!sheet) throw new Error('Excel 中没有工作表');

      // 优化 2: raw:true 直接拿单元格原始值,不做格式化转换
      //         blankrows:false 自动跳过全空行
      //         defval:'' 把空单元格补空串(避免 undefined)
      var csv = XLSX.utils.sheet_to_csv(sheet, {
        blankrows: false,
        raw:       true,
        defval:    ''
      });

      return csv;
    });
  }

  // ---------- 4. 处理结果 ----------
  function applyResult(file, shopId, text){
    var ta = document.getElementById('cb-order-import-text-' + shopId);
    if (ta) ta.value = text;

    // 统计有效行 (排除空行)
    var lines = text.split(/\r?\n/).filter(function(l){ return l.trim().length > 0; }).length;
    showOK('✅ 已读取 "' + file.name + '" (' + lines + ' 行),点 "导入" 开始处理');
  }

  // ---------- 5. monkey-patch handleCBOFileSelect (input[type=file] 选文件) ----------
  //  原函数: function handleCBOFileSelect(e,t){const n=e.files[0];n&&readCBOFile(n,t),e.value=""}
  function newHandleCBOFileSelect(input, shopId){
    var file = input.files && input.files[0];
    input.value = '';   // 清空 input,允许重复选同一文件
    if (!file) return;

    optimizedReadFile(file)
      .then(function(text){ applyResult(file, shopId, text); })
      .catch(function(err){ showErr('文件读取失败:' + (err && err.message || err)); });
  }

  // ---------- 6. monkey-patch handleCBOFileDrop (拖拽文件) ----------
  //  原函数: function handleCBOFileDrop(e,t){e.preventDefault();const n=document.getElementById("cbo-file-drop-"+t);n&&(n.style.borderColor="#334155");const o=e.dataTransfer.files[0];o&&readCBOFile(o,t)}
  function newHandleCBOFileDrop(evt, shopId){
    evt.preventDefault();
    var drop = document.getElementById('cbo-file-drop-' + shopId);
    if (drop) drop.style.borderColor = '#334155';

    var file = evt.dataTransfer && evt.dataTransfer.files && evt.dataTransfer.files[0];
    if (!file) return;

    optimizedReadFile(file)
      .then(function(text){ applyResult(file, shopId, text); })
      .catch(function(err){ showErr('文件读取失败:' + (err && err.message || err)); });
  }

  // ---------- 7. 挂载 ----------
  waitForApp(function(){
    // 备份 + 替换 (必须挂到 window,onchange="handleCBOFileSelect(this,...)" 才能找到)
    window._origHandleCBOFileSelect = window.handleCBOFileSelect;
    window._origHandleCBOFileDrop   = window.handleCBOFileDrop;
    window.handleCBOFileSelect = newHandleCBOFileSelect;
    window.handleCBOFileDrop   = newHandleCBOFileDrop;

    console.log('[cb-order-import-fix-v1] 已挂载 | V176 | 优化:SheetJS 关闭样式读取 + raw:true + 进度提示');
  });

})();