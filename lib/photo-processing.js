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
      brightness: 1.30,
      saturation: 0.88,
      blackLift: 15,
      contrastScale: 0.93,
      median: 3,
      sharpenSigma: 0.45,
      grainAlpha: 8,
      vignetteOpacity: 0.045,
    };
  }

  if (luminance < 92) {
    return {
      name: 'low-light',
      brightness: 1.16,
      saturation: 0.92,
      blackLift: 11,
      contrastScale: 0.95,
      median: 0,
      sharpenSigma: 0.55,
      grainAlpha: 11,
      vignetteOpacity: 0.065,
    };
  }

  return {
    name: 'normal',
    brightness: 1.04,
    saturation: 0.94,
    blackLift: 8,
    contrastScale: 0.96,
    median: 0,
    sharpenSigma: 0.65,
    grainAlpha: 14,
    vignetteOpacity: 0.085,
  };
}

async function makeGrainTile(seedText, alpha) {
  const size = 256;
  const channels = 4;
  const pixels = Buffer.alloc(size * size * channels);
  const random = seededRandom(seedText);

  for (let i = 0; i < size * size; i += 1) {
    const offset = i * channels;
    const value = Math.max(88, Math.min(168, Math.round(128 + ((random() - 0.5) * 54))));
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
        <radialGradient id="v" cx="50%" cy="46%" r="72%">
          <stop offset="0%" stop-color="black" stop-opacity="0"/>
          <stop offset="62%" stop-color="black" stop-opacity="0"/>
          <stop offset="100%" stop-color="black" stop-opacity="${opacity}"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#v)"/>
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
    .modulate({ brightness: preset.brightness, saturation: preset.saturation })
    .linear(preset.contrastScale, preset.blackLift)
    .recomb([
      [1.035, 0, 0],
      [0, 1.005, 0],
      [0, 0, 0.955],
    ])
    .sharpen(preset.sharpenSigma);

  const width = metadata.width;
  const height = metadata.height;

  if (width && height) {
    const grain = await makeGrainTile(seed, preset.grainAlpha);
    image = image.composite([
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
