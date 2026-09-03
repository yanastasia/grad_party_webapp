import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import opentype from 'opentype.js';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const ALLURA_ROOT = path.dirname(require.resolve('@fontsource/allura/400.css'));
const CORMORANT_ROOT = path.dirname(require.resolve('@fontsource/cormorant-garamond/400.css'));

const PAPER = '#f8f3ea';
const INK = '#3b2a22';

let fontsPromise;

function bufferToArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function readFont(root, filename) {
  const fileBuffer = await fs.readFile(path.join(root, 'files', filename));
  return opentype.parse(bufferToArrayBuffer(fileBuffer));
}

async function loadFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      readFont(ALLURA_ROOT, 'allura-latin-400-normal.woff'),
      readFont(CORMORANT_ROOT, 'cormorant-garamond-latin-400-normal.woff'),
      readFont(CORMORANT_ROOT, 'cormorant-garamond-cyrillic-400-normal.woff')
        .catch(() => readFont(CORMORANT_ROOT, 'cormorant-garamond-cyrillic-ext-400-normal.woff')),
    ]).then(([allura, cormorantLatin, cormorantCyrillic]) => ({
      allura,
      cormorantLatin,
      cormorantCyrillic,
    }));
  }
  return fontsPromise;
}

function containsCyrillic(value = '') {
  return /[\u0400-\u04FF]/u.test(value);
}

function frameForOrientation(width, height) {
  const landscape = width >= height;

  if (landscape) {
    const canvasWidth = 2000;
    const canvasHeight = 1500;
    const photoX = 80;
    const photoY = 80;
    const photoWidth = canvasWidth - (photoX * 2);
    const photoHeight = 1040;
    const captionTop = photoY + photoHeight + 34;
    const captionBottom = canvasHeight - 54;

    return {
      landscape,
      canvasWidth,
      canvasHeight,
      photoX,
      photoY,
      photoWidth,
      photoHeight,
      captionTop,
      captionBottom,
      captionHeight: captionBottom - captionTop,
      captionMaxWidth: canvasWidth - 240,
    };
  }

  const canvasWidth = 1500;
  const canvasHeight = 2000;
  const photoX = 80;
  const photoY = 80;
  const photoWidth = canvasWidth - (photoX * 2);
  const photoHeight = 1500;
  const captionTop = photoY + photoHeight + 42;
  const captionBottom = canvasHeight - 66;

  return {
    landscape,
    canvasWidth,
    canvasHeight,
    photoX,
    photoY,
    photoWidth,
    photoHeight,
    captionTop,
    captionBottom,
    captionHeight: captionBottom - captionTop,
    captionMaxWidth: canvasWidth - 220,
  };
}

function captionPlan(caption, frame) {
  const length = caption.length;
  const useScript = !containsCyrillic(caption) && length <= 95;
  const landscapeScale = frame.landscape ? 0.9 : 1;

  if (useScript) {
    if (length <= 35) return { family: 'allura', initialSize: Math.round(104 * landscapeScale), lineHeight: 1.18, maxLines: 3 };
    if (length <= 60) return { family: 'allura', initialSize: Math.round(88 * landscapeScale), lineHeight: 1.18, maxLines: 3 };
    return { family: 'allura', initialSize: Math.round(72 * landscapeScale), lineHeight: 1.2, maxLines: 4 };
  }

  if (length <= 120) return { family: 'cormorant', initialSize: Math.round(72 * landscapeScale), lineHeight: 1.16, maxLines: 4 };
  if (length <= 160) return { family: 'cormorant', initialSize: Math.round(60 * landscapeScale), lineHeight: 1.15, maxLines: 5 };
  return { family: 'cormorant', initialSize: Math.round(52 * landscapeScale), lineHeight: 1.12, maxLines: 6 };
}

function fontForToken(token, plan, fonts) {
  if (plan.family === 'allura') return fonts.allura;
  return containsCyrillic(token) ? fonts.cormorantCyrillic : fonts.cormorantLatin;
}

function tokenWidth(token, fontSize, plan, fonts) {
  return fontForToken(token, plan, fonts).getAdvanceWidth(token, fontSize, { kerning: true });
}

function spaceWidth(fontSize, plan, fonts) {
  const font = plan.family === 'allura' ? fonts.allura : fonts.cormorantLatin;
  return font.getAdvanceWidth(' ', fontSize, { kerning: true });
}

function splitLongToken(token, fontSize, plan, fonts, maxWidth) {
  const pieces = [];
  let part = '';

  for (const char of token) {
    const candidate = part + char;
    if (part && tokenWidth(candidate, fontSize, plan, fonts) > maxWidth) {
      pieces.push(part);
      part = char;
    } else {
      part = candidate;
    }
  }

  if (part) pieces.push(part);
  return pieces;
}

