/**
 * cb-table-paginate-v1.js (V204)
 * 修复跨店切换慢：退款/差评/SKU 表格最多渲染 200 行
 *
 * 诊断结论：
 *   原有代码已对订单(orders)做分页(100条/页)，但退款(refunds, 3223行)、差评(reviews, 423行)、
 *   款式评价(sku, 370行) 是"全量渲染"-> 每切店 push 数千行DOM -> 浏览器解析 1.3~5.5MB HTML
 *   耗时 20~35 秒。
 *
 * 修���(外部补丁，不改 minified 主代码)：
 *   1) 包裹 _getFilteredRefunds => 退款表只取前 200 行，统计标签显示真实总数
 *   2) 包裹 renderReviewTable => 差评表只取前 200 行
 *   3) 包裹 renderCrossBorderDetail => skur-tbody 只保留前 200 行
 *   4) 切店后强制重注入 3 分析按钮 + 店铺任务按钮（修复按钮消失 bug）
 */
(function () {
  'use strict';
  if (window.__cbTablePaginateLoaded) return;
  window.__cbTablePaginateLoaded = true;
  const MAX_ROWS = 200;

  function waitForApp(cb) {
    if (typeof window.renderCrossBorderDetail === 'function' &&
        typeof window.renderRefundTable === 'function' &&
        typeof window.renderReviewTable === 'function') {
      cb();
    } else {
      setTimeout(function () { waitForApp(cb); }, 200);
    }
  }

  waitForApp(function () {

    // ==================== 0) V204 遗留修复：「显示全部」按钮函数从未定义 ====================
    // cb-table-paginate-v1.js 注入了 onclick="window.__v204_showAllSku('shopId')" 按钮，但函数一直未实现，
    // 导致点击「显示全部」无反应。这里补上：从 CBSkuReviewDB 全量重新生成 sku 评价 tbody 行。
    window.__v204_renderSkuRows = function (shopId) {
      try {
        var skuReviews = (window.CBSkuReviewDB && CBSkuReviewDB.getAll) ? CBSkuReviewDB.getAll(shopId) : [];
        var sorted = skuReviews.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
        var statusBg = function (s) { s = s || '待处理'; return s === '已解决' ? 'rgba(52,211,153,0.12)' : s === '已回复' ? 'rgba(96,165,250,0.12)' : 'rgba(248,113,113,0.12)'; };
        var statusColor = function (s) { s = s || '待处理'; return s === '已解决' ? '#34d399' : s === '已回复' ? '#60a5fa' : '#f87171'; };
        var ratingStars = function (n) { n = n || 0; return '★'.repeat(n) + '☆'.repeat(5 - n); };
        if (sorted.length === 0) return '';
        return sorted.map(function (r, idx) {
          var zebra = idx % 2 === 1 ? 'background:rgba(255,255,255,0.015)' : '';
          return '<tr class="skur-row" data-sku="' + (r.sku || '').toLowerCase() + '" data-content="' + (r.negative_content || '').toLowerCase() + '" data-status="' + (r.status || '') + '" ' +
            'style="border-bottom:1px solid #1e293b;' + zebra + '">' +
            '<td style="padding:8px 10px;color:#e2e8f0;white-space:nowrap;font-weight:600">' + (r.date || '-') + '</td>' +
            '<td style="padding:8px 10px;font-family:monospace;color:#a78bfa;white-space:nowrap">' + (r.sku || '-') + '</td>' +
            '<td style="padding:8px 10px;color:#e2e8f0;max-width:240px"><div style="line-height:1.5;word-break:break-all">' + (r.negative_content || '-') + '</div>' +
              (r.reviewer ? '<div style="font-size:10px;color:#475569;margin-top:2px">买家：' + r.reviewer + '</div>' : '') + '</td>' +
            '<td style="padding:8px 10px;text-align:center;color:#fbbf24;font-size:13px;white-space:nowrap" title="' + (r.rating ? r.rating + '星' : '') + '">' + (r.rating ? ratingStars(r.rating) : '-') + '</td>' +
            '<td style="padding:8px 10px;text-align:center"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:' + statusBg(r.status) + ';color:' + statusColor(r.status) + '">' + (r.status || '待处理') + '</span></td>' +
            '<td style="padding:8px 10px;color:#64748b;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (r.remark || '') + '">' + (r.remark || '-') + '</td>' +
            '<td style="padding:8px 10px;text-align:center;white-space:nowrap">' +
              '<button class="btn-secondary btn-sm" onclick="openEditSkuReviewModal(\'' + shopId + '\',\'' + r.id + '\')" style="margin-right:4px">编辑</button>' +
              '<button style="padding:3px 8px;border-radius:5px;border:1px solid rgba(248,113,113,0.3);background:rgba(248,113,113,0.08);color:#f87171;font-size:11px;cursor:pointer" onclick="removeSkuReview(\'' + shopId + '\',\'' + r.id + '\')">删</button>' +
            '</td>' +
          '</tr>';
        }).join('');
      } catch (e) { return ''; }
    };

    window.__v204_showAllSku = function (shopId) {
      try {
        var tbody = document.getElementById('skur-tbody-' + shopId);
        if (!tbody) { console.warn('[V204] skur-tbody 未找到:', shopId); return; }
        tbody.innerHTML = window.__v204_renderSkuRows(shopId);
        var cnt = document.getElementById('skur-count-' + shopId);
        if (cnt) {
          var total = (window.CBSkuReviewDB && CBSkuReviewDB.getAll) ? CBSkuReviewDB.getAll(shopId).length : 0;
          cnt.textContent = total + ' 条（已展开全部）';
        }
        console.log('[V204] 已展开全部款式评价: ' + ((window.CBSkuReviewDB && CBSkuReviewDB.getAll) ? CBSkuReviewDB.getAll(shopId).length : 0) + ' 条');
      } catch (e) { console.warn('[V204] 显示全部失败:', e); }
    };

    // ==================== 1) 退款表：包裹 _getFilteredRefunds ====================
    var _origGetFilteredRefunds = window._getFilteredRefunds;
    if (typeof _origGetFilteredRefunds === 'function') {
      window._getFilteredRefunds = function (e) {
        var full = _origGetFilteredRefunds(e);
        window.__v204_refundTotal = full.length;
        window.__v204_refundOrig = window.__v204_refundOrig || {};
        window.__v204_refundOrig[e] = full;
        return full.slice(0, MAX_ROWS);
      };
      window.__v204_refundTotal = 0;
      window.__v204_refundOrig = {};
    }

    // ==================== 2) 差评表：包裹 _getFilteredReviews ====================
    var _origGetFilteredReviews = window._getFilteredReviews;
    if (typeof _origGetFilteredReviews === 'function') {
      window._getFilteredReviews = function (e) {
        var full = _origGetFilteredReviews(e);
        window.__v204_reviewTotal = full.length;
        window.__v204_reviewOrig = window.__v204_reviewOrig || {};
        window.__v204_reviewOrig[e] = full;
        return full.slice(0, MAX_ROWS);
      };
      window.__v204_reviewTotal = 0;
      window.__v204_reviewOrig = {};
    }

    // ==================== 3) SKU 表：包裹 renderCrossBorderDetail ====================
    var _origRCBD = window.renderCrossBorderDetail;
    if (typeof _origRCBD === 'function') {
      window.renderCrossBorderDetail = function (shopOrId) {
        var html = _origRCBD.apply(this, arguments);
        if (!html) return html;

        var shopId = (typeof shopOrId === 'object' && shopOrId) ? shopOrId.id : shopOrId;
        if (!shopId) return html;

        // 截断 skur-tbody：只保留前 MAX_ROWS 行
        var tbodyMark = 'id="skur-tbody-' + shopId + '"';
        var tbodyStart = html.indexOf(tbodyMark);
        if (tbodyStart >= 0) {
          var tbodyTagStart = html.lastIndexOf('<tbody', tbodyStart);
          if (tbodyTagStart >= 0) {
            var tbodyEnd = html.indexOf('</tbody>', tbodyTagStart);
            if (tbodyEnd >= 0) {
              var before = html.slice(0, tbodyTagStart);
              var tbodyContent = html.slice(tbodyTagStart, tbodyEnd + 8);
              var after = html.slice(tbodyEnd + 8);

              var trCount = (tbodyContent.match(/<tr[ >]/g) || []).length;
              if (trCount > MAX_ROWS) {
                var trIdx = 0, pos = -1;
                var m;
                while ((m = /<tr[ >]/g.exec(tbodyContent)) !== null) {
                  trIdx++;
                  if (trIdx === MAX_ROWS + 1) {
                    pos = m.index;
                    break;
                  }
                }
                if (pos > 0) {
                  var truncated = tbodyContent.slice(0, pos);
                  truncated +=
                    '<tr style="background:#1e293b">' +
                      '<td colspan="100" style="text-align:center;padding:12px;color:#94a3b8;font-size:13px">' +
                        '显示前 ' + MAX_ROWS + ' 条 / 共 ' + trCount + ' 条' +
                        ' <button onclick="window.__v204_showAllSku(\'' + shopId + '\')" ' +
                          'style="margin-left:10px;padding:4px 14px;border-radius:6px;border:1px solid rgba(124,58,237,0.4);background:rgba(124,58,237,0.12);color:#a78bfa;font-size:12px;cursor:pointer">显示全部</button>' +
                      '</td>' +
                    '</tr>';
                  html = before + truncated + after;
                }
              }
            }
          }
        }
        return html;
      };
    }

    // ==================== 4) 修复表统计标签 & [加载全部] 按钮 ====================
    var _origRenderRefundTable = window.renderRefundTable;
    if (typeof _origRenderRefundTable === 'function') {
      window.renderRefundTable = function (e) {
        if (window.__v204_refundTotal === undefined) {
          if (typeof window._getFilteredRefunds === 'function') {
            window.__v204_refundTotal = window._getFilteredRefunds(e).length;
          }
        }
        _origRenderRefundTable(e);
        var area = document.getElementById('refund-table-area-' + e);
        if (area && window.__v204_refundTotal !== undefined) {
          var realTotal = window.__v204_refundTotal;
          var newHtml = area.innerHTML.replace(/(共\s*)(\d+)(\s*条)/, function (match, prefix, num, suffix) {
            var shown = parseInt(num);
            if (realTotal > shown) {
              return prefix + realTotal + suffix + '（显示前 ' + shown + '）';
            }
            return match;
          });
          if (newHtml !== area.innerHTML) area.innerHTML = newHtml;
        }
      };
    }

    var _origRenderReviewTable = window.renderReviewTable;
    if (typeof _origRenderReviewTable === 'function') {
      window.renderReviewTable = function (e) {
        if (window.__v204_reviewTotal === undefined) {
          if (typeof window._getFilteredReviews === 'function') {
            window.__v204_reviewTotal = window._getFilteredReviews(e).length;
          }
        }
        _origRenderReviewTable(e);
        var area = document.getElementById('review-table-area-' + e);
        if (area && window.__v204_reviewTotal !== undefined) {
          var realTotal = window.__v204_reviewTotal;
          var newHtml = area.innerHTML.replace(/(共\s*)(\d+)(\s*条)/, function (match, prefix, num, suffix) {
            var shown = parseInt(num);
            if (realTotal > shown) {
              return prefix + realTotal + suffix + '（显示前 ' + shown + '）';
            }
            return match;
          });
          if (newHtml !== area.innerHTML) area.innerHTML = newHtml;
        }
      };
    }

    // ==================== 5) 修���按钮消失 bug：重注入增强 ====================
    var _origNavigate = window.navigate;
    if (typeof _origNavigate === 'function') {
      window.navigate = function (page, param) {
        _origNavigate.apply(this, arguments);
        if (page === 'shop-detail' && param) {
          var sid = (typeof param === 'object' && param) ? param.id : param;
          var doInject = function (shopId) {
            try {
              if (window.scanShopsForV182) window.scanShopsForV182();
              if (window._v191_injectTaskTab) window._v191_injectTaskTab(shopId);
              if (window.__v193_injectShopTabs) window.__v193_injectShopTabs(shopId);
            } catch (e) {}
          };
          setTimeout(function () { doInject(sid); }, 50);
          setTimeout(function () { doInject(sid); }, 200);
          setTimeout(function () { doInject(sid); }, 600);
        }
      };
    }

    window.__v204_origGetFilteredRefunds = _origGetFilteredRefunds;
    window.__v204_origGetFilteredReviews = _origGetFilteredReviews;

    console.log('[V204] 表格分页已启用：退款/差评/SKU 最大 ' + MAX_ROWS + ' 行 + 按钮注入增强');
  });
})();
