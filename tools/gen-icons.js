// One-off script: writes simple flat-color PWA icons as real PNG files using
// only Node's built-in zlib (no native image libs available in this
// environment). Draws a rounded-square background with a white water-drop
// silhouette — good enough for a home-screen/install icon.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function inDrop(nx, ny) {
  // nx, ny in [-1, 1], origin center. Teardrop: circle for the bottom bulb,
  // a triangle wedge for the pointed top.
  const cx = 0, cy = 0.15, r = 0.42;
  const dx = nx - cx, dy = ny - cy;
  if (dx * dx + dy * dy <= r * r) return true;
  // pointed top: within a narrowing triangle above the circle
  const topY = -0.62;
  if (ny >= topY && ny <= cy) {
    const t = (ny - topY) / (cy - topY); // 0 at tip, 1 at bulb join
    const halfWidth = r * t * 0.95;
    if (Math.abs(nx) <= halfWidth) return true;
  }
  return false;
}

function makeIcon(size) {
  const bg = [22, 163, 74]; // accent radium green (see web/styles.css --accent)
  const fg = [255, 255, 255];
  const raw = Buffer.alloc(size * (1 + size * 3)); // filter byte + RGB per row
  let offset = 0;
  const radius = size * 0.18; // rounded-square corner radius

  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      // rounded-rect mask
      let inside = true;
      const cornerChecks = [
        [radius, radius], [size - radius, radius],
        [radius, size - radius], [size - radius, size - radius],
      ];
      for (const [cx, cy] of cornerChecks) {
        const nearCornerX = (cx === radius) ? x < radius : x > size - radius;
        const nearCornerY = (cy === radius) ? y < radius : y > size - radius;
        if (nearCornerX && nearCornerY) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy > radius * radius) inside = false;
        }
      }

      const nx = (x / size) * 2 - 1;
      const ny = (y / size) * 2 - 1;
      const drop = inDrop(nx, ny);

      const [r, g, b] = !inside ? [244, 248, 245] /* transparent-ish page bg, see web/styles.css --bg */ : drop ? fg : bg;
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png;
}

const outDir = path.join(__dirname, '..', 'web', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [192, 512, 180]) {
  const png = makeIcon(size);
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  fs.writeFileSync(path.join(outDir, name), png);
  console.log(`wrote ${name} (${png.length} bytes)`);
}
