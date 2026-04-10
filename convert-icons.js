/**
 * SVG → PNG 批量转换
 * 运行：node convert-icons.js
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, 'icons');
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

async function convertAll() {
  console.log('开始转换 SVG → PNG...\n');
  
  for (const size of sizes) {
    const svgPath = path.join(iconsDir, `icon-${size}.svg`);
    const pngPath = path.join(iconsDir, `icon-${size}.png`);
    
    if (!fs.existsSync(svgPath)) {
      console.warn(`⚠️  找不到 ${svgPath}`);
      continue;
    }
    
    try {
      await sharp(svgPath)
        .resize(size, size)
        .png()
        .toFile(pngPath);
      console.log(`✅ icon-${size}.png (${size}x${size})`);
    } catch (err) {
      console.error(`❌ 转换 ${size} 失败:`, err.message);
    }
  }
  
  // 同时生成 favicon.png (32x32)
  const faviconSvg = path.join(__dirname, 'favicon.svg');
  if (fs.existsSync(faviconSvg)) {
    await sharp(faviconSvg).resize(32, 32).png().toFile(path.join(__dirname, 'favicon.png'));
    console.log('✅ favicon.png (32x32)');
  }
  
  console.log('\n🎉 所有图标转换完成！');
}

convertAll().catch(console.error);
