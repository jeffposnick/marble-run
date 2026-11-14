// End-to-end PWA check against a production build.
//
//   npm run build && python3 -m http.server 4175 --directory dist &
//   node tools/pwa-check.cjs [http://localhost:4175/] [--update]
//
// Serve dist/ with a server that re-reads files on every request (as above). `vite preview`
// caches file metadata at startup, which breaks the --update check.
//
// Checks, in Chromium via Playwright:
//   1. The page is installable (no manifest/installability errors).
//   2. The service worker takes control and "Ready to work offline" is shown.
//   3. With the network off, a reload still serves the whole app, physics included, and a
//      marble can be dropped.
//   4. With --update: after dist/ is rebuilt with a change, an "Update" button appears, the old
//      version keeps running until it's chosen, and choosing it loads the new version.
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const url = process.argv.find((a) => a.startsWith("http")) || "http://localhost:4175/";
const testUpdate = process.argv.includes("--update");
let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failed = true;
};

const appReady = (page) => page.waitForSelector("#loading", { state: "hidden", timeout: 30000 });

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(url);
  await appReady(page);
  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send("Page.getAppManifest");
  check(
    !manifest.errors?.length,
    `manifest parses cleanly${manifest.errors?.length ? ": " + JSON.stringify(manifest.errors) : ""}`,
  );

  await page.waitForFunction(
    () =>
      document.getElementById("pwa-toast").matches(":popover-open") &&
      document.getElementById("pwa-text").textContent.includes("offline"),
    null,
    { timeout: 30000 },
  );
  check(true, 'service worker installed and "Ready to work offline" shown');
  const { installabilityErrors = [] } = await cdp.send("Page.getInstallabilityErrors");
  check(
    installabilityErrors.length === 0,
    `installable (${installabilityErrors.map((e) => e.errorId).join(", ") || "no errors"})`,
  );

  // Make sure this page is controlled before going offline.
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();

  await context.setOffline(true);
  await page.reload();
  await appReady(page);
  await page.click("#drop");
  await page.waitForFunction(
    () => document.getElementById("status").textContent === "Marble dropped",
    null,
    { timeout: 5000 },
  );
  // Software rendering in CI is slow, so give the marble plenty of time to reach the cup.
  const finished = await page
    .waitForFunction(
      () => document.getElementById("hud-finished").textContent !== "Finished: 0",
      null,
      { timeout: 60000 },
    )
    .then(
      () => true,
      () => false,
    );
  check(finished, "offline: physics engine loaded and a dropped marble reached the finish cup");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await context.setOffline(false);

  if (testUpdate) {
    // Ship a "new version": rebuild with a changed heading.
    const root = path.join(__dirname, "..");
    const html = path.join(root, "index.html");
    const original = fs.readFileSync(html, "utf8");
    try {
      fs.writeFileSync(html, original.replace("<h1>Marble Run</h1>", "<h1>Marble Run!</h1>"));
      execSync("npx vite build", { cwd: root, stdio: "ignore" });
    } finally {
      fs.writeFileSync(html, original);
    }
    try {
      await page.reload();
      await page.waitForSelector("#update", { state: "visible", timeout: 30000 });
      check(
        (await page.textContent("h1")) === "Marble Run",
        'new build detected: "Update" offered, old version keeps running until chosen',
      );
      await Promise.all([page.waitForEvent("load", { timeout: 15000 }), page.click("#update")]);
      await page.waitForSelector("h1");
      const heading = await page.textContent("h1");
      check(heading === "Marble Run!", `after choosing Update the new version runs ("${heading}")`);
    } finally {
      execSync("npx vite build", { cwd: root, stdio: "ignore" }); // restore the real build
    }
  }

  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