function wrapMeasured(caption, fontSize, plan, fonts, frame) {
  const rawTokens = caption.trim().split(/\s+/u).filter(Boolean);
  const tokens = rawTokens.flatMap(token => {
    if (tokenWidth(token, fontSize, plan, fonts) <= frame.captionMaxWidth) return [token];
    return splitLongToken(token, fontSize, plan, fonts, frame.captionMaxWidth);
  });

  const lines = [];
  let current = [];
  let currentWidth = 0;
  const gap = spaceWidth(fontSize, plan, fonts);

  for (const token of tokens) {
    const width = tokenWidth(token, fontSize, plan, fonts);
    const nextWidth = current.length ? currentWidth + gap + width : width;

    if (current.length && nextWidth > frame.captionMaxWidth) {
      lines.push({ tokens: current, width: currentWidth });
      current = [token];
      currentWidth = width;
    } else {
      current.push(token);
      currentWidth = nextWidth;
    }
  }

  if (current.length) lines.push({ tokens: current, width: currentWidth });
  return lines;
}

function fitCaption(caption, plan, fonts, frame) {
  for (let fontSize = plan.initialSize; fontSize >= 24; fontSize -= 2) {
    const lines = wrapMeasured(caption, fontSize, plan, fonts, frame);
    const lineHeightPx = fontSize * plan.lineHeight;
    const totalHeight = lines.length * lineHeightPx;

    if (lines.length <= plan.maxLines && totalHeight <= frame.captionHeight) {
      return { fontSize, lines, lineHeightPx };
    }
  }

  const fontSize = 22;
  const lines = wrapMeasured(caption, fontSize, plan, fonts, frame);
  return { fontSize, lines, lineHeightPx: fontSize * 1.06 };
}

function linePathData(line, baseline, fontSize, plan, fonts, frame) {
  const gap = spaceWidth(fontSize, plan, fonts);
  let x = (frame.canvasWidth - line.width) / 2;
  let data = '';

  line.tokens.forEach((token, index) => {
    const font = fontForToken(token, plan, fonts);
    const pathObj = font.getPath(token, x, baseline, fontSize, { kerning: true });
    data += `${pathObj.toPathData(2)} `;
    x += tokenWidth(token, fontSize, plan, fonts);
    if (index < line.tokens.length - 1) x += gap;
  });

  return data.trim();
}

function captionPathsSvg(layout, plan, fonts, frame) {
  const totalHeight = layout.lines.length * layout.lineHeightPx;
  const firstBaseline = frame.captionTop + ((frame.captionHeight - totalHeight) / 2) + layout.fontSize;

  const paths = layout.lines.map((line, index) => {
    const baseline = firstBaseline + (index * layout.lineHeightPx);
    return `<path d="${linePathData(line, baseline, layout.fontSize, plan, fonts, frame)}" fill="${INK}"/>`;
  }).join('');

  return Buffer.from(`
    <svg width="${frame.canvasWidth}" height="${frame.canvasHeight}" xmlns="http://www.w3.org/2000/svg">
      ${paths}
    </svg>
  `);
}

function paperSvg(frame) {
  return Buffer.from(`
    <svg width="${frame.canvasWidth}" height="${frame.canvasHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${PAPER}"/>
      <rect x="28" y="28" width="${frame.canvasWidth - 56}" height="${frame.canvasHeight - 56}" rx="5" fill="none" stroke="#d7cfc3" stroke-opacity="0.42" stroke-width="2"/>
    </svg>
  `);
}

export async function createCaptionedPolaroid(processedBuffer, caption) {
  const cleanCaption = String(caption || '').trim().slice(0, 200);
  if (!cleanCaption) return null;

  const probe = sharp(processedBuffer, { failOn: 'none' }).rotate();
  const metadata = await probe.metadata();
  if (!metadata.width || !metadata.height) return null;

  const frame = frameForOrientation(metadata.width, metadata.height);
  const fonts = await loadFonts();
  const plan = captionPlan(cleanCaption, frame);
  const layout = fitCaption(cleanCaption, plan, fonts, frame);

  const photo = await sharp(processedBuffer, { failOn: 'none' })
    .rotate()
    .resize(frame.photoWidth, frame.photoHeight, {
      fit: 'cover',
      position: 'attention',
      withoutEnlargement: false,
    })
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toBuffer();

  return sharp({
    create: {
      width: frame.canvasWidth,
      height: frame.canvasHeight,
      channels: 3,
      background: PAPER,
    },
  })
    .composite([
      { input: paperSvg(frame), blend: 'over' },
      { input: photo, top: frame.photoY, left: frame.photoX, blend: 'over' },
      { input: captionPathsSvg(layout, plan, fonts, frame), blend: 'over' },
    ])
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
