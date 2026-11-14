// Captures the install-dialog screenshots in public/screenshots/.
// Run the dev server first (npm run dev -- --port 5174), then:
//   node tools/icons/screenshots.cjs [http://localhost:5174/]
const { chromium, devices } = require("playwright");
const path = require("path");

const url = process.argv[2] || "http://localhost:5174/";
const out = path.join(__dirname, "..", "..", "public", "screenshots");
const shots = [
  ["wide.png", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
  [
    "narrow.png",
    { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
  ],
];

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader"] });
  for (const [name, options] of shots) {
    const context = await browser.newContext({ ...options, colorScheme: "light" });
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForSelector("#loading", { state: "hidden", timeout: 30000 });
    // Drop a stream of marbles so the run looks busy, then catch them mid-run.
    for (let i = 0; i < 4; i++) {
      await page.click("#drop");
      await page.waitForTimeout(700);
    }
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      document.getElementById("status").textContent = "";
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, name) });
    console.log("wrote", name);
    await context.close();
  }
  await browser.close();
})();
