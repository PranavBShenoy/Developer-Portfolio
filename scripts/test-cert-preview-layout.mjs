// scripts/test-cert-preview-layout.mjs
// Verification suite for Certifications Manager certificate preview layout
// Tests container containment, object-fit: contain, aspect ratio preservation,
// and zero horizontal overflow across desktop, tablet, and mobile breakpoints.

import playwright from '/home/pranav/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js';
import assert from 'node:assert';
import path from 'node:path';

const PORT = 3000;
let passed = 0;
let failed = 0;

function pass(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✓ PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
}

// Mock certificates with various aspect ratios
const MOCK_CERTS = [
  {
    entity_id: 'cert-landscape',
    title: 'AWS Certified Solutions Architect — Professional',
    issuer: 'Amazon Web Services Global Training & Certification',
    display_order: 1,
    mark: '▲',
    status: 'published',
    credential_url: 'https://aws.amazon.com/verification/prof-12345',
    date: 'MAR 2026',
    // 16:9 landscape SVG (1600x900)
    certificate_image_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="%231a365d"/><text x="800" y="450" fill="%23ffffff" font-size="64" font-family="sans-serif" text-anchor="middle">AWS LANDSCAPE (16:9 - 1600x900)</text></svg>'
  },
  {
    entity_id: 'cert-portrait',
    title: 'Deep Learning Specialization Honors Graduate',
    issuer: 'DeepLearning.AI in collaboration with Stanford University',
    display_order: 2,
    mark: '■',
    status: 'draft',
    credential_url: 'https://coursera.org/verify/dl-honors',
    date: 'FEB 2026',
    // 2:3 portrait SVG (800x1200)
    certificate_image_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200" viewBox="0 0 800 1200"><rect width="800" height="1200" fill="%232d3748"/><text x="400" y="600" fill="%23ffffff" font-size="44" font-family="sans-serif" text-anchor="middle">PORTRAIT (2:3 - 800x1200)</text></svg>'
  },
  {
    entity_id: 'cert-square',
    title: 'Certified Kubernetes Administrator (CKA Badge)',
    issuer: 'The Linux Foundation / CNCF',
    display_order: 3,
    mark: '◈',
    status: 'published',
    credential_url: 'https://cncf.io/verify/cka-999',
    date: 'JAN 2026',
    // 1:1 square SVG (1000x1000)
    certificate_image_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="%23319795"/><text x="500" y="500" fill="%23ffffff" font-size="52" font-family="sans-serif" text-anchor="middle">SQUARE (1:1 - 1000x1000)</text></svg>'
  },
  {
    entity_id: 'cert-no-img',
    title: 'National Collegiate Cyber Defense Competition',
    issuer: 'Collegiate Cyber Defense Alliance',
    display_order: 4,
    mark: '↗',
    status: 'published',
    credential_url: 'https://example.com/ccdc',
    date: '2025',
    certificate_image_url: null
  }
];

async function setupPageRoutes(page) {
  await page.route('**/api/admin/auth/me', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: { email: 'admin@portfolio.local' } })
    });
  });

  await page.route('**/api/admin/content/preview', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        settings: { profile_name: 'Pranav Shenoy', site_title: 'Developer Portfolio' },
        projects: [],
        skill_categories: [],
        skills: [],
        experiences: [],
        certifications: MOCK_CERTS,
        media_assets: []
      })
    });
  });

  await page.route('**/api/admin/audit-logs', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route('**/api/admin/media/upload', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        media: {
          entity_id: 'uploaded-media-123',
          filename: 'new-uploaded-certificate.png'
        }
      })
    });
  });
}

