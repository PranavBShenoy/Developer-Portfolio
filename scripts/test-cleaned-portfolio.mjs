import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import playwright from '/home/pranav/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const brainDir = '/home/pranav/.gemini/antigravity/brain/3589e523-fba5-4dc3-b6cb-6705b01c05d6';

const PORT = 8094;
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

const failures = [];
function pass(cond, msg) {
  if (cond) {
    console.log(`  PASS: ${msg}`);
  } else {
    console.error(`  FAIL: ${msg}`);
    failures.push(msg);
  }
}

async function run() {
  console.log('--- Starting Cleaned Portfolio & Cinematic Intro Verification ---');
  const server = await startServer();
  const browser = await playwright.chromium.launch({
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();

    // 1. Verify complete absence of developer controls in DOM
    console.log('\n--- 1. Testing Absolute Removal of Developer Controls in Production ---');
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });

    const dock = await page.$('.canvas-dock');
    pass(dock === null, '.canvas-dock element is completely removed from DOM');

    const activityPanel = await page.$('.agent-activity-panel');
    pass(activityPanel === null, '.agent-activity-panel element is completely removed from DOM');

    const constructionStatus = await page.$('.construction-status');
    pass(constructionStatus === null, '.construction-status element is completely removed from DOM');

    const replayBtn = await page.$('#replay-build');
    pass(replayBtn === null, '#replay-build button is completely removed from DOM');

    const soundToggle = await page.$('#sound-toggle');
    pass(soundToggle === null, '#sound-toggle button is completely removed from DOM');

    const motionMode = await page.$('#motion-mode');
    pass(motionMode === null, '#motion-mode button is completely removed from DOM');

    const activityCollapse = await page.$('#activity-collapse');
    pass(activityCollapse === null, '#activity-collapse button is completely removed from DOM');

    const countOptions = await page.$$('[data-count-choice]');
    pass(countOptions.length === 0, 'No cursor count selectors exist (count: 0)');

    const modeOptions = await page.$$('[data-mode-choice]');
    pass(modeOptions.length === 0, 'No animation mode selectors exist (count: 0)');

    const dockPhase = await page.$('#dock-phase');
    pass(dockPhase === null, '#dock-phase element is completely removed from DOM');

    const inspectToggle = await page.$('#inspect-toggle');
    pass(inspectToggle === null, '#inspect-toggle is completely stripped from production output');

    const inspectDrawer = await page.$('#inspect-drawer');
    pass(inspectDrawer === null, '#inspect-drawer is completely stripped from production output');

    // 2. Full Automatic Cinematic Intro Verification
    console.log('\n--- 2. Testing Coordinated Cinematic Intro Lifecycle ---');
    // Refresh to observe from t=0
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });

    // Initial state: page starts at top
    const initialScrollY = await page.evaluate(() => window.scrollY);
    pass(initialScrollY === 0, 'Page loads with scroll position at top (scrollY === 0)');

    const canvasVisibleOnStart = await page.evaluate(() => {
      const c = document.querySelector('#construction-canvas');
      return c && getComputedStyle(c).opacity !== '0';
    });
    pass(canvasVisibleOnStart, 'Construction canvas is active on initial load');

    // Wait for Phase 2: Tour down scrolling starts
    console.log('  Waiting for Phase 2 (tour-down scroll)...');
    await page.waitForFunction(() => window.scrollY > 200, { timeout: 12000 });
    const midScrollY = await page.evaluate(() => window.scrollY);
    pass(midScrollY > 200, `Automated smooth scrolling is actively progressing (scrollY: ${Math.round(midScrollY)}px)`);

    // Wait for Phase 4: Bottom reached
    console.log('  Waiting for Phase 4 (bottom reached)...');
    await page.waitForFunction(() => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      return window.scrollY >= maxScroll - 50;
    }, { timeout: 15000 });

    const bottomScrollY = await page.evaluate(() => window.scrollY);
    const maxScrollY = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    pass(bottomScrollY >= maxScrollY - 50, `Successfully reached bottom of document (scrollY: ${Math.round(bottomScrollY)} / ${Math.round(maxScrollY)})`);

    // Wait for Phase 5 & 6: Smooth return to top and complete shutdown
    console.log('  Waiting for Phase 5 & 6 (smooth return to top & normal browsing complete)...');
    await page.waitForFunction(() => {
      return document.body.classList.contains('cinematic-complete') && window.scrollY <= 10;
    }, { timeout: 15000 });

    const finalScrollY = await page.evaluate(() => window.scrollY);
    pass(finalScrollY <= 10, `Smoothly returned back to top of page (scrollY: ${Math.round(finalScrollY)}px)`);

    const cinematicComplete = await page.evaluate(() => document.body.classList.contains('cinematic-complete'));
    pass(cinematicComplete, 'body has class "cinematic-complete"');

    const canvasHidden = await page.evaluate(() => {
      const c = document.querySelector('#construction-canvas');
      const style = getComputedStyle(c);
      return style.opacity === '0' && style.pointerEvents === 'none';
    });
    pass(canvasHidden, 'Simulated cursor canvas has opacity: 0 and pointer-events: none (completely hidden)');

    const allSectionsBuilt = await page.evaluate(() => {
      const sections = [...document.querySelectorAll('main > [data-build-section], footer[data-build-section]')];
      return sections.length > 0 && sections.every(s => s.classList.contains('section-built'));
    });
    pass(allSectionsBuilt, 'All portfolio sections are built and visible in normal browsing');

    // 3. User Interruption Test
    console.log('\n--- 3. Testing Immediate Graceful Interruption on User Interaction ---');
    const page2 = await context.newPage();
    await page2.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page2.waitForTimeout(500);

    // Verify it was active
    const activeBefore = await page2.evaluate(() => !document.body.classList.contains('cinematic-complete'));
    pass(activeBefore, 'Intro was active before user interruption');

    // User scrolls with mouse wheel
    await page2.mouse.wheel(0, 150);
    await page2.waitForTimeout(200);

    const completeAfter = await page2.evaluate(() => document.body.classList.contains('cinematic-complete'));
    pass(completeAfter, 'Wheel interaction immediately halts intro and transitions to normal browsing');

    const canvasHalted = await page2.evaluate(() => {
      const c = document.querySelector('#construction-canvas');
      return getComputedStyle(c).opacity === '0';
    });
    pass(canvasHalted, 'Canvas is shut down immediately upon interruption');
    await page2.close();

    // 4. Reduced Motion Test (Desktop & Mobile)
    console.log('\n--- 4. Testing Reduced Motion Accessibility ---');
    const reducedContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce'
    });
    const reducedPage = await reducedContext.newPage();
    await reducedPage.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await reducedPage.waitForTimeout(200);

    const reducedComplete = await reducedPage.evaluate(() => document.body.classList.contains('cinematic-complete'));
    pass(reducedComplete, 'Prefers-reduced-motion bypasses cursor intro immediately on desktop');

    const reducedCanvasHidden = await reducedPage.evaluate(() => {
      const c = document.querySelector('#construction-canvas');
      return getComputedStyle(c).opacity === '0';
    });
    pass(reducedCanvasHidden, 'Construction canvas is completely dormant and hidden under reduced motion');
    await reducedContext.close();

    const mobileReducedContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: 'reduce'
    });
    const mobileReducedPage = await mobileReducedContext.newPage();
    await mobileReducedPage.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await mobileReducedPage.waitForTimeout(200);
    const mobileReducedComplete = await mobileReducedPage.evaluate(() => document.body.classList.contains('cinematic-complete'));
    pass(mobileReducedComplete, 'Prefers-reduced-motion bypasses cursor intro immediately on mobile');
    await mobileReducedContext.close();

    // 5. Mobile Cinematic Intro Lifecycle & Touch Responsiveness (360px, 390px, 430px)
    console.log('\n--- 5. Testing Mobile Cinematic Intro Lifecycle & Responsiveness ---');
    for (const width of [360, 390, 430]) {
      console.log(`\n  Checking viewport: ${width}px width...`);
      const mobileContext = await browser.newContext({
        viewport: { width, height: 844 },
        hasTouch: true,
        isMobile: true
      });
      const mobilePage = await mobileContext.newPage();
      await mobilePage.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });

      // Verify intro starts automatically on mobile
      const startsActive = await mobilePage.evaluate(() => {
        return !document.body.classList.contains('cinematic-complete');
      });
      pass(startsActive, `${width}px mobile: Cinematic intro starts automatically on fresh page load`);

      const canvasActiveMobile = await mobilePage.evaluate(() => {
        const c = document.querySelector('#construction-canvas');
        return c && getComputedStyle(c).opacity !== '0';
      });
      pass(canvasActiveMobile, `${width}px mobile: Canvas is actively rendering intro animation`);

      // Verify no horizontal overflow during active intro
      const hasHorizOverflowStart = await mobilePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      pass(!hasHorizOverflowStart, `${width}px mobile: Zero horizontal overflow during intro (scrollWidth <= innerWidth)`);

      // Test mobile touch interruption
      await mobilePage.touchscreen.tap(width / 2, 400);
      await mobilePage.waitForTimeout(200);

      const interruptedComplete = await mobilePage.evaluate(() => document.body.classList.contains('cinematic-complete'));
      pass(interruptedComplete, `${width}px mobile: Touch tap immediately hands control back to website (cinematic-complete)`);

      const canvasShutDown = await mobilePage.evaluate(() => {
        const c = document.querySelector('#construction-canvas');
        return getComputedStyle(c).opacity === '0';
      });
      pass(canvasShutDown, `${width}px mobile: Canvas stops and hides immediately upon touch interruption`);

      // Verify no horizontal overflow after interruption
      const hasHorizOverflowEnd = await mobilePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      pass(!hasHorizOverflowEnd, `${width}px mobile: Zero horizontal overflow after handoff (scrollWidth <= innerWidth)`);

      const footerPadding = await mobilePage.evaluate(() => {
        const f = document.querySelector('.footer');
        return parseInt(getComputedStyle(f).paddingBottom, 10);
      });
      pass(footerPadding <= 30, `${width}px mobile: Footer has normal clean bottom padding (${footerPadding}px)`);

      // Test mobile menu navigation
      await mobilePage.click('.menu-toggle');
      const navOpen = await mobilePage.evaluate(() => document.querySelector('.topbar').classList.contains('nav-open'));
      pass(navOpen, `${width}px mobile: Menu toggle successfully opens mobile navigation`);

      await mobilePage.close();
      await mobileContext.close();
    }

    // 5b. Full Autonomous Mobile Cinematic Intro Playthrough (390px)
    console.log('\n--- 5b. Full Autonomous Mobile Cinematic Intro Playthrough (390px) ---');
    const mobPlayContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true
    });
    const mobPlayPage = await mobPlayContext.newPage();
    await mobPlayPage.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });

    console.log('  Waiting for mobile Phase 2 (tour-down scroll)...');
    await mobPlayPage.waitForFunction(() => window.scrollY > 150, { timeout: 15000 });
    const mobMidScroll = await mobPlayPage.evaluate(() => window.scrollY);
    pass(mobMidScroll > 150, `Mobile automated tour-down scroll is progressing (scrollY: ${Math.round(mobMidScroll)}px)`);

    console.log('  Waiting for mobile Phase 4 (bottom reached)...');
    await mobPlayPage.waitForFunction(() => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      return window.scrollY >= maxScroll - 50;
    }, { timeout: 15000 });
    const mobBottomScroll = await mobPlayPage.evaluate(() => window.scrollY);
    pass(mobBottomScroll > 500, `Mobile reached bottom of page (scrollY: ${Math.round(mobBottomScroll)}px)`);

    console.log('  Waiting for mobile Phase 5 & 6 (return to top & cinematic-complete)...');
    await mobPlayPage.waitForFunction(() => {
      return document.body.classList.contains('cinematic-complete') && window.scrollY <= 10;
    }, { timeout: 15000 });
    const mobFinalScroll = await mobPlayPage.evaluate(() => window.scrollY);
    pass(mobFinalScroll <= 10, `Mobile returned to top cleanly (scrollY: ${Math.round(mobFinalScroll)}px)`);

    const mobComplete = await mobPlayPage.evaluate(() => document.body.classList.contains('cinematic-complete'));
    pass(mobComplete, 'Mobile body has class "cinematic-complete" after full intro');

    // Verify it doesn't replay in a loop
    await mobPlayPage.waitForTimeout(1000);
    const stillComplete = await mobPlayPage.evaluate(() => document.body.classList.contains('cinematic-complete') && window.scrollY <= 10);
    pass(stillComplete, 'Mobile intro does not loop or replay after finishing');

    await mobPlayPage.close();
    await mobPlayContext.close();

    // 6. Screenshot Capture
    console.log('\n--- 6. Capturing Fresh Screenshots of Cleaned Website ---');
    // Desktop Hero
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const heroShot = path.join(root, 'cleaned-desktop-hero.png');
    await page.screenshot({ path: heroShot });
    fs.copyFileSync(heroShot, path.join(brainDir, 'cleaned-desktop-hero.png'));
    console.log(`  Saved: ${heroShot}`);

    // Desktop Projects
    await page.evaluate(() => document.querySelector('#projects').scrollIntoView());
    await page.waitForTimeout(300);
    const projectsShot = path.join(root, 'cleaned-desktop-projects.png');
    await page.screenshot({ path: projectsShot });
    fs.copyFileSync(projectsShot, path.join(brainDir, 'cleaned-desktop-projects.png'));
    console.log(`  Saved: ${projectsShot}`);

    // Desktop Footer (verifying clean bottom without dock)
    await page.evaluate(() => document.querySelector('.footer').scrollIntoView());
    await page.waitForTimeout(300);
    const footerShot = path.join(root, 'cleaned-desktop-footer.png');
    await page.screenshot({ path: footerShot });
    fs.copyFileSync(footerShot, path.join(brainDir, 'cleaned-desktop-footer.png'));
    console.log(`  Saved: ${footerShot}`);

    // Mobile 390px
    const mob390Context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true
    });
    const mob390Page = await mob390Context.newPage();
    await mob390Page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await mob390Page.waitForTimeout(300);
    const mob390Shot = path.join(root, 'cleaned-mobile-390.png');
    await mob390Page.screenshot({ path: mob390Shot });
    fs.copyFileSync(mob390Shot, path.join(brainDir, 'cleaned-mobile-390.png'));
    console.log(`  Saved: ${mob390Shot}`);
    await mob390Page.close();
    await mob390Context.close();

    // Mobile 430px
    const mob430Context = await browser.newContext({
      viewport: { width: 430, height: 932 },
      hasTouch: true,
      isMobile: true
    });
    const mob430Page = await mob430Context.newPage();
    await mob430Page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await mob430Page.waitForTimeout(300);
    const mob430Shot = path.join(root, 'cleaned-mobile-430.png');
    await mob430Page.screenshot({ path: mob430Shot });
    fs.copyFileSync(mob430Shot, path.join(brainDir, 'cleaned-mobile-430.png'));
    console.log(`  Saved: ${mob430Shot}`);
    await mob430Page.close();
    await mob430Context.close();

    await context.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n========================================================================');
  if (failures.length) {
    console.error(`CLEANUP VERIFICATION FAILED: ${failures.length} errors\n- ${failures.join('\n- ')}`);
    process.exit(1);
  } else {
    console.log('ALL CLEANUP & CINEMATIC INTRO VERIFICATIONS PASSED WITH 0 FAILURES!');
    console.log('========================================================================');
  }
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
