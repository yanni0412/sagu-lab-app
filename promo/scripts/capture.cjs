// 앱(www/index.html)을 실제로 띄워 영상 소재를 다시 캡처한다.
// 사용: node promo/scripts/capture.cjs  (Playwright 필요)
// 결과: promo/scripts/out/ 아래 PNG. replay 프레임은 ffmpeg로 assets/shots/replay.mp4로 묶는다:
//   ffmpeg -framerate 30 -i promo/scripts/out/replay/f%04d.png -c:v libx264 -pix_fmt yuv420p -crf 18 -vf scale=1796:-2 promo/assets/shots/replay.mp4
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(__dirname, "out");

(async () => {
  fs.mkdirSync(path.join(OUT, "replay"), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto("file://" + path.join(ROOT, "www/index.html"));
  await page.waitForTimeout(1500);
  const cv = page.locator("#cv");

  await cv.screenshot({ path: path.join(OUT, "aim.png") });
  const tipBox = await page.locator('h3:has-text("당점")').locator("xpath=..").boundingBox();
  await page.screenshot({ path: path.join(OUT, "spin.png"), clip: tipBox });

  // 샷 리플레이를 스크럽 슬라이더로 1/30초씩 넘기며 캡처
  await page.click("#btnShoot");
  await page.click("#btnPlay");
  const max = await page.$eval("#scrub", (s) => +s.max);
  let i = 0;
  for (let t = 0; t <= max; t += 100 / 30) {
    await page.$eval("#scrub", (s, v) => { s.value = Math.round(v); s.dispatchEvent(new Event("input")); }, t);
    await cv.screenshot({ path: path.join(OUT, "replay", `f${String(i++).padStart(4, "0")}.png`) });
  }
  await page.$eval("#scrub", (s) => { s.value = s.max; s.dispatchEvent(new Event("input")); });
  await cv.screenshot({ path: path.join(OUT, "replay-end.png") });

  // 오른쪽 패널(시스템·훈련·미션) 전체 화면 — crop-*.png는 여기서 잘라낸다
  for (const tab of ["sys", "drill", "mission"]) {
    await page.click(`[data-tab=${tab}]`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `tab-${tab}.png`) });
  }
  await page.click("[data-tab=sys]");
  await page.waitForTimeout(300);
  await cv.screenshot({ path: path.join(OUT, "sys-cv.png") });

  await browser.close();
})();