async function run() {
  console.log('========================================================================');
  console.log('STARTING CERTIFICATIONS MANAGER PREVIEW & LAYOUT VERIFICATION');
  console.log('========================================================================\n');

  const browser = await playwright.chromium.launch({
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const viewports = [
    { name: 'desktop-1440', width: 1440, height: 900, isMobile: false },
    { name: 'desktop-1024', width: 1024, height: 768, isMobile: false },
    { name: 'tablet-768', width: 768, height: 1024, isMobile: true },
    { name: 'mobile-430', width: 430, height: 932, isMobile: true },
    { name: 'mobile-390', width: 390, height: 844, isMobile: true }
  ];

  try {
    for (const vp of viewports) {
      console.log(`\n--- Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);

      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', err => pageErrors.push(err.message));

      await setupPageRoutes(page);
      await page.goto(`http://127.0.0.1:${PORT}/admin`, { waitUntil: 'networkidle' });

      // Navigate to Certifications tab
      if (vp.isMobile) {
        // Toggle mobile sidebar if needed
        const sidebarOpen = await page.evaluate(() => document.getElementById('admin-sidebar').classList.contains('open'));
        if (!sidebarOpen) {
          await page.click('#sidebar-toggle');
          await page.waitForTimeout(200);
        }
      }
      await page.click('button[data-tab="certifications"]');
      await page.waitForTimeout(300);

      pass(pageErrors.length === 0, `[${vp.name}] Zero JS errors on navigation`);

      // 1. Verify Table and Page Zero Horizontal Overflow
      const overflowMetrics = await page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        const pane = document.getElementById('pane-certifications');
        const table = document.getElementById('table-certifications');
        return {
          docScrollWidth: doc.scrollWidth,
          docClientWidth: doc.clientWidth,
          bodyScrollWidth: body.scrollWidth,
          bodyClientWidth: body.clientWidth,
          paneScrollWidth: pane.scrollWidth,
          paneClientWidth: pane.clientWidth,
          hasDocOverflow: doc.scrollWidth > doc.clientWidth,
          hasBodyOverflow: body.scrollWidth > body.clientWidth
        };
      });

      pass(!overflowMetrics.hasDocOverflow, `[${vp.name}] Document has zero horizontal overflow (scrollWidth <= clientWidth)`);
      pass(!overflowMetrics.hasBodyOverflow, `[${vp.name}] Body has zero horizontal overflow (scrollWidth <= clientWidth)`);

      // 2. Verify Table Thumbnail Rendering & Aspect Ratio
      const tableThumbMetrics = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#table-certifications tbody tr')];
        return rows.map(r => {
          const img = r.querySelector('.cert-thumb-img');
          const noImg = r.querySelector('.cert-thumb-box');
          const title = r.querySelector('strong')?.textContent;
          if (img) {
            const rect = img.getBoundingClientRect();
            const comp = window.getComputedStyle(img);
            return {
              hasImg: true,
              title,
              width: rect.width,
              height: rect.height,
              objectFit: comp.objectFit,
              maxWidth: comp.maxWidth
            };
          }
          return {
            hasImg: false,
            title,
            noImgText: noImg?.textContent?.trim()
          };
        });
      });

      pass(tableThumbMetrics.length === 4, `[${vp.name}] All 4 certification rows rendered`);
      pass(tableThumbMetrics[0].hasImg && tableThumbMetrics[0].objectFit === 'contain', `[${vp.name}] Landscape thumb uses object-fit: contain`);
      pass(tableThumbMetrics[1].hasImg && tableThumbMetrics[1].objectFit === 'contain', `[${vp.name}] Portrait thumb uses object-fit: contain`);
      pass(tableThumbMetrics[2].hasImg && tableThumbMetrics[2].objectFit === 'contain', `[${vp.name}] Square thumb uses object-fit: contain`);
      pass(!tableThumbMetrics[3].hasImg && tableThumbMetrics[3].noImgText === 'NO IMG', `[${vp.name}] Text-only cert renders clean NO IMG thumbnail box`);

      // Ensure thumbnails never exceed their thumbnail box width/height
      for (const t of tableThumbMetrics.filter(x => x.hasImg)) {
        pass(t.width <= 48 && t.height <= 36, `[${vp.name}] Thumbnail for "${t.title.slice(0, 20)}..." fits in 48x36 box (${Math.round(t.width)}x${Math.round(t.height)})`);
      }

      // 3. Test Landscape Certificate in Modal
      console.log(`  Checking Landscape Certificate Modal on ${vp.name}...`);
      await page.click('button.btn-edit-cert[data-id="cert-landscape"]');
      await page.waitForTimeout(300);

      const modalLandscape = await page.evaluate(() => {
        const modal = document.getElementById('admin-modal');
        const content = modal.querySelector('.modal-content');
        const card = document.getElementById('cert-img-card');
        const wrap = card?.querySelector('.cert-preview-wrap');
        const img = document.getElementById('cert-img-preview');
        const imgRect = img ? img.getBoundingClientRect() : null;
        const wrapRect = wrap ? wrap.getBoundingClientRect() : null;
        const contentRect = content.getBoundingClientRect();
        const compImg = img ? window.getComputedStyle(img) : null;

        return {
          modalOpen: modal.open,
          contentClientWidth: content.clientWidth,
          contentScrollWidth: content.scrollWidth,
          contentHasOverflow: content.scrollWidth > content.clientWidth,
          cardScrollWidth: card?.scrollWidth,
          cardClientWidth: card?.clientWidth,
          cardHasOverflow: card ? card.scrollWidth > card.clientWidth : false,
          imgWidth: imgRect?.width,
          imgHeight: imgRect?.height,
          wrapWidth: wrapRect?.width,
          wrapHeight: wrapRect?.height,
          imgWithinWrap: imgRect && wrapRect ? (imgRect.width <= wrapRect.width + 1 && imgRect.height <= wrapRect.height + 1) : false,
          objectFit: compImg?.objectFit,
          naturalAspect: 16 / 9,
          renderedAspect: imgRect ? imgRect.width / imgRect.height : 0
        };
      });

      pass(modalLandscape.modalOpen, `[${vp.name}] Modal opened for Landscape certificate`);
      pass(!modalLandscape.contentHasOverflow, `[${vp.name}] Modal content has zero horizontal overflow with Landscape cert`);
      pass(!modalLandscape.cardHasOverflow, `[${vp.name}] cert-img-card has zero horizontal overflow with Landscape cert`);
      pass(modalLandscape.imgWithinWrap, `[${vp.name}] Landscape preview image strictly contained within cert-preview-wrap`);
      pass(modalLandscape.objectFit === 'contain', `[${vp.name}] Landscape preview uses object-fit: contain`);
      // Aspect ratio check (16:9 = 1.777)
      const landscapeAspectDiff = Math.abs(modalLandscape.renderedAspect - (16 / 9));
      pass(landscapeAspectDiff < 0.05, `[${vp.name}] Landscape aspect ratio preserved (rendered ${modalLandscape.renderedAspect.toFixed(2)} vs target ${(16 / 9).toFixed(2)})`);

      // Capture screenshot artifact for visual report
      await page.screenshot({
        path: `/home/pranav/.gemini/antigravity/brain/3589e523-fba5-4dc3-b6cb-6705b01c05d6/cert-modal-landscape-${vp.name}.png`
      });

      // Close modal
      await page.click('#modal-cancel');
      await page.waitForTimeout(200);

      // 4. Test Portrait Certificate in Modal
      console.log(`  Checking Portrait Certificate Modal on ${vp.name}...`);
      await page.click('button.btn-edit-cert[data-id="cert-portrait"]');
      await page.waitForTimeout(300);

      const modalPortrait = await page.evaluate(() => {
        const modal = document.getElementById('admin-modal');
        const content = modal.querySelector('.modal-content');
        const card = document.getElementById('cert-img-card');
        const wrap = card?.querySelector('.cert-preview-wrap');
        const img = document.getElementById('cert-img-preview');
        const imgRect = img ? img.getBoundingClientRect() : null;
        const wrapRect = wrap ? wrap.getBoundingClientRect() : null;
        const compImg = img ? window.getComputedStyle(img) : null;

        return {
          contentClientWidth: content.clientWidth,
          contentScrollWidth: content.scrollWidth,
          contentHasOverflow: content.scrollWidth > content.clientWidth,
          cardHasOverflow: card ? card.scrollWidth > card.clientWidth : false,
          imgWidth: imgRect?.width,
          imgHeight: imgRect?.height,
          wrapWidth: wrapRect?.width,
          wrapHeight: wrapRect?.height,
          imgWithinWrap: imgRect && wrapRect ? (imgRect.width <= wrapRect.width + 1 && imgRect.height <= wrapRect.height + 1) : false,
          objectFit: compImg?.objectFit,
          renderedAspect: imgRect ? imgRect.width / imgRect.height : 0
        };
      });

      pass(!modalPortrait.contentHasOverflow, `[${vp.name}] Modal content has zero horizontal overflow with Portrait cert`);
      pass(!modalPortrait.cardHasOverflow, `[${vp.name}] cert-img-card has zero horizontal overflow with Portrait cert`);
      pass(modalPortrait.imgWithinWrap, `[${vp.name}] Portrait preview image strictly contained within cert-preview-wrap`);
      pass(modalPortrait.objectFit === 'contain', `[${vp.name}] Portrait preview uses object-fit: contain`);
      // Aspect ratio check (2:3 = 0.667)
      const portraitAspectDiff = Math.abs(modalPortrait.renderedAspect - (800 / 1200));
      pass(portraitAspectDiff < 0.05, `[${vp.name}] Portrait aspect ratio preserved (rendered ${modalPortrait.renderedAspect.toFixed(2)} vs target ${(2 / 3).toFixed(2)})`);

      await page.screenshot({
        path: `/home/pranav/.gemini/antigravity/brain/3589e523-fba5-4dc3-b6cb-6705b01c05d6/cert-modal-portrait-${vp.name}.png`
      });

      // 5. Test Remove Image button
      await page.click('#btn-remove-cert-img');
      await page.waitForTimeout(100);

      const placeholderState = await page.evaluate(() => {
        const placeholder = document.getElementById('cert-img-placeholder');
        const val = document.getElementById('modal-cert-img-val');
        return {
          hasPlaceholder: !!placeholder,
          placeholderText: placeholder?.textContent?.trim(),
          valCleared: val?.value === ''
        };
      });
      pass(placeholderState.hasPlaceholder && placeholderState.valCleared, `[${vp.name}] Remove button properly clears image value and shows placeholder`);

      // Close modal
      await page.click('#modal-cancel');
      await page.waitForTimeout(200);

      await context.close();
    }

    // 6. Test File Drop & Dynamic Upload Preview
    console.log('\n--- Testing Dynamic Certificate File Upload Preview ---');
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await setupPageRoutes(page);
      await page.goto(`http://127.0.0.1:${PORT}/admin`, { waitUntil: 'networkidle' });
      await page.click('button[data-tab="certifications"]');
      await page.waitForTimeout(300);

      // Open new cert modal
      await page.click('#btn-new-certification');
      await page.waitForTimeout(200);

      // Simulate file upload
      const fileInput = await page.$('#modal-cert-file');
      await fileInput.setInputFiles({
        name: 'sample-landscape-award.png',
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAlgAAAGQCAYAAAByNR6YAAAACXBIWXMAAAsTAAALEwEAmpwYAAAA', 'base64')
      });
      await page.waitForTimeout(400);

      const uploadedPreview = await page.evaluate(() => {
        const previewImg = document.getElementById('cert-img-preview');
        const wrap = document.querySelector('.cert-preview-wrap');
        const card = document.getElementById('cert-img-card');
        const metaTitle = document.querySelector('.cert-preview-title')?.textContent;
        const valInput = document.getElementById('modal-cert-img-val')?.value;
        const content = document.querySelector('.modal-content');
        return {
          hasPreviewImg: !!previewImg,
          hasWrap: !!wrap,
          hasCard: !!card,
          metaTitle,
          valInput,
          contentHasOverflow: content.scrollWidth > content.clientWidth
        };
      });

      pass(uploadedPreview.hasPreviewImg, 'Dynamic upload renders .cert-preview-img');
      pass(uploadedPreview.hasWrap, 'Dynamic upload renders .cert-preview-wrap');
      pass(uploadedPreview.metaTitle.includes('sample-landscape-award.png'), 'Preview title displays uploaded filename');
      pass(uploadedPreview.valInput.includes('/api/public/media/uploaded-media-123'), 'Hidden image value set to uploaded media entity URL');
      pass(!uploadedPreview.contentHasOverflow, 'Zero horizontal overflow after dynamic upload in modal');

      // Test dynamic remove button
      await page.click('#btn-remove-cert-img-dynamic');
      await page.waitForTimeout(100);

      const dynamicRemovedState = await page.evaluate(() => {
        const placeholder = document.getElementById('cert-img-placeholder');
        const val = document.getElementById('modal-cert-img-val')?.value;
        return { hasPlaceholder: !!placeholder, valCleared: val === '' };
      });
      pass(dynamicRemovedState.hasPlaceholder && dynamicRemovedState.valCleared, 'Dynamic remove button resets modal container and clears hidden value');

      await context.close();
    }

    console.log('\n========================================================================');
    console.log(`ALL CERTIFICATE PREVIEW & LAYOUT TESTS PASSED: ${passed} passed, ${failed} failed.`);
    console.log('========================================================================\n');

  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('\n[FATAL TEST ERROR]:', err);
  process.exit(1);
});
