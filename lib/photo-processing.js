import sharp from 'sharp';

function seededRandom(seedText = '') {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    seed ^= seedText.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed += 0x6D2B79F5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function luminanceFromStats(stats) {
  const [r, g, b] = stats.channels;
  if (!r || !g || !b) return 110;
  return (0.2126 * r.mean) + (0.7152 * g.mean) + (0.0722 * b.mean);
}

function presetForLuminance(luminance) {
  if (luminance < 58) {
    return {
      name: 'very-dark',
      brightness: 1.38,
      saturation: 0.90,
      gamma: 1.22,
      blackLift: 19,
      contrastScale: 0.90,
      median: 3,
      sharpenSigma: 0.42,
      grainAlpha: 10,
      vignetteOpacity: 0.075,
      warmOpacity: 0.055,
    };
  }

  if (luminance < 92) {
    return {
      name: 'low-light',
      brightness: 1.22,
      saturation: 0.94,
      gamma: 1.12,
      blackLift: 14,
      contrastScale: 0.93,
      median: 0,
      sharpenSigma: 0.52,
      grainAlpha: 14,
      vignetteOpacity: 0.09,
      warmOpacity: 0.06,
    };
  }

  return {
    name: 'normal',
    brightness: 1.07,
    saturation: 0.96,
    gamma: 1.04,
    blackLift: 10,
    contrastScale: 0.95,
    median: 0,
    sharpenSigma: 0.62,
    grainAlpha: 18,
    vignetteOpacity: 0.11,
    warmOpacity: 0.065,
  };
}

async function makeGrainTile(seedText, alpha) {
  const size = 256;
  const channels = 4;
  const pixels = Buffer.alloc(size * size * channels);
  const random = seededRandom(seedText);

  for (let i = 0; i < size * size; i += 1) {
    const offset = i * channels;
    const value = Math.max(82, Math.min(174, Math.round(128 + ((random() - 0.5) * 66))));
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
    pixels[offset + 3] = alpha;
  }

  return sharp(pixels, { raw: { width: size, height: size, channels } })
    .png()
    .toBuffer();
}

function vignetteSvg(width, height, opacity) {
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="v" cx="50%" cy="45%" r="72%">
          <stop offset="0%" stop-color="black" stop-opacity="0"/>
          <stop offset="58%" stop-color="black" stop-opacity="0"/>
          <stop offset="100%" stop-color="black" stop-opacity="${opacity}"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#v)"/>
    </svg>
  `);
}

function warmWashSvg(width, height, opacity) {
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#d98c72" fill-opacity="${opacity}"/>
    </svg>
  `);
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapCaption(text, maxChars = 34, maxLines = 4) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);

  const usedWords = lines.join(' ').split(/\s+/).filter(Boolean).length;
  if (usedWords < words.length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.…]+$/, '')}…`;
  }
  return lines;
}

function captionSvg(width, height, caption) {
  const portraitish = height >= width;
  const fontSize = Math.max(28, Math.round(Math.min(width, height) * (portraitish ? 0.045 : 0.052)));
  const padding = Math.max(28, Math.round(Math.min(width, height) * 0.045));
  const lineHeight = Math.round(fontSize * 1.18);
  const maxChars = width < 900 ? 28 : 36;
  const lines = wrapCaption(caption, maxChars, 4);
  const blockHeight = lines.length * lineHeight;
  const startY = height - padding - blockHeight + lineHeight;

  const tspans = lines.map((line, index) =>
    `<tspan x="${padding}" y="${startY + index * lineHeight}">${escapeXml(line)}</tspan>`
  ).join('');

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2.2" result="blur"/>
          <feOffset dy="2" result="offsetBlur"/>
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.55"/>
          </feComponentTransfer>
          <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <text
        font-family="URW Chancery L, Brush Script MT, Segoe Script, cursive"
        font-size="${fontSize}"
        font-style="italic"
        fill="#fff8ee"
        stroke="#3b241b"
        stroke-opacity="0.22"
        stroke-width="1.1"
        paint-order="stroke"
        filter="url(#shadow)"
      >${tspans}</text>
    </svg>
  `);
}

export async function processPartyPhoto(inputBuffer, { seed = 'party-photo' } = {}) {
  const probe = sharp(inputBuffer, { failOn: 'none' }).rotate();
  const [metadata, stats] = await Promise.all([probe.metadata(), probe.stats()]);
  const luminance = luminanceFromStats(stats);
  const preset = presetForLuminance(luminance);

  let image = sharp(inputBuffer, { failOn: 'none' }).rotate();

  if (preset.median) image = image.median(preset.median);

  image = image
    .gamma(preset.gamma)
    .modulate({ brightness: preset.brightness, saturation: preset.saturation })
    .linear(preset.contrastScale, preset.blackLift)
    .recomb([
      [1.075, 0.012, 0],
      [0.006, 1.018, 0],
      [0, 0.004, 0.91],
    ])
    .sharpen(preset.sharpenSigma);

  const width = metadata.width;
  const height = metadata.height;

  if (width && height) {
    const grain = await makeGrainTile(seed, preset.grainAlpha);
    image = image.composite([
      { input: warmWashSvg(width, height, preset.warmOpacity), blend: 'soft-light' },
      { input: grain, tile: true, blend: 'soft-light' },
      { input: vignetteSvg(width, height, preset.vignetteOpacity), blend: 'over' },
    ]);
  }

  const outputBuffer = await image
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();

  return {
    buffer: outputBuffer,
    preset: preset.name,
    luminance: Math.round(luminance * 10) / 10,
  };
}

export async function addCaptionToPhoto(processedBuffer, caption) {
  const cleanCaption = String(caption || '').trim();
  if (!cleanCaption) return null;

  const base = sharp(processedBuffer, { failOn: 'none' }).rotate();
  const metadata = await base.metadata();
  if (!metadata.width || !metadata.height) return null;

  return base
    .composite([{ input: captionSvg(metadata.width, metadata.height, cleanCaption), blend: 'over' }])
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
