// One-off icon generator: writes the app icons (PNG) used by the PWA manifest
// and the iOS "Add to Home Screen" tile. Pure Node (zlib) — no image libs.
// Terminal aesthetic: an amber ring + core dot on the near-black app background.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function px(buf, w, x, y, [r, g, b, a]) {
  const i = (y * w + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}

function makePng(size) {
  const w = size, h = size;
  const buf = Buffer.alloc(w * h * 4);
  const bg = [10, 10, 10, 255];       // --bg #0a0a0a
  const amber = [255, 160, 40, 255];  // --amber #ffa028
  const cx = w / 2, cy = h / 2;
  const outer = size * 0.30;          // ring outer radius
  const inner = size * 0.17;          // ring inner radius (hollow center)
  const dot = size * 0.085;           // small solid core dot
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      let c = bg;
      if (d <= dot) c = amber;
      else if (d >= inner && d <= outer) c = amber;
      px(buf, w, x, y, c);
    }
  }
  // PNG encode (filter byte 0 per row).
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    buf.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// CRC32 (PNG)
const crcTable = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const out = path.join(__dirname, '..', 'public');
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  fs.writeFileSync(path.join(out, name), makePng(size));
  console.log('wrote', name, size + 'x' + size);
}
