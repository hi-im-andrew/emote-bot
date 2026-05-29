const axios = require('axios');
const sharp = require('sharp');

const DISCORD_MAX_BYTES = 256 * 1024;

function parseEmoteId(link) {
  const match = link.match(/7tv\.app\/emotes\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error('Invalid 7TV emote URL. Expected format: https://7tv.app/emotes/<id>');
  return match[1];
}

async function getEmoteMeta(emoteId) {
  const query = `
    query GetEmote($id: ObjectID!) {
      emote(id: $id) {
        id
        name
        animated
        host {
          url
          files { name format width height size }
        }
      }
    }
  `;

  const res = await axios.post(
    'https://7tv.io/v3/gql',
    { query, variables: { id: emoteId } },
    { headers: { 'Content-Type': 'application/json' } }
  );

  const emote = res.data?.data?.emote;
  if (!emote) throw new Error('Emote not found on 7TV.');
  return emote;
}

// Picks the largest file of the preferred format under the size cap, falling back to next format.
function pickFile(files, preferredFormats) {
  for (const fmt of preferredFormats) {
    const candidates = files
      .filter(f => f.format === fmt && f.size <= DISCORD_MAX_BYTES)
      .sort((a, b) => b.size - a.size);
    if (candidates.length) return candidates[0];
  }
  // Nothing fits; return the smallest available across preferred formats
  const all = files
    .filter(f => preferredFormats.includes(f.format))
    .sort((a, b) => a.size - b.size);
  return all[0] ?? files.sort((a, b) => a.size - b.size)[0];
}

async function download(baseUrl, fileName) {
  const url = `https:${baseUrl}/${fileName}`;
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

// Converts a static image to PNG.
async function toStaticPng(buffer) {
  for (const [w, h] of [[128, 128], [96, 96]]) {
    const png = await sharp(buffer)
      .resize(w, h, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    if (png.length <= DISCORD_MAX_BYTES) return png;
  }
  throw new Error('Could not produce a PNG under the 256 KB Discord limit.');
}

// animatedOverride: true = force animated, false = force static, null = auto-detect.
async function fetchEmoteImage(link, animatedOverride = null) {
  const emoteId = parseEmoteId(link);
  const meta = await getEmoteMeta(emoteId);

  const isAnimated = animatedOverride ?? meta.animated ?? false;
  const { url: baseUrl, files } = meta.host;

  if (isAnimated) {
    // Pick the largest AVIF/WebP file and swap extension to .gif — 7TV serves GIFs at the same path.
    const file = pickFile(files, ['AVIF', 'WEBP']);
    const gifName = file.name.replace(/\.[^.]+$/, '.gif');
    const buffer = await download(baseUrl, gifName);
    return { buffer, animated: true };
  }

  // Static: prefer WebP (better quality), fall back to AVIF.
  // Pick a non-animated (1-frame) file — use the largest that fits.
  const staticFiles = files.filter(f => ['WEBP', 'AVIF'].includes(f.format));
  const file = pickFile(staticFiles, ['WEBP', 'AVIF']);
  const raw = await download(baseUrl, file.name);
  const buffer = await toStaticPng(raw);
  return { buffer, animated: false };
}

module.exports = { fetchEmoteImage };
