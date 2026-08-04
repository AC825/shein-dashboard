/**
 * review-import-sync-v1.js — 差评率批量导入云端确认补丁
 * V175:
 * 1) 同日期优先复用已有记录 id，避免重复导入产生多条同日记录；
 * 2) 本地保存后显式等待 Supabase 批量写入确认；
 * 3) 云端失败时由 local-first 队列接管，并明确提示“待同步”，不再误报成功。
 */
(function () {
  'use strict';

  var installed = false;

  function ready() {
    return typeof window.sbFetch === 'function' &&
      typeof window._lfQueue === 'function' &&
      typeof CBReviewDB !== 'undefined' &&
      CBReviewDB && typeof CBReviewDB.batchUpsert === 'function';
  }

  function install() {
    if (installed) return;
    if (!ready()) {
      setTimeout(install, 200);
      return;
    }
    installed = true;

    window.importCBReviews = async function (shopId) {
      if (window._reviewImportBusy) {
        if (typeof showToast === 'function') showToast('正在保存，请稍候…', 'info');
        return;
      }

      var ta = document.getElementById('cb-review-import-text-' + shopId);
      var raw = ta ? ta.value.trim() : '';
      if (!raw) {
        if (typeof showToast === 'function') showToast('请粘贴或上传数据', 'error');
        return;
      }

      var lines = raw.split('\n').map(function (line) {
        return line.trim();
      }).filter(function (line) {
        return line && !/^(日期|时间段|date|time)/i.test(line);
      });

      var normalizeDate = function (value) {
        if (!value) return null;
        var match = String(value).trim().replace(/[\sT].+$/, '').match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
        if (!match) return null;
        return match[1] + '-' + String(match[2]).padStart(2, '0') + '-' + String(match[3]).padStart(2, '0');
      };

      var existing = CBReviewDB.getAll(shopId) || [];
      var existingByDate = {};
      existing.forEach(function (row) {
        if (row && row.date && !existingByDate[row.date]) existingByDate[row.date] = row;
      });

      var errors = 0;
      var rowsByDate = {};
      var now = Date.now();
      lines.forEach(function (line, index) {
        var cols = line.split(/[,\t，]/).map(function (cell) { return cell.trim(); });
        var date = normalizeDate(cols[0]);
        var rate = parseFloat(cols[1]);
        if (!date || isNaN(rate) || rate <= 0 || rate > 100) {
          errors++;
          return;
        }

        var old = existingByDate[date];
        rowsByDate[date] = {
          id: old && old.id ? old.id : ('rv_' + now + '_' + index),
          date: date,
          total_reviews: 100,
          negative_reviews: Math.round(rate),
          negative_rate: parseFloat(rate.toFixed(4)),
          remark: cols[2] || '',
          created_at: old && old.created_at ? old.created_at : new Date().toISOString()
        };
      });

      var newRows = Object.keys(rowsByDate).map(function (date) { return rowsByDate[date]; });
      if (newRows.length === 0) {
        if (typeof showToast === 'function') {
          showToast('未解析到有效数据，请检查格式：日期,整体差评率(%)', 'error');
        }
        return;
      }

      window._reviewImportBusy = true;
      try {
        // 先落本地，任何网络状态下刷新都不会丢。
        CBReviewDB.batchUpsert(shopId, newRows);
        window['_cbTab_' + shopId] = 'reviews';
        if (typeof renderReviewTable === 'function') renderReviewTable(shopId);
        if (typeof closeModal === 'function') closeModal('modal-cb-review-import-' + shopId);

        // 再显式等待云端确认。CBReviewDB 内部也会后台推送一次；相同 id 的 upsert 是幂等的。
        var cloudRows = newRows.map(function (row) {
          var copy = {};
          Object.keys(row).forEach(function (key) { copy[key] = row[key]; });
          copy.shop_id = shopId;
          return copy;
        });
        await window.sbFetch('cb_reviews', 'POST', cloudRows, {
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        });

        var suffix = errors > 0 ? '（' + errors + ' 条格式错误已跳过）' : '';
        if (typeof showToast === 'function') {
          showToast('已保存并同步云端 ' + newRows.length + ' 条差评率数据' + suffix, 'success');
        }
        console.log('[ReviewImport V175] 云端确认成功，rows=' + newRows.length);
      } catch (error) {
        var pending = 0;
        try { pending = window._lfQueue().length; } catch (ignore) {}
        if (typeof showToast === 'function') {
          if (pending > 0) {
            showToast('已保存在本机，' + pending + ' 条正在后台同步；请勿清理浏览器数据', 'info');
          } else {
            showToast('本地已保存，但云端上传失败：' + (error && error.message ? error.message : '未知错误'), 'error');
          }
        }
        console.error('[ReviewImport V175] 云端确认失败，pending=' + pending, error);
      } finally {
        window._reviewImportBusy = false;
      }
    };

    console.log('[ReviewImport V175] 已启用：本地先保存 + 云端确认 + 失败入队');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      // 原内联覆写同样在 DOMContentLoaded 执行；延后一拍确保 V175 最后接管。
      setTimeout(install, 100);
    });
  } else {
    setTimeout(install, 100);
  }
})();
