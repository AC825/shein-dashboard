/**
 * 订单导入修复 v1
 * 修复 SHEIN 导出格式检测：合并表头行有 4-5 个唯一分类名时也能正确识别
 * 加载顺序：必须在 app-v3-v3.js 之后（覆盖 detectImportFormat）
 */
(function() {
  'use strict';

  // 保存原始函数（如果有需要）
  var origDetectImportFormat = typeof detectImportFormat === 'function' ? detectImportFormat : null;

  /**
   * 改进版 detectImportFormat
   * 修复：合并表头行唯一值从 ≤3 改为 ≤6，兼容 "订单基础信息 + 非订单收入内税费 + 省份 + 城市" 格式
   */
  window.detectImportFormat = function(e) {
    // 如果没有数据，返回原始结果
    if (!e || e.length === 0) {
      return origDetectImportFormat ? origDetectImportFormat(e) : { type: 'standard', dataLines: e || [], headerMap: null };
    }

    var t = e.map(function(line) { return parseCSVLineProper(line); });
    var n = t[0] || [];
    var secondRow = t[1] || [];  // 提前声明，避免后续 if 块访问未定义

    // ===== 改进的 SHEIN 格式检测 =====
    // 当第一行列数 ≥ 30 且唯一值 ≤ 15 时，可能是合并表头行（兼容用户数据：首行有 8+ 个唯一分类名）
    if (n.length >= 30) {
      var uniqueVals = new Set(n.filter(function(v) { return v; }));
      var uniqueCount = uniqueVals.size;

      if (uniqueCount <= 15) {
        // 检查第二行是否包含 SHEIN 表头关键字
        var hasSheinKeywords = secondRow.some(function(v) {
          return /卖家SKU|SHEIN\.SKU|SKC|预计商品收入|订单创建时间|商品供货价|履约服务费|换货标识|库存标识/i.test(v);
        });
        var hasSkuOrProduct = secondRow.some(function(v) {
          return /货号|商品名称/i.test(v);
        });

        if (hasSheinKeywords || hasSkuOrProduct) {
          // 构建列映射：卖家SKU 优先作为主 SKU，货号作为 seller_sku 备用
          var headerMap = {};
          secondRow.forEach(function(val, idx) {
            var v = String(val);
            if (/卖家SKU/i.test(v)) headerMap.sku = idx;
            else if (/货号/.test(v)) headerMap.seller_sku = idx;
            else if (/订单创建时间|创建时间/.test(v)) headerMap.date = idx;
            else if (/预计商品收入|商品收入/.test(v)) headerMap.sale_amount = idx;
            else if (/商品名称|商品名/.test(v)) headerMap.product_name = idx;
            else if (/规格/.test(v)) headerMap.spec = idx;
            else if (/商品供货价|供货价/.test(v)) headerMap.cost = idx;
            else if (/商品价格/.test(v)) headerMap.price = idx;
          });

          // 必须找到日期和货号
          if (headerMap.date !== undefined && headerMap.sku !== undefined) {
            console.log('[fix-import] SHEIN 格式已识别，首行唯一值:', uniqueCount, uniqueVals);
            return {
              type: 'shein',
              dataLines: e.slice(2),  // 跳过前两行（合并表头 + 列名）
              headerMap: headerMap,
              totalCols: n.length
            };
          }
        }
      }

      // ===== 额外检测：标准表头在第二行但第一行有固定分类名 =====
      // 如果第二行包含日期和SKU关键字，但第一行不是标准表头
      if (uniqueCount <= 10 && n.length >= 20) {
        var hasDateAndSku = secondRow.some(function(v) { return /日期|date|创建时间|下单时间/i.test(v); }) &&
                           secondRow.some(function(v) { return /货号|SKU|商品编号/i.test(v); });

        if (hasDateAndSku) {
          // 构建列映射：卖家SKU 优先，货号/商品编号作为备用
          var stdHeaderMap = {};
          secondRow.forEach(function(val, idx) {
            var v = String(val);
            if (/日期|date|创建时间|下单时间/i.test(v)) stdHeaderMap.date = idx;
            else if (/卖家SKU/i.test(v)) stdHeaderMap.sku = idx;
            else if (/货号|SKU|商品编号|商品编码/i.test(v) && stdHeaderMap.sku === undefined) stdHeaderMap.sku = idx;
            else if (/销售额|金额|收入|amount|price/i.test(v)) stdHeaderMap.sale_amount = idx;
          });

          if (stdHeaderMap.date !== undefined && stdHeaderMap.sku !== undefined) {
            console.log('[fix-import] 双行表头格式已识别');
            return {
              type: 'standard',
              dataLines: e.slice(2),
              headerMap: stdHeaderMap
            };
          }
        }
      }
    }

    // ===== 回退到原始逻辑 =====
    if (origDetectImportFormat) {
      return origDetectImportFormat(e);
    }

    // 兜底：原始检测逻辑的简化版
    var headerRow = null;
    var skipLines = 0;

    if (t.length > 0 && n.some(function(v) {
      return /日期|货号|SKU|sku|销售额|金额|备注|remark|date/i.test(v);
    })) {
      headerRow = smartHeaderMap(n, {
        date: ['日期','date','Date','DATE','时间'],
        sku: ['货号','SKU','sku','Sku','SKU','商品','商品编号'],
        sale_amount: ['销售额','金额','amount','Amount','price','Price'],
        remark: ['备注','remark','Remark']
      });
      skipLines = 1;
    }

    return {
      type: 'standard',
      dataLines: e.slice(skipLines),
      headerMap: headerRow
    };
  };

  console.log('[fix-import] 已加载 v2 - SHEIN 合并表头格式修复（修复 secondRow 未定义问题）');
})();
