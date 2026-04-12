import { chromium } from 'playwright';
const url = 'http://127.0.0.1:4178/';
const wav = '/Users/robertspaniolo/Documents/Github/fftron-sync/test-media/media/new-Redline (Remastered).wav';
const videos = [
  '/Users/robertspaniolo/Documents/Github/fftron-sync/test-media/media/A_mermaid_discovery_202601202346_ttgv4.mp4',
  '/Users/robertspaniolo/Documents/Github/fftron-sync/test-media/media/A_perfume_commercial_202601202342_i635d.mp4',
  '/Users/robertspaniolo/Documents/Github/fftron-sync/test-media/media/A_perfume_commercial_202601202342_s6l89.mp4',
  '/Users/robertspaniolo/Documents/Github/fftron-sync/test-media/media/Mermaid_discovery_perfume_202601242126_193yx.mp4'
];
const browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu','--use-angle=swiftshader-webgpu','--enable-features=Vulkan']});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', msg => console.log('BROWSER_CONSOLE', msg.type(), msg.text()));
page.on('request', req => { if (req.url().includes('essentia.v1su4.dev')) console.log('REQ', req.method(), req.url()); });
page.on('response', res => { if (res.url().includes('essentia.v1su4.dev')) console.log('RES', res.status(), res.url()); });
page.on('requestfailed', req => console.log('REQUEST_FAILED', req.url(), req.failure()?.errorText));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.setInputFiles('#track-file', wav);
await page.dispatchEvent('#track-file', 'change');
await page.setInputFiles('#video-upload', videos);
await page.dispatchEvent('#video-upload', 'change');
await page.click('button[aria-label="Play audio track"]');
await page.click('button[aria-label="Play selected clip"]');
const sample = async (label) => {
  const state = await page.evaluate(() => {
    const player = document.querySelector('video[playsinline]');
    const onsetMeter = document.querySelector('[data-testid="onset-progress-meter"]')?.textContent?.trim() ?? null;
    const switchNotice = document.querySelector('[data-testid="video-switch-notice"]')?.textContent?.trim() ?? null;
    const engineError = document.querySelector('[data-testid="webgpu-engine-error"]')?.textContent?.trim() ?? null;
    const timeshaper = document.querySelector('[data-testid="video-timeshaper-hud"]')?.textContent?.trim() ?? null;
    const body = document.body.innerText;
    return {
      videoCurrentTime: player?.currentTime ?? null,
      paused: player?.paused ?? null,
      readyState: player?.readyState ?? null,
      seeking: player?.seeking ?? null,
      playbackRate: player?.playbackRate ?? null,
      currentSrc: player?.currentSrc?.split('/').pop() ?? null,
      onsetMeter,
      switchNotice,
      engineError,
      timeshaper,
      bodySummary: body.includes('SWITCH ARMED') ? 'SWITCH_ARMED' : body.includes('Holding switch') ? 'HOLDING' : body.slice(0,220)
    };
  });
  console.log('STATE', label, JSON.stringify(state));
};
await sample('initial');
for (const [label, ms] of [['t+5s',5000],['t+15s',10000],['t+45s',30000],['t+75s',30000]]) {
  await page.waitForTimeout(ms);
  await sample(label);
}
await page.screenshot({ path: 'fftron-e2e-latest.png', fullPage: true });
await browser.close();
