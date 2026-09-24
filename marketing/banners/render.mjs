// Renders every <section class="banner"> in banners.html to marketing/banners/png/<id>.png at 2×.
// Usage: node marketing/banners/render.mjs   (needs Playwright, local or global: npm i -g playwright)
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

// Playwright from the project, or from the global npm folder.
async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const root = execSync("npm root -g").toString().trim();
    return import(pathToFileURL(join(root, "playwright", "index.mjs")).href);
  }
}
const { chromium } = await loadPlaywright();

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "png");
const names = {
  intro: "01-introduction",
  features: "02-features",
  chat: "03-chat",
  compare: "04-compare",
  api: "05-api",
  telegram: "06-telegram",
  header: "x-header-1500x500",
};

await mkdir(out, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(join(here, "banners.html")).href);
await page.evaluate(() => document.fonts.ready);
for (const id of await page.$$eval("section.banner", (els) => els.map((e) => e.id))) {
  const file = join(out, `${names[id] ?? id}.png`);
  await page.locator(`#${id}`).screenshot({ path: file });
  console.log(file);
}
await browser.close();
