const axios = require('axios');
const sharp = require('sharp');

function parseEmoteId(link) {
  const match = link.match(/7tv\.app\/emotes\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error('Invalid 7TV emote URL. Expected format: https://7tv.app/emotes/<id>');
  return match[1];
}

// Returns emote metadata including whether it's animated.
async function getEmoteMeta(emoteId) {
  const query = `
    query GetEmote($id: ObjectID!) {
      emote(id: $id) {
        id
        name
        animated
        images {
          url
          mime
          size
          width
          height
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
  if (!emote) throw new Error('Emote not found.');

  return emote;
}

function cdnUrl(emoteId, ext, scale = '4x') {
  return `https://cdn.7tv.app/emote/${emoteId}/${scale}.${ext}`;
}

// Converts a static image to a Discord-safe PNG (<= 256 KB).
async function toDiscordPng(buffer) {
  let img = sharp(buffer);
  const meta = await img.metadata();

  if (meta.width > 128 || meta.height > 128) {
    img = img.resize(128, 128, { fit: 'inside', withoutEnlargement: true });
  }

  const png = await img.png().toBuffer();
  if (png.length > 256 * 1024) {
    return sharp(buffer)
      .resize(96, 96, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  return png;
}

// Returns the raw GIF buffer for an animated emote.
// Discord accepts GIFs as-is for animated emoji; we just enforce the 256 KB limit.
async function toDiscordGif(emoteId) {
  // Try 4x first, fall back to smaller scales if over the size limit.
  for (const scale of ['4x', '3x', '2x', '1x']) {
    const url = cdnUrl(emoteId, 'gif', scale);
    const res = await axios.get(url, { responseType: 'arraybuffer' });
    const buf = Buffer.from(res.data);
    if (buf.length <= 256 * 1024) return buf;
  }
  throw new Error('Could not get an animated GIF under the 256 KB Discord limit.');
}

// Fetches and processes the emote image.
// animated: true = force animated, false = force static, null = auto-detect from API.
async function fetchEmoteImage(link, animated = null) {
  const emoteId = parseEmoteId(link);

  let isAnimated = animated;

  if (isAnimated === null) {
    try {
      const meta = await getEmoteMeta(emoteId);
      isAnimated = meta.animated ?? false;
    } catch {
      isAnimated = false;
    }
  }

  if (isAnimated) {
    return { buffer: await toDiscordGif(emoteId), animated: true };
  }

  // Static path: fetch best PNG/WebP from GQL, fall back to CDN WebP.
  let url;
  try {
    const meta = await getEmoteMeta(emoteId);
    const images = meta.images ?? [];
    const stills = images.filter(i => i.mime === 'image/png' || i.mime === 'image/webp');
    const pool = stills.length > 0 ? stills : images;
    const best = pool.reduce((a, b) => (b.size > a.size ? b : a));
    url = best.url;
  } catch {
    url = cdnUrl(emoteId, 'webp');
  }

  const res = await axios.get(url, { responseType: 'arraybuffer' });
  const buffer = await toDiscordPng(Buffer.from(res.data));
  return { buffer, animated: false };
}

module.exports = { fetchEmoteImage };
