import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import opentype from 'opentype.js';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const ALLURA_ROOT = path.dirname(require.resolve('@fontsource/allura/400.css'));
const CORMORANT_ROOT = path.dirname(require.resolve('@fontsource/cormorant-garamond/400.css'));

const CANVAS_WIDTH = 1500;
const CANVAS_HEIGHT = 2000;
const PHOTO_X = 80;
const PHOTO_Y = 80;
const PHOTO_WIDTH = CANVAS_WIDTH - (PHOTO_X * 2);
const PHOTO_HEIGHT = 1500;
const CAPTION_TOP = PHOTO_Y + PHOTO_HEIGHT + 42;
const CAPTION_BOTTOM = CANVAS_HEIGHT - 66;
const CAPTION_HEIGHT = CAPTION_BOTTOM - CAPTION_TOP;
const CAPTION_MAX_WIDTH = CANVAS_WIDTH - 220;
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

function captionPlan(caption) {
  const length = caption.length;
  const useScript = !containsCyrillic(caption) && length <= 95;

  if (useScript) {
    if (length <= 35) return { family: 'allura', initialSize: 104, minSize: 58, lineHeight: 1.18, maxLines: 3 };
    if (length <= 60) return { family: 'allura', initialSize: 88, minSize: 54, lineHeight: 1.18, maxLines: 3 };
    return { family: 'allura', initialSize: 72, minSize: 46, lineHeight: 1.20, maxLines: 4 };
  }

  if (length <= 120) return { family: 'cormorant', initialSize: 72, minSize: 44, lineHeight: 1.16, maxLines: 4 };
  if (length <= 160) return { family: 'cormorant', initialSize: 60, minSize: 38, lineHeight: 1.15, maxLines: 5 };
  return { family: 'cormorant', initialSize: 52, minSize: 32, lineHeight: 1.12, maxLines: 6 };
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

function wrapMeasured(caption, fontSize, plan, fonts) {
  const rawTokens = caption.trim().split(/\s+/u).filter(Boolean);
  const tokens = rawTokens.flatMap(token => {
    if (tokenWidth(token, fontSize, plan, fonts) <= CAPTION_MAX_WIDTH) return [token];
    return splitLongToken(token, fontSize, plan, fonts, CAPTION_MAX_WIDTH);
  });

  const lines = [];
  let current = [];
  let currentWidth = 0;
  const gap = spaceWidth(fontSize, plan, fonts);

  for (const token of tokens) {
    const width = tokenWidth(token, fontSize, plan, fonts);
    const nextWidth = current.length ? currentWidth + gap + width : width;

    if (current.length && nextWidth > CAPTION_MAX_WIDTH) {
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

function fitCaption(caption, plan, fonts) {
  for (let fontSize = plan.initialSize; fontSize >= 28; fontSize -= 2) {
    const lines = wrapMeasured(caption, fontSize, plan, fonts);
    const lineHeightPx = fontSize * plan.lineHeight;
    const totalHeight = lines.length * lineHeightPx;

    if (lines.length <= plan.maxLines && totalHeight <= CAPTION_HEIGHT) {
      return { fontSize, lines, lineHeightPx };
    }
  }

  const fontSize = 26;
  const lines = wrapMeasured(caption, fontSize, plan, fonts);
  return { fontSize, lines, lineHeightPx: fontSize * 1.08 };
}

function linePathData(line, baseline, fontSize, plan, fonts) {
  const gap = spaceWidth(fontSize, plan, fonts);
  let x = (CANVAS_WIDTH - line.width) / 2;
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

function captionPathsSvg(layout, plan, fonts) {
  const totalHeight = layout.lines.length * layout.lineHeightPx;
  const firstBaseline = CAPTION_TOP + ((CAPTION_HEIGHT - totalHeight) / 2) + layout.fontSize;

  const paths = layout.lines.map((line, index) => {
    const baseline = firstBaseline + (index * layout.lineHeightPx);
    return `<path d="${linePathData(line, baseline, layout.fontSize, plan, fonts)}" fill="${INK}"/>`;
  }).join('');

  return Buffer.from(`
    <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      ${paths}
    </svg>
  `);
}

function paperSvg() {
  return Buffer.from(`
    <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${PAPER}"/>
      <rect x="28" y="28" width="${CANVAS_WIDTH - 56}" height="${CANVAS_HEIGHT - 56}" rx="5" fill="none" stroke="#d7cfc3" stroke-opacity="0.42" stroke-width="2"/>
    </svg>
  `);
}

export async function createCaptionedPolaroid(processedBuffer, caption) {
  const cleanCaption = String(caption || '').trim().slice(0, 200);
  if (!cleanCaption) return null;

  const fonts = await loadFonts();
  const plan = captionPlan(cleanCaption);
  const layout = fitCaption(cleanCaption, plan, fonts);

  const photo = await sharp(processedBuffer, { failOn: 'none' })
    .rotate()
    .resize(PHOTO_WIDTH, PHOTO_HEIGHT, {
      fit: 'cover',
      position: 'attention',
      withoutEnlargement: false,
    })
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toBuffer();

  return sharp({
    create: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      channels: 3,
      background: PAPER,
    },
  })
    .composite([
      { input: paperSvg(), blend: 'over' },
      { input: photo, top: PHOTO_Y, left: PHOTO_X, blend: 'over' },
      { input: captionPathsSvg(layout, plan, fonts), blend: 'over' },
    ])
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
