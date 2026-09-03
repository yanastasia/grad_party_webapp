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
      brightness: 1.43,
      saturation: 0.91,
      gamma: 1.26,
      blackLift: 21,
      contrastScale: 0.89,
      median: 3,
      sharpenSigma: 0.40,
      grainAlpha: 18,
      vignetteOpacity: 0.095,
      warmOpacity: 0.085,
    };
  }

  if (luminance < 92) {
    return {
      name: 'low-light',
      brightness: 1.27,
      saturation: 0.94,
      gamma: 1.15,
      blackLift: 16,
      contrastScale: 0.92,
      median: 0,
      sharpenSigma: 0.50,
      grainAlpha: 21,
      vignetteOpacity: 0.115,
      warmOpacity: 0.09,
    };
  }

  return {
    name: 'normal',
    brightness: 1.09,
    saturation: 0.95,
    gamma: 1.05,
    blackLift: 11,
    contrastScale: 0.94,
    median: 0,
    sharpenSigma: 0.60,
    grainAlpha: 24,
    vignetteOpacity: 0.135,
    warmOpacity: 0.095,
  };
}

async function makeGrainTile(seedText, alpha) {
  const size = 256;
  const channels = 4;
  const pixels = Buffer.alloc(size * size * channels);
  const random = seededRandom(seedText);

  for (let i = 0; i < size * size; i += 1) {
    const offset = i * channels;
    const value = Math.max(78, Math.min(178, Math.round(128 + ((random() - 0.5) * 76))));
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
        <radialGradient id="v" cx="50%" cy="44%" r="73%">
          <stop offset="0%" stop-color="black" stop-opacity="0"/>
          <stop offset="55%" stop-color="black" stop-opacity="0"/>
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
      <defs>
        <linearGradient id="warm" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#e0a07f" stop-opacity="${opacity}"/>
          <stop offset="55%" stop-color="#d98c72" stop-opacity="${opacity * 0.8}"/>
          <stop offset="100%" stop-color="#9a7b91" stop-opacity="${opacity * 0.35}"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#warm)"/>
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
      [1.095, 0.018, 0],
      [0.008, 1.022, 0],
      [0, 0.006, 0.885],
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
