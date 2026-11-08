import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import m from '/home/pranav/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const brainDir = '/home/pranav/.gemini/antigravity/brain/3589e523-fba5-4dc3-b6cb-6705b01c05d6';
const framesDir = path.join(root, '.capture_frames');

if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

const PORT = 8097;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let reqPath = req.url.split('?')[0];
      if (reqPath === '/') reqPath = '/index.html';
      const filePath = path.join(distDir, reqPath);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*'
        });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function run() {
  console.log('--- Starting Visual Proof Capture ---');
  const server = await startServer();
  const browser = await m.chromium.launch({
    headless: true,
    executablePath: '/usr/bin/chromium'
  });

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1
  });

  console.log('Navigating to http://localhost:' + PORT + '/ ...');
  await page.goto(`http://localhost:${PORT}/`);

  let frameIndex = 0;
  async function grabFrame() {
    const padded = String(frameIndex++).padStart(3, '0');
    const fPath = path.join(framesDir, `frame-${padded}.png`);
    await page.screenshot({ path: fPath, type: 'png' });
  }

  const milestones = {
    burst: false,
    hero: false,
    blueprint: false,
    section: false,
    bottom: false,
    complete: false
  };

  const startTime = Date.now();
  while (Date.now() - startTime < 16000) {
    const elapsed = Date.now() - startTime;
    const scrollInfo = await page.evaluate(() => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      return {
        y: window.scrollY,
        max: maxScroll,
        complete: document.body.classList.contains('cinematic-complete')
      };
    });

    await grabFrame();

    if (!milestones.burst && elapsed >= 200) {
      milestones.burst = true;
      await page.screenshot({ path: path.join(root, 'swarm-initial-burst.png') });
      console.log('  Captured: swarm-initial-burst.png (t=' + elapsed + 'ms)');
    } else if (!milestones.hero && elapsed >= 950) {
      milestones.hero = true;
      await page.screenshot({ path: path.join(root, 'swarm-hero-assembly.png') });
      console.log('  Captured: swarm-hero-assembly.png (t=' + elapsed + 'ms)');
    } else if (!milestones.blueprint && elapsed >= 1650) {
      milestones.blueprint = true;
      await page.screenshot({ path: path.join(root, 'swarm-blueprint-drag.png') });
      console.log('  Captured: swarm-blueprint-drag.png (t=' + elapsed + 'ms)');
    } else if (!milestones.section && scrollInfo.y > 1500) {
      milestones.section = true;
      await page.screenshot({ path: path.join(root, 'swarm-section-tour.png') });
      console.log('  Captured: swarm-section-tour.png (scrollY=' + Math.round(scrollInfo.y) + ')');
    } else if (!milestones.bottom && scrollInfo.y >= scrollInfo.max - 80) {
      milestones.bottom = true;
      await page.screenshot({ path: path.join(root, 'swarm-bottom-snap.png') });
      console.log('  Captured: swarm-bottom-snap.png (bottom reached)');
    } else if (scrollInfo.complete) {
      milestones.complete = true;
      await new Promise(r => setTimeout(r, 400));
      await page.screenshot({ path: path.join(root, 'swarm-normal-browsing.png') });
      console.log('  Captured: swarm-normal-browsing.png (cinematic complete)');
      break;
    }

    await new Promise(r => setTimeout(r, 220));
  }

  // Mobile captures
  console.log('Capturing mobile viewports...');
  const mobile390 = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile390.goto(`http://localhost:${PORT}/`);
  await new Promise(r => setTimeout(r, 600));
  await mobile390.screenshot({ path: path.join(root, 'swarm-mobile-390.png') });
  console.log('  Captured: swarm-mobile-390.png');
  await mobile390.close();

  const mobile430 = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  await mobile430.goto(`http://localhost:${PORT}/`);
  await new Promise(r => setTimeout(r, 600));
  await mobile430.screenshot({ path: path.join(root, 'swarm-mobile-430.png') });
  console.log('  Captured: swarm-mobile-430.png');
  await mobile430.close();

  await browser.close();
  server.close();

  // Compile animated WebP walkthrough
  console.log('Compiling cinematic-multiagent-tour.webp...');
  try {
    execSync(`ffmpeg -y -framerate 4 -i "${framesDir}/frame-%03d.png" -vf "scale=1080:-1:flags=lanczos" -loop 0 -c:v libwebp_anim -lossless 0 -compression_level 4 -q:v 75 "${path.join(root, 'cinematic-multiagent-tour.webp')}"`, { stdio: 'inherit' });
    console.log('Compiled: cinematic-multiagent-tour.webp');
  } catch (err) {
    console.warn('ffmpeg conversion note:', err.message);
  }

  // Copy deliverables to artifacts dir
  const deliverables = [
    'swarm-initial-burst.png',
    'swarm-hero-assembly.png',
    'swarm-blueprint-drag.png',
    'swarm-section-tour.png',
    'swarm-bottom-snap.png',
    'swarm-normal-browsing.png',
    'swarm-mobile-390.png',
    'swarm-mobile-430.png',
    'cinematic-multiagent-tour.webp'
  ];

  for (const file of deliverables) {
    const src = path.join(root, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(brainDir, file));
      console.log(`  Copied ${file} to artifacts directory.`);
    }
  }

  console.log('Visual proof capture completed successfully!');
}

run().catch(err => {
  console.error('Visual capture failed:', err);
  process.exit(1);
});
