// Renders every frame of a build (default: the 9:16 TikTok one) to JPEG + the soundtrack to WAV.
// usage: node animations/tools/render-video.js [html] [outDir] [seconds=81.5] [query, e.g. ?nocap]
// (needs Playwright with Chromium)
const { chromium } = require('playwright');
const fs = require('fs');

const path = require('path');
const FILE = 'file://' + path.resolve(process.argv[2] || path.join(__dirname, '..', 'rainy-robot-ova-tiktok.html'));
const FPS = 24, SECS = parseFloat(process.argv[4] || '81.5'), N = Math.round(FPS * SECS), WORKERS = 4, QUERY = process.argv[5] || '';
const OUT = process.argv[3] || path.join(__dirname, '..', 'out');
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
(async () => {
  const b = await chromium.launch();
  const t0 = Date.now();
  const work = async k => {
    const p = await b.newPage();
    p.on('pageerror', e => console.log('PAGEERR', e.message));
    await p.goto(FILE + QUERY);
    await p.evaluate(() => window.__fontsReady || null);
    for (let i = k; i < N; i += WORKERS) {
      const url = await p.evaluate(t => { window.__render(t); return document.getElementById('cv').toDataURL('image/jpeg', .95); }, (i + .5) / FPS);
      fs.writeFileSync(`${OUT}/frames/f_${String(i).padStart(5, '0')}.jpg`, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
      if (k === 0 && i % 240 === 0) console.log(`frame ${i}/${N}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    await p.close();
  };
  await Promise.all([0, 1, 2, 3].map(work));
  console.log('frames done', ((Date.now() - t0) / 1000).toFixed(0), 's');
  // soundtrack
  const p = await b.newPage();
  await p.goto(FILE + QUERY);
    await p.evaluate(() => window.__fontsReady || null);
  const sr = 48000;
  await p.evaluate(async ([sr, secs]) => {
    const oc = new OfflineAudioContext(2, Math.round(sr * secs), sr);
    buildAudio(oc, 0);
    const buf = await oc.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1), pcm = new Int16Array(L.length * 2);
    for (let i = 0; i < L.length; i++) {
      pcm[2 * i] = Math.max(-1, Math.min(1, L[i])) * 32767;
      pcm[2 * i + 1] = Math.max(-1, Math.min(1, R[i])) * 32767;
    }
    window.__pcm = new Uint8Array(pcm.buffer);
  }, [sr, SECS]);
  const len = await p.evaluate(() => window.__pcm.length);
  const chunks = [];
  for (let off = 0; off < len; off += 3 << 20) {
    const b64 = await p.evaluate(([o, n]) => { let s = ''; const a = window.__pcm.subarray(o, o + n); for (let i = 0; i < a.length; i += 32768) s += String.fromCharCode.apply(null, a.subarray(i, i + 32768)); return btoa(s); }, [off, 3 << 20]);
    chunks.push(Buffer.from(b64, 'base64'));
  }
  const data = Buffer.concat(chunks), hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12);
  hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(sr, 24);
  hdr.writeUInt32LE(sr * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
  fs.writeFileSync(`${OUT}/audio.wav`, Buffer.concat([hdr, data]));
  console.log('audio done', (data.length / sr / 4).toFixed(2), 's  total', ((Date.now() - t0) / 1000).toFixed(0), 's');
  await b.close();
})();
