// Renders tools/icons/icon.svg to the PNG app icons in public/.
// Needs Playwright with Chromium:  node tools/icons/render.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const svg = fs.readFileSync(path.join(__dirname, "icon.svg"), "utf8");
const out = path.join(__dirname, "..", "..", "public");
const targets = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  // Maskable: the art shrinks into the 80% safe zone while the background bleeds to the edge.
  ["icon-maskable-512.png", 512, 0.8],
  ["apple-touch-icon.png", 180],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, size, artScale = 1] of targets) {
    await page.setViewportSize({ width: size, height: size });
    let src = svg;
    if (artScale !== 1) {
      const offset = (512 * (1 - artScale)) / 2;
      src = src.replace(
        '<g id="art">',
        `<g id="art" transform="translate(${offset} ${offset}) scale(${artScale})">`,
      );
    }
    const sized = src.replace("<svg ", `<svg width="${size}" height="${size}" `);
    await page.setContent(
      `<html><body style="margin:0;width:${size}px;height:${size}px;overflow:hidden">${sized}</body></html>`,
    );
    await page.screenshot({ path: path.join(out, name) });
    console.log("wrote", name);
  }
  await browser.close();
})();
