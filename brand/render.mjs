// Render SVG files to PNG with Chromium. Called by build.py with a JSON list of
// [svgPath, pngPath, width, height, transparent]. playwright-core is not a project dependency:
// install it anywhere and point PLAYWRIGHT_CORE at its entry file, or `npm i playwright-core` here.
import { readFileSync } from "node:fs";

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || "playwright-core");

const jobs = JSON.parse(process.argv[2]);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium",
});
const page = await browser.newPage();
for (const [svg, png, width, height, transparent] of jobs) {
  await page.setViewportSize({ width, height });
  if (svg.endsWith(".html")) {
    // A full page (the brand sheet): load it from disk so its local fonts resolve.
    await page.goto(`file://${svg}`);
    await page.evaluate(() => document.fonts.ready);
  } else {
    const markup = readFileSync(svg, "utf8").replace("<svg ", `<svg width="${width}" height="${height}" `);
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${markup}</body></html>`,
    );
  }
  await page.screenshot({ path: png, omitBackground: transparent, clip: { x: 0, y: 0, width, height } });
}
await browser.close();
