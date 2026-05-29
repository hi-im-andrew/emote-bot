const axios = require('axios');
const sharp = require('sharp');

// Extracts the emote ID from a 7TV URL.
// Supports: https://7tv.app/emotes/<id>
function parseEmoteId(link) {
  const match = link.match(/7tv\.app\/emotes\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error('Invalid 7TV emote URL. Expected format: https://7tv.app/emotes/<id>');
  return match[1];
}

// Fetches emote metadata from the 7TV GQL API and returns the best available image URL.
async function getBestImageUrl(emoteId) {
  const query = `
    query GetEmote($id: ObjectID!) {
      emote(id: $id) {
        id
        name
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

  const images = res.data?.data?.emote?.images;
  if (!images || images.length === 0) throw new Error('No images found for this emote.');

  // Prefer PNG/WEBP, pick highest resolution
  const pngs = images.filter(i => i.mime === 'image/png' || i.mime === 'image/webp');
  const pool = pngs.length > 0 ? pngs : images;
  const best = pool.reduce((a, b) => (b.size > a.size ? b : a));

  return { url: best.url, mime: best.mime };
}

// Falls back to the CDN host pattern if the GQL approach fails.
function cdnUrl(emoteId, scale = '4x') {
  return `https://cdn.7tv.app/emote/${emoteId}/${scale}.webp`;
}

// Downloads and converts the image to a PNG buffer <= 256 KB, as required by Discord.
async function toDiscordPng(url, mime) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  const input = Buffer.from(response.data);

  // Discord emoji limit: 256 KB, max 128x128 display (no hard size limit but we resize to be safe)
  let img = sharp(input);
  const meta = await img.metadata();

  // Resize only if larger than 128px on either axis
  if (meta.width > 128 || meta.height > 128) {
    img = img.resize(128, 128, { fit: 'inside', withoutEnlargement: true });
  }

  const png = await img.png().toBuffer();

  if (png.length > 256 * 1024) {
    // Shrink further if still over the limit
    return sharp(input)
      .resize(96, 96, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  return png;
}

async function fetchEmoteImage(link) {
  const emoteId = parseEmoteId(link);

  let url, mime;
  try {
    ({ url, mime } = await getBestImageUrl(emoteId));
  } catch {
    // Fall back to known CDN pattern
    url = cdnUrl(emoteId);
    mime = 'image/webp';
  }

  return toDiscordPng(url, mime);
}

module.exports = { fetchEmoteImage };
