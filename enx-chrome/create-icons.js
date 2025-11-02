import sharp from 'sharp';
import fs from 'fs';

async function createIcon(size) {
  const svg = `
    <svg width="${size}" height="${size}">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" fill="url(#grad)" rx="${size / 5}"/>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" 
            fill="white" font-size="${size * 0.6}" font-weight="bold" font-family="Arial, sans-serif">E</text>
      <path d="M${size*0.15} ${size*0.85}L${size*0.3} ${size*0.85}M${size*0.15} ${size*0.75}L${size*0.25} ${size*0.75}" 
            stroke="white" stroke-width="${Math.max(1, size/20)}" stroke-linecap="round" opacity="0.6"/>
    </svg>
  `;
  
  await sharp(Buffer.from(svg))
    .png()
    .toFile(`icons/icon-${size}.png`);
  
  console.log(`Created icon-${size}.png`);
}

async function main() {
  if (!fs.existsSync('icons')) {
    fs.mkdirSync('icons');
  }
  
  const sizes = [16, 32, 48, 128];
  for (const size of sizes) {
    await createIcon(size);
  }
  
  console.log('All PNG icons created successfully!');
}

main().catch(console.error);
