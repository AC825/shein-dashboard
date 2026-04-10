/**
 * 生成 PWA 多尺寸图标
 * 运行：node generate-icons.js
 * 依赖：无（使用 Node.js 内置 Canvas 替代品，纯 JS 绘制后保存为 PNG）
 */

const fs = require('fs');
const path = require('path');

// 创建 icons 目录
const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// 用 canvas npm 包或 sharp，这里用纯 SVG 转 PNG 方案
// 先生成 SVG，再用 Node.js 内置方法写成可用的 PNG

// 图标 SVG 模板：深色背景 + 紫色渐变 + 图表图标
function generateSVG(size) {
  const padding = Math.floor(size * 0.15);
  const iconSize = size - padding * 2;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.48;
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1e1b4b;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#312e81;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="icon" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#a78bfa;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#6366f1;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="icon2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#34d399;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#059669;stop-opacity:1" />
    </linearGradient>
  </defs>
  <!-- 圆角背景 -->
  <rect width="${size}" height="${size}" rx="${size * 0.22}" ry="${size * 0.22}" fill="url(#bg)"/>
  <!-- 装饰圆 -->
  <circle cx="${size * 0.85}" cy="${size * 0.15}" r="${size * 0.18}" fill="#6366f1" opacity="0.2"/>
  <circle cx="${size * 0.15}" cy="${size * 0.85}" r="${size * 0.12}" fill="#34d399" opacity="0.15"/>
  <!-- 主图标：折线图 -->
  <g transform="translate(${padding}, ${padding})">
    <!-- 坐标轴 -->
    <line x1="${iconSize*0.1}" y1="${iconSize*0.85}" x2="${iconSize*0.95}" y2="${iconSize*0.85}" stroke="#6366f1" stroke-width="${size*0.025}" stroke-linecap="round" opacity="0.5"/>
    <line x1="${iconSize*0.1}" y1="${iconSize*0.15}" x2="${iconSize*0.1}" y2="${iconSize*0.85}" stroke="#6366f1" stroke-width="${size*0.025}" stroke-linecap="round" opacity="0.5"/>
    <!-- 折线（亮紫色） -->
    <polyline 
      points="${iconSize*0.1},${iconSize*0.7} ${iconSize*0.3},${iconSize*0.5} ${iconSize*0.5},${iconSize*0.6} ${iconSize*0.7},${iconSize*0.3} ${iconSize*0.9},${iconSize*0.2}"
      fill="none" stroke="url(#icon)" stroke-width="${size*0.05}" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- 折线下方填充 -->
    <polygon 
      points="${iconSize*0.1},${iconSize*0.7} ${iconSize*0.3},${iconSize*0.5} ${iconSize*0.5},${iconSize*0.6} ${iconSize*0.7},${iconSize*0.3} ${iconSize*0.9},${iconSize*0.2} ${iconSize*0.9},${iconSize*0.85} ${iconSize*0.1},${iconSize*0.85}"
      fill="url(#icon)" opacity="0.15"/>
    <!-- 数据点 -->
    <circle cx="${iconSize*0.3}" cy="${iconSize*0.5}" r="${size*0.04}" fill="#a78bfa"/>
    <circle cx="${iconSize*0.5}" cy="${iconSize*0.6}" r="${size*0.04}" fill="#a78bfa"/>
    <circle cx="${iconSize*0.7}" cy="${iconSize*0.3}" r="${size*0.04}" fill="#a78bfa"/>
    <!-- 柱状图（绿色，右下角小装饰） -->
    <rect x="${iconSize*0.62}" y="${iconSize*0.62}" width="${iconSize*0.08}" height="${iconSize*0.23}" rx="${size*0.02}" fill="url(#icon2)" opacity="0.7"/>
    <rect x="${iconSize*0.74}" y="${iconSize*0.52}" width="${iconSize*0.08}" height="${iconSize*0.33}" rx="${size*0.02}" fill="url(#icon2)" opacity="0.7"/>
    <rect x="${iconSize*0.86}" y="${iconSize*0.42}" width="${iconSize*0.08}" height="${iconSize*0.43}" rx="${size*0.02}" fill="url(#icon2)" opacity="0.7"/>
  </g>
</svg>`;
}

// 将 SVG 保存到 icons 目录
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

sizes.forEach(size => {
  const svgContent = generateSVG(size);
  const svgPath = path.join(iconsDir, `icon-${size}.svg`);
  fs.writeFileSync(svgPath, svgContent, 'utf8');
  console.log(`✅ 生成 icon-${size}.svg`);
});

// 同时生成一个 favicon.svg
const faviconSvg = generateSVG(32);
fs.writeFileSync(path.join(__dirname, 'favicon.svg'), faviconSvg, 'utf8');
console.log('✅ 生成 favicon.svg');

console.log('\n图标已生成到 icons/ 目录（SVG格式）');
console.log('注意：PWABuilder 支持 SVG 图标，但建议同时提供 PNG');
console.log('如需转换 PNG，可在 https://convertio.co 批量转换');
