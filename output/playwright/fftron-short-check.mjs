import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const wav = '/Users/robertspaniolo/Documents/Github/fftron-sync/test-media/media/new-Redline (Remastered).wav';
const videos = [
  '/Users/robertspaniolo/Documents/Github/fftron-sync/test-media/media/A_mermaid_discovery_202601202346_ttgv4.mp4',
  '/Users/robertspaniolo/Documents/Github/fftron-sync/test-media/media/A_perfume_commercial_202601202342_i635d.mp4',
  '/Users/robertspaniolo/Documents/Github/fftron-sync/test-media/media/A_perfume_commercial_202601202342_s6l89.mp4',
  '/Users/robertspaniolo/Documents/Github/fftron-sync/test-media/media/Mermaid_discovery_perfume_202601242126_193yx.mp4'
];
await page.goto('http://127.0.0.1:4178/', { waitUntil: 'networkidle', timeout: 60000 });
await page.setInputFiles('#track-file', wav);
await page.dispatchEvent('#track-file', 'change');
await page.setInputFiles('#video-upload', videos);
await page.dispatchEvent('#video-upload', 'change');
await page.click('button[aria-label="Play audio track"]');
await page.click('button[aria-label="Play selected clip"]');
await page.waitForTimeout(5000);
const state = await page.evaluate(() => {
  const player = document.querySelector('video[playsinline]');
  const canvas = document.querySelector('canvas[aria-label="WebGPU deck presenter"]');
  const error = document.querySelector('[data-testid="webgpu-engine-error"]')?.textContent?.trim() ?? null;
  const body = document.body.innerText;
  return {
    paused: player?.paused ?? null,
    currentTime: player?.currentTime ?? null,
    hasCanvas: !!canvas,
    canvasHidden: canvas ? getComputedStyle(canvas).display === 'none' : null,
    videoHidden: player ? getComputedStyle(player).opacity === '0' : null,
    error,
    bodyHasWebgpuActive: body.includes('Engine active: WEBGPU'),
    bodyHasWebgl2: body.includes('Engine active: WEBGL2'),
  };
});
console.log(JSON.stringify(state, null, 2));
await browser.close();
