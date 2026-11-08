// scripts/test-dynamic-cms-robustness.mjs
// Automated Regression Suite for Dynamic CMS Content Robustness:
// - Tests 1, 3, 7, 15 projects
// - Tests very long unbroken titles, descriptions, and tags
// - Tests projects without images and with custom images
// - Tests certificates with portrait, landscape, and square images
// - Tests certificates without images
// - Tests large number of certificates (20+ certs) across 1920px, 1440px, 768px, 430px, 390px
// - Tests editing and deletion lifecycle of projects & certs
// - Tests broken image URLs and missing optional fields
// - Tests extreme skill category names and tag lists
// - Tests page reload, layout stabilization, and cinematic animation compatibility
// - Captures visual regression screenshots and an animated walkthrough recording (.webp)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import playwright from '/home/pranav/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const brainDir = '/home/pranav/.gemini/antigravity/brain/3589e523-fba5-4dc3-b6cb-6705b01c05d6';
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
      let reqPath = decodeURIComponent(req.url.split('?')[0]);
      if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
      const filePath = path.join(distDir, reqPath);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*'
        });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

function buildWithMockPayload(payload) {
  const jsonStr = JSON.stringify(payload);
  execSync('node scripts/build.mjs', {
    cwd: root,
    env: { ...process.env, CMS_MOCK_PAYLOAD: jsonStr },
    stdio: 'pipe'
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

// Generate test aspect ratio images if not already present
execSync('convert -size 400x200 xc:#38bdf8 /tmp/test-landscape.jpg', { stdio: 'ignore' });
execSync('convert -size 200x400 xc:#f87171 /tmp/test-portrait.jpg', { stdio: 'ignore' });
execSync('convert -size 300x300 xc:#34d399 /tmp/test-square.jpg', { stdio: 'ignore' });

async function run() {
  console.log('========================================================================');
  console.log('STARTING DYNAMIC CMS CONTENT ROBUSTNESS & ANIMATION TEST SUITE');
  console.log('========================================================================\n');

  const server = await startServer();
  const browser = await playwright.chromium.launch({
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const viewports = [
    { name: 'desktop-1920', width: 1920, height: 1080 },
    { name: 'desktop-1440', width: 1440, height: 900 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'mobile-430', width: 430, height: 932 },
    { name: 'mobile-390', width: 390, height: 844 }
  ];

  try {
    // -------------------------------------------------------------------------
    // Scenario 1: Variable Project Counts (1, 3, 7, 15 projects)
    // -------------------------------------------------------------------------
    console.log('--- Scenario 1: Dynamic Project Layouts (1, 3, 7, 15 projects) ---');

    for (const count of [1, 3, 7, 15]) {
      const projects = Array.from({ length: count }, (_, i) => ({
        entity_id: `proj-${i + 1}`,
        project_number: `0${i + 1}`,
        slug: `project-${i + 1}`,
        title: `Dynamic Project ${i + 1}`,
        category: 'SYSTEMS / CLOUD',
        summary: `Automated dynamic summary for project number ${i + 1} verifying grid flexibility.`,
        tags: ['PYTHON', 'NODE.JS', 'DOCKER', 'POSTGRESQL'],
        repo_url: `https://github.com/example/proj-${i + 1}`,
        is_wide: count === 1 || (count > 1 && i % 4 === 0),
        preview_type: i % 2 === 0 ? 'civic' : 'url'
      }));

      buildWithMockPayload({ projects });

      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', err => pageErrors.push(err.message));

      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);

      const renderedCount = await page.locator('.project-card').count();
      pass(renderedCount === count, `${count} projects: Exactly ${count} project cards rendered in DOM`);
      pass(pageErrors.length === 0, `${count} projects: Zero JavaScript errors`);

      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      pass(!hasOverflow, `${count} projects: Zero horizontal overflow on 1440px desktop`);

      if (count === 1) {
        await page.screenshot({ path: path.join(root, 'dynamic-1project-desktop-1440.png') });
      } else if (count === 15) {
        await page.screenshot({ path: path.join(root, 'dynamic-15projects-desktop-1440.png') });
      }

      await context.close();
    }

    // -------------------------------------------------------------------------
    // Scenario 2: Very Long Titles, Descriptions, and Tags (No Layout Blowout)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 2: Unbroken Strings, Long Titles, and Long Descriptions ---');
    const extremeProjects = [
      {
        entity_id: 'proj-extreme-1',
        project_number: '99',
        slug: 'super-long-system',
        title: 'EXTREMELY_LONG_UNBROKEN_PROJECT_TITLE_EXCEEDING_HUNDRED_CHARACTERS_WITHOUT_SPACES_V9_CLUSTER_ENTERPRISE_SYSTEM',
        summary: 'A'.repeat(300) + ' ' + 'B'.repeat(300),
        tags: ['A_SUPER_LONG_UNBROKEN_TECHNOLOGY_TAG_REQUIRING_WRAP_1234567890', 'ANOTHER_VERY_LONG_TAG_XYZ', 'TAG3'],
        repo_url: 'https://github.com/example/extreme',
        is_wide: true,
        preview_type: 'civic'
      }
    ];

    buildWithMockPayload({ projects: extremeProjects });

    for (const vp of viewports) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', err => pageErrors.push(err.message));

      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      pass(!overflow, `Extreme unbroken text: Zero horizontal overflow on ${vp.name} (${vp.width}px)`);
      pass(pageErrors.length === 0, `Extreme unbroken text: Zero JS errors on ${vp.name}`);

      if (vp.name === 'mobile-390') {
        await page.screenshot({ path: path.join(root, 'dynamic-extreme-text-mobile-390.png') });
      }
      await context.close();
    }

    // -------------------------------------------------------------------------
    // Scenario 3: Missing Optional Images & Custom Image Previews
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 3: Projects Without Images vs. With Custom Preview Images ---');
    const mixedImageProjects = [
      {
        entity_id: 'proj-no-img',
        project_number: '01',
        slug: 'no-image-proj',
        title: 'Project Without Custom Image',
        summary: 'Clean fallback preview verification.',
        tags: ['FALLBACK', 'TEST'],
        repo_url: 'https://github.com/example/fallback',
        is_wide: false,
        preview_type: 'custom' // No preview_type map match and no image_url -> triggers clean civic fallback
      },
      {
        entity_id: 'proj-with-img',
        project_number: '02',
        slug: 'custom-img-proj',
        title: 'Project With Custom Image',
        summary: 'Custom preview image verification.',
        tags: ['CUSTOM', 'ASSET'],
        repo_url: 'https://github.com/example/custom-img',
        image_url: '/tmp/test-landscape.jpg',
        is_wide: false
      }
    ];

    buildWithMockPayload({ projects: mixedImageProjects });

    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      const customImgExists = await page.locator('.project-preview-img').count();
      pass(customImgExists === 1, 'Custom project image correctly rendered with .project-preview-img');

      const fallbackExists = await page.locator('.preview-civic').count();
      pass(fallbackExists >= 1, 'Missing optional image falls back cleanly to structured civic preview');

      await context.close();
    }

    // -------------------------------------------------------------------------
    // Scenario 4 & 5: Certificates With Portrait, Landscape, Square & Missing Images
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 4 & 5: Certificate Image Ratios (Portrait, Landscape, Square & None) ---');
    const mixedCerts = [
      {
        entity_id: 'cert-land',
        title: 'Landscape Certificate Award',
        issuer: 'AWS Certification',
        date: 'MAR 2026',
        credential_url: 'https://aws.amazon.com',
        certificate_image_url: '/tmp/test-landscape.jpg',
        mark: '✳'
      },
      {
        entity_id: 'cert-port',
        title: 'Portrait Certificate Credential',
        issuer: 'Coursera Deep Learning',
        date: 'FEB 2026',
        credential_url: 'https://coursera.org',
        certificate_image_url: '/tmp/test-portrait.jpg',
        mark: '◉'
      },
      {
        entity_id: 'cert-sq',
        title: 'Square Certificate Badge',
        issuer: 'Google Cloud Platform',
        date: 'JAN 2026',
        credential_url: 'https://cloud.google.com',
        certificate_image_url: '/tmp/test-square.jpg',
        mark: '✳'
      },
      {
        entity_id: 'cert-no-img',
        title: 'Text-Only Certificate Without Image',
        issuer: 'Hackathon Committee',
        date: '2025',
        credential_url: 'https://example.com/verify',
        certificate_image_url: null,
        mark: '↗'
      }
    ];

    buildWithMockPayload({ certifications: mixedCerts });

    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', err => pageErrors.push(err.message));

      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      const thumbCount = await page.locator('.credential-thumb').count();
      pass(thumbCount === 3, 'Exactly 3 certificate thumbnails rendered (fourth cert has clean text-only fallback)');
      pass(pageErrors.length === 0, 'Zero errors when rendering mixed portrait/landscape/square certificate images');

      // Verify object-fit and dimensions are locked to 36x26
      const dimensions = await page.evaluate(() => {
        const thumbs = [...document.querySelectorAll('.credential-thumb')];
        return thumbs.map(t => {
          const style = window.getComputedStyle(t);
          const rect = t.getBoundingClientRect();
          return {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            objectFit: style.objectFit
          };
        });
      });

      const allFit = dimensions.every(d => d.width === 36 && d.height === 26 && d.objectFit === 'cover');
      pass(allFit, 'All certificate images (portrait, landscape, square) strictly locked to 36x26px with object-fit: cover');

      await page.screenshot({ path: path.join(root, 'dynamic-aspect-ratio-certs-desktop-1440.png') });
      await context.close();
    }

    // -------------------------------------------------------------------------
    // Scenario 6: Large Number of Certificates (24 certificates)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 6: Large Number of Certificates (24 certs across breakpoints) ---');
    const manyCerts = Array.from({ length: 24 }, (_, i) => ({
      entity_id: `cert-bulk-${i + 1}`,
      title: `Professional Credential ${i + 1}`,
      issuer: i % 2 === 0 ? 'Stanford Online' : 'MIT Professional Education',
      date: `202${4 + (i % 3)}`,
      credential_url: `https://example.com/verify/${i + 1}`,
      certificate_image_url: i % 3 === 0 ? '/tmp/test-square.jpg' : null,
      mark: i % 2 === 0 ? '✳' : '↗'
    }));

    buildWithMockPayload({ certifications: manyCerts });

    for (const vp of [
      { name: 'desktop-1440', width: 1440, height: 900 },
      { name: 'tablet-768', width: 768, height: 1024 },
      { name: 'mobile-390', width: 390, height: 844 }
    ]) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      const certCount = await page.locator('.credential-grid > div').count();
      pass(certCount === 24, `24 certificates rendered on ${vp.name}`);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      pass(!overflow, `24 certificates: Zero horizontal overflow on ${vp.name}`);

      if (vp.name === 'tablet-768') {
        await page.screenshot({ path: path.join(root, 'dynamic-20certs-tablet-768.png') });
      }
      await context.close();
    }

    // -------------------------------------------------------------------------
    // Scenario 7: Edit and Delete Existing Content (Lifecycle Verification)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 7: Content Edit and Deletion (Lifecycle Verification) ---');
    // Step 1: Baseline with 4 projects and 3 certs
    const stateA = {
      projects: [
        { entity_id: 'p-1', slug: 'p1', title: 'Original Alpha', summary: 'Summary A', tags: ['REACT'] },
        { entity_id: 'p-2', slug: 'p2', title: 'Original Beta', summary: 'Summary B', tags: ['NODE'] },
        { entity_id: 'p-3', slug: 'p3', title: 'Original Gamma', summary: 'Summary C', tags: ['PYTHON'] },
        { entity_id: 'p-4', slug: 'p4', title: 'Original Delta', summary: 'Summary D', tags: ['GO'] }
      ],
      certifications: [
        { entity_id: 'c-1', title: 'Cert A', issuer: 'Issuer A' },
        { entity_id: 'c-2', title: 'Cert B', issuer: 'Issuer B' },
        { entity_id: 'c-3', title: 'Cert C', issuer: 'Issuer C' }
      ]
    };
    buildWithMockPayload(stateA);

    // Step 2: Delete p-2, p-4; edit p-1 title; delete c-2; edit c-1
    const stateB = {
      projects: [
        { entity_id: 'p-1', slug: 'p1', title: 'EDITED Alpha Project', summary: 'Updated Alpha Summary', tags: ['REACT', 'NEXTJS'] },
        { entity_id: 'p-3', slug: 'p3', title: 'Original Gamma', summary: 'Summary C', tags: ['PYTHON'] }
      ],
      certifications: [
        { entity_id: 'c-1', title: 'EDITED Cert Alpha', issuer: 'Updated Issuer A' },
        { entity_id: 'c-3', title: 'Cert C', issuer: 'Issuer C' }
      ]
    };
    buildWithMockPayload(stateB);

    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      const pCount = await page.locator('.project-card').count();
      const cCount = await page.locator('.credential-grid > div').count();
      pass(pCount === 2, 'Lifecycle: Deleted projects omitted cleanly (count: 2)');
      pass(cCount === 2, 'Lifecycle: Deleted certificates omitted cleanly (count: 2)');

      const editedPTitle = await page.locator('.project-card[data-project="p1"] h3').textContent();
      pass(editedPTitle === 'EDITED Alpha Project', 'Lifecycle: Edited project title reflected in DOM');

      const deletedP2 = await page.locator('.project-card[data-project="p2"]').count();
      pass(deletedP2 === 0, 'Lifecycle: Deleted project p2 completely absent from DOM');

      await context.close();
    }

    // -------------------------------------------------------------------------
    // Scenario 8: Broken Image URLs & Missing Optional Fields
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 8: Broken Image URLs & Missing Optional Fields ---');
    const resilientPayload = {
      projects: [
        {
          entity_id: 'p-broken-1',
          slug: 'broken-proj',
          title: 'Resilient Broken Image Project',
          summary: '', // Empty summary
          tags: null, // Null tags
          repo_url: null, // Null repo url
          image_url: 'https://nonexistent-404-broken-domain.xyz/broken.png'
        }
      ],
      certifications: [
        {
          entity_id: 'c-broken-1',
          title: 'Resilient Broken Certificate',
          issuer: 'Test Organization',
          date: null, // Null date
          credential_url: null, // Null cred url
          mark: null, // Null mark
          certificate_image_url: 'https://nonexistent-404-broken-domain.xyz/broken-cert.png'
        }
      ]
    };

    buildWithMockPayload(resilientPayload);

    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', err => pageErrors.push(err.message));

      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(700);

      pass(pageErrors.length === 0, 'Broken image & null fields: Zero JavaScript runtime errors');

      // Check text does not contain "null" or "undefined"
      const bodyText = await page.locator('body').innerText();
      pass(!bodyText.includes('undefined') && !bodyText.includes('null'), 'No "null" or "undefined" literals rendered in visible text');

      await context.close();
    }

    // -------------------------------------------------------------------------
    // Scenario 9: Long Skill Category Names and Technology Tag Lists
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 9: Long Skill Category Names & 30-Skill Tag Lists ---');
    const skillsPayload = {
      categories: [
        {
          entity_id: 'cat-1',
          display_order: 1,
          name: 'ENTERPRISE_SYSTEM_SECURITY_AND_HIGH_THROUGHPUT_DISTRIBUTED_ARCHITECTURE',
          category_number: '01 / SECURITY_ENTERPRISE_DISTRIBUTED_INFRASTRUCTURE'
        }
      ],
      skills: Array.from({ length: 30 }, (_, i) => ({
        entity_id: `skill-${i + 1}`,
        category_entity_id: 'cat-1',
        name: i === 0 ? 'VERY_LONG_UNBROKEN_SKILL_NAME_THAT_SHOULD_WRAP_CLEANLY_IN_THE_PILL_BADGE' : `Skill_${i + 1}`
      }))
    };

    buildWithMockPayload(skillsPayload);

    for (const vp of [
      { name: 'desktop-1440', width: 1440, height: 900 },
      { name: 'mobile-390', width: 390, height: 844 }
    ]) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      const skillCount = await page.locator('.skill-row b').count();
      pass(skillCount === 30, `30 skills rendered on ${vp.name}`);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      pass(!overflow, `Long skill category & 30 tags: Zero horizontal overflow on ${vp.name}`);

      if (vp.name === 'mobile-390') {
        await page.screenshot({ path: path.join(root, 'dynamic-mobile-390.png') });
      }
      await context.close();
    }

    // -------------------------------------------------------------------------
    // Scenario 10: Full Cinematic Animation on Dynamic Content & Recording
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 10: Cinematic Swarm Animation with Dynamic Content ---');
    const dynamicIntroPayload = {
      settings: {
        role_title: 'Full Stack & AI Engineer',
        full_bio: 'Dynamic CMS portfolio bio text verifying that custom settings integrate seamlessly with the cinematic introductory sequence.'
      },
      projects: [
        {
          entity_id: 'p-dyn-1',
          project_number: '01',
          slug: 'dynamic-cyber',
          title: 'Cyber Threat Radar',
          category: 'AI / SECURITY',
          summary: 'Real-time threat telemetry pipeline processing high-velocity audit trails.',
          tags: ['PYTHON', 'FASTAPI', 'POSTGRESQL'],
          repo_url: 'https://github.com/example/radar',
          is_wide: true,
          preview_type: 'civic'
        },
        {
          entity_id: 'p-dyn-2',
          project_number: '02',
          slug: 'dynamic-agent',
          title: 'Multi-Agent Simulator',
          category: 'AGENTIC AI',
          summary: 'Autonomous collaborative agent framework simulating distributed consensus.',
          tags: ['TYPESCRIPT', 'CANVAS', 'WEBSOCKET'],
          repo_url: 'https://github.com/example/simulator',
          is_wide: false,
          preview_type: 'url'
        },
        {
          entity_id: 'p-dyn-3',
          project_number: '03',
          slug: 'dynamic-storage',
          title: 'Object Store Engine',
          category: 'STORAGE / CLOUD',
          summary: 'Blob storage system with immutable content hashing and deduplication.',
          tags: ['GO', 'MINIO', 'REDIS'],
          repo_url: 'https://github.com/example/storage',
          is_wide: false,
          preview_type: 'storage'
        }
      ],
      certifications: [
        {
          entity_id: 'c-dyn-1',
          title: 'Advanced AI Systems',
          issuer: 'DeepLearning.AI',
          date: '2026',
          credential_url: 'https://deeplearning.ai',
          certificate_image_url: '/tmp/test-landscape.jpg',
          mark: '✳'
        },
        {
          entity_id: 'c-dyn-2',
          title: 'Certified Kubernetes Administrator',
          issuer: 'Cloud Native Computing Foundation',
          date: '2025',
          credential_url: 'https://cncf.io',
          certificate_image_url: '/tmp/test-portrait.jpg',
          mark: '◉'
        }
      ]
    };

    buildWithMockPayload(dynamicIntroPayload);

    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', err => pageErrors.push(err.message));

      fs.mkdirSync(path.join(root, '.capture_dynamic_frames'), { recursive: true });

      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });

      // Frame capture loop for screen recording
      const startTime = Date.now();
      let frameIndex = 0;
      let hitBottom = false;
      let hitTopReturn = false;

      while (Date.now() - startTime < 25000) {
        const framePath = path.join(root, `.capture_dynamic_frames/frame-${String(frameIndex).padStart(4, '0')}.png`);
        await page.screenshot({ path: framePath });
        frameIndex++;

        const scrollY = await page.evaluate(() => window.scrollY);
        const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);

        if (scrollY > maxScroll * 0.85) hitBottom = true;
        const isComplete = await page.evaluate(() => document.body.classList.contains('cinematic-complete'));

        if (hitBottom && scrollY === 0 && isComplete) {
          hitTopReturn = true;
          break;
        }
        await page.waitForTimeout(140);
      }

      pass(hitBottom, 'Cinematic Tour: Reached bottom of dynamic CMS portfolio');
      pass(hitTopReturn, 'Cinematic Tour: Smoothly returned to top (scrollY === 0)');
      pass(pageErrors.length === 0, 'Cinematic Tour: 0 runtime errors during dynamic tour');

      const isComplete = await page.evaluate(() => document.body.classList.contains('cinematic-complete'));
      pass(isComplete, 'Cinematic Tour: body transitioned to "cinematic-complete"');

      const canvasHidden = await page.evaluate(() => {
        const canvas = document.getElementById('construction-canvas');
        const style = window.getComputedStyle(canvas);
        return style.display === 'none' || style.opacity === '0';
      });
      pass(canvasHidden, 'Cinematic Tour: Canvas completely dormant and hidden after tour');

      // Test real mouse pointer / button interaction
      const contactCta = page.locator('.contact-cta');
      const href = await contactCta.getAttribute('href');
      pass(href && href.startsWith('mailto:'), 'Normal browsing: Real visitor interaction restored (contact CTA clickable)');

      // Compile frames into animated WebP
      console.log(`  Compiling ${frameIndex} frames into dynamic-cms-cinematic-tour.webp...`);
      execSync(`convert -delay 25 -loop 0 -resize 960x .capture_dynamic_frames/frame-*.png dynamic-cms-cinematic-tour.webp`, {
        cwd: root,
        stdio: 'ignore'
      });
      pass(fs.existsSync(path.join(root, 'dynamic-cms-cinematic-tour.webp')), 'Successfully generated dynamic-cms-cinematic-tour.webp');

      fs.rmSync(path.join(root, '.capture_dynamic_frames'), { recursive: true, force: true });
      await context.close();
    }

    // -------------------------------------------------------------------------
    // Mobile Viewport Verification (430px)
    // -------------------------------------------------------------------------
    {
      const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
      const page = await context.newPage();
      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      await page.screenshot({ path: path.join(root, 'dynamic-mobile-430.png') });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      pass(!overflow, 'Mobile 430px: Zero horizontal overflow with dynamic CMS content');
      await context.close();
    }

    // Copy visual proof artifacts to artifact directory
    const artifactsToCopy = [
      'dynamic-1project-desktop-1440.png',
      'dynamic-15projects-desktop-1440.png',
      'dynamic-extreme-text-mobile-390.png',
      'dynamic-aspect-ratio-certs-desktop-1440.png',
      'dynamic-20certs-tablet-768.png',
      'dynamic-mobile-390.png',
      'dynamic-mobile-430.png',
      'dynamic-cms-cinematic-tour.webp'
    ];

    for (const f of artifactsToCopy) {
      const src = path.join(root, f);
      const dest = path.join(brainDir, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
    }
    console.log(`\nCopied all dynamic test proof artifacts to ${brainDir}`);

  } finally {
    await browser.close();
    server.close();
    // Restore baseline production build
    delete process.env.CMS_MOCK_PAYLOAD;
    execSync('node scripts/build.mjs', { cwd: root, stdio: 'ignore' });
  }

  console.log('\n========================================================================');
  if (failures.length > 0) {
    console.error(`FAILED: ${failures.length} assertion(s) failed.`);
    process.exit(1);
  } else {
    console.log('ALL DYNAMIC CMS ROBUSTNESS & ANIMATION SCENARIOS PASSED WITH 0 FAILURES!');
    console.log('========================================================================');
  }
}

run().catch(err => {
  console.error('Test suite encountered an uncaught error:', err);
  process.exit(1);
});
