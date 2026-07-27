const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPngBuffer(width, height, r = 255, g = 102, b = 0) {
  // Signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  const ihdrChunk = createChunk('IHDR', ihdr);

  // Raw pixel data with filter type byte (0) at the start of each scanline
  const rowSize = width * 4 + 1;
  const rawData = Buffer.alloc(height * rowSize);

  for (let y = 0; y < height; y++) {
    const offset = y * rowSize;
    rawData[offset] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const pxOffset = offset + 1 + x * 4;
      // Draw a subtle border and arrow shape
      const isEdge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const isCenterVertical = Math.abs(x - width / 2) < width * 0.15 && y >= height * 0.25 && y <= height * 0.6;
      const isArrowTip = Math.abs(x - width / 2) <= (height * 0.75 - y) && y > height * 0.45 && y <= height * 0.75;

      if (isCenterVertical || isArrowTip) {
        // White arrow
        rawData[pxOffset] = 255;
        rawData[pxOffset + 1] = 255;
        rawData[pxOffset + 2] = 255;
        rawData[pxOffset + 3] = 255;
      } else if (isEdge) {
        // Dark orange border
        rawData[pxOffset] = Math.max(0, r - 40);
        rawData[pxOffset + 1] = Math.max(0, g - 30);
        rawData[pxOffset + 2] = b;
        rawData[pxOffset + 3] = 255;
      } else {
        // Orange fill
        rawData[pxOffset] = r;
        rawData[pxOffset + 1] = g;
        rawData[pxOffset + 2] = b;
        rawData[pxOffset + 3] = 255;
      }
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressedData);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(4 + 4 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);

  const crc = crc32(buf.slice(4, 8 + len));
  buf.writeUInt32BE(crc, 8 + len);
  return buf;
}

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    let byte = buf[i];
    for (let j = 0; j < 8; j++) {
      let mix = (crc ^ byte) & 1;
      crc = (crc >>> 1) ^ (mix ? 0xedb88320 : 0);
      byte = byte >>> 1;
    }
  }
  return (crc ^ -1) >>> 0;
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

fs.writeFileSync(path.join(iconsDir, 'icon16.png'), createPngBuffer(16, 16));
fs.writeFileSync(path.join(iconsDir, 'icon48.png'), createPngBuffer(48, 48));
fs.writeFileSync(path.join(iconsDir, 'icon128.png'), createPngBuffer(128, 128));

console.log('Иконки успешно сгенерированы!');
