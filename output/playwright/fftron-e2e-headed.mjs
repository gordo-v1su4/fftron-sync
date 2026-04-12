import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu']});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:4178/', { waitUntil: 'domcontentloaded', timeout: 30000 });
console.log('OPENED', await page.title());
await page.waitForTimeout(3000);
await browser.close();
