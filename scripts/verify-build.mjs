import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const failures = [];
const pass = (condition, label) => {
  if (!condition) failures.push(label);
};
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const read = file => readFile(path.join(root, file), 'utf8');

const config = JSON.parse(await read('vercel.json'));
const html = await read('dist/index.html');
const sourceHtml = await read('index.html');
const javascript = await read('script.js');
const stylesheet = await read('style.css');
const scriptPath = html.match(/<script src="([^"]+\.js)"/)?.[1];
const stylePath = html.match(/<link rel="stylesheet" href="([^"]+\.css)"/)?.[1];
const publicJavascript = scriptPath ? await readFile(path.join(output, scriptPath), 'utf8') : '';
const publicStylesheet = stylePath ? await readFile(path.join(output, stylePath), 'utf8') : '';
const builtFiles = [];
async function collect(directory, relative = '') {
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) await collect(directory, file);
    else builtFiles.push(file.replaceAll(path.sep, '/'));
  }
}
await collect(output);

pass(config.buildCommand === 'node scripts/build.mjs', 'Vercel uses the static build command');
pass(config.outputDirectory === 'dist', 'Vercel publishes only dist/');
pass(builtFiles.includes('index.html'), 'built index.html exists');
pass(!builtFiles.some(file => file.endsWith('.map') || file.startsWith('scripts/')), 'no source maps or build scripts are in the public output');
const ids = [...sourceHtml.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const anchors = [...sourceHtml.matchAll(/\bhref="#([^"]+)"/g)].map(match => match[1]);
pass(ids.length === new Set(ids).size, 'HTML element IDs are unique');
pass(anchors.every(anchor => ids.includes(anchor)), 'in-page navigation targets exist');
pass(!/\son[a-z]+\s*=|\sstyle\s*=/i.test(sourceHtml), 'HTML has no inline event handlers or style attributes');
pass(sourceHtml.includes('CUSTOMIZE') && sourceHtml.includes('id="profile-form"') && javascript.includes('function updateProfile(next)'), 'profile editor remains available in the development source');
pass(scriptPath && stylePath && !/CUSTOMIZE|inspect-toggle|inspect-drawer|profile-form|profileForm|updateProfile|apply-profile|drawer-head/.test(html + publicJavascript + publicStylesheet), 'production HTML, JavaScript and CSS exclude profile editor controls');
pass(sourceHtml.includes('id="external-fonts"') && sourceHtml.includes('media="print"') && sourceHtml.includes("externalFonts.media = 'all'") && !stylesheet.includes('@import'), 'external fonts load asynchronously with local fallback styling');

for (const reference of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const value = reference[1];
  if (/^(?:[a-z]+:|#|\/\/)/i.test(value)) continue;
  const local = path.join(output, value);
  try { await stat(local); } catch { failures.push(`built HTML reference resolves: ${value}`); }
}

for (const file of builtFiles.filter(file => file.startsWith('assets/'))) {
  const name = path.basename(file);
  const match = name.match(/^(.+)\.([a-f0-9]{16})(\.[a-z0-9]+)$/i);
  if (!match) {
    failures.push(`fingerprinted asset name: ${file}`);
    continue;
  }
  const contents = await readFile(path.join(output, file));
  pass(hash(contents).startsWith(match[2]), `content hash matches ${file}`);
}

const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const csp = config.headers.find(rule => rule.source === '/(.*)')?.headers.find(header => header.key.toLowerCase() === 'content-security-policy')?.value || '';
const cspScriptSource = csp.match(/(?:^|;\s*)script-src\s+([^;]+)/)?.[1] || '';
const inlineHash = inlineScripts.length === 1 ? `sha256-${createHash('sha256').update(inlineScripts[0]).digest('base64')}` : '';
pass(inlineHash && cspScriptSource.includes(inlineHash), 'CSP hash matches the inline early bootstrap');
pass(!/unsafe-(?:inline|eval)/i.test(csp), 'CSP contains no unsafe-inline or unsafe-eval');
pass(csp.includes("style-src-attr 'none'") && csp.includes("script-src-attr 'none'"), 'CSP blocks inline style and event-handler attributes');
pass(csp.includes("worker-src 'none'") && csp.includes('connect-src https://fonts.googleapis.com https://fonts.gstatic.com'), 'CSP restricts network connections to font preconnect origins');
pass(!/\b(?:innerHTML|outerHTML)\b|\beval\s*\(|new Function\s*\(/.test(javascript), 'DOM and script sinks avoid HTML parsing and dynamic evaluation');
pass(!/\.style(?:\.|\[)/.test(javascript), 'JavaScript does not create CSP-blocked inline styles');
pass(javascript.includes("document.querySelector('[data-build-text=\"bio\"]').textContent = profile.bio"), 'profile copy is written as text');
pass(sourceHtml.includes('type="email"') && sourceHtml.includes('maxlength="254"') && javascript.includes("formField('email').checkValidity()"), 'profile email is type-checked and length-limited');
pass(javascript.includes('profileForm.reportValidity()') && javascript.includes('typeof next[key] === \'string\''), 'profile fields are validated before DOM updates');
pass(!/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b/.test(javascript), 'frontend has no API or realtime network client');
pass(javascript.includes('new Set([20, 56, 100])'), 'cursor workload is limited to the published sizes');
const rafSites = [...javascript.matchAll(/requestAnimationFrame\s*\(/g)].length;
pass(rafSites === 2 && javascript.includes('function ensureFrameLoop()'), 'all animation work shares one requestAnimationFrame loop');
pass(!/\b(?:setTimeout|setInterval)\s*\(/.test(javascript), 'construction and typewriter timing use the shared clock');
pass(javascript.includes("task.status = 'moving'") && javascript.includes("task.status = 'dragging'") && javascript.includes("task.status = 'confirming'") && javascript.includes("task.status = 'ready'"), 'cursor movement, frame drag and confirmation are ordered states');
pass(javascript.includes("state.phase === 'wireframe' && state.introTasks.length && state.introTasks.every(task => task.status === 'ready')") && javascript.includes("if (task.status === 'done' || task.status === 'queued' || task.status === 'scheduled') continue;"), 'intro materialization waits for completed frames and retains each frame while building');
pass(javascript.includes("{ section: 'navigation'") && javascript.includes("{ section: 'hero'") && javascript.includes("selector: '.hero-name'") && javascript.includes("selector: '.hero-portrait-card'"), 'intro plan constructs navigation, hero typography and portrait in sequence');
pass(javascript.includes("sectionTypeTargets(piece)") && javascript.includes("piece.matches('.project-card')") && javascript.includes("piece.matches('.toolkit > h2')") && javascript.includes("piece.matches('.contact-cta,.contact h2,.hello')") && javascript.includes("element.classList.add('scan-in')"), 'scroll builds retain typed project, skill, contact and image reveals');
pass(javascript.includes('function updateTypeJobs(now)') && javascript.includes('function updateCountJobs(now)') && !/requestAnimationFrame\s*\(/.test(javascript.slice(javascript.indexOf('function startTypewrite'), javascript.indexOf('function initializeAudio'))), 'typing and metric counts are scheduled by the shared frame loop');
pass(javascript.includes('state.sectionQueue = [];') && javascript.includes('state.introTasks = [];') && javascript.includes('state.typeJobs.clear();') && javascript.includes('state.countJobs.clear();') && javascript.includes('state.clock = 0;'), 'Replay Build resets its queues and active jobs without starting another loop');
pass(javascript.includes('cancelAnimationFrame(state.frame)') && javascript.includes('document.addEventListener(\'visibilitychange\''), 'animation loop pauses when the page is hidden and resumes once');
pass(javascript.includes('state.reduced ? 24') && javascript.includes('applyReducedMotion()') && stylesheet.includes('prefers-reduced-motion:reduce'), 'reduced motion lowers cursor work and shortens active construction');
pass(stylesheet.includes('body.construction-active{background:#000') && stylesheet.includes('.construction-status{position:fixed') && !stylesheet.includes('body.construction-active:not(.phase-wireframe):not(.phase-materialize) .construction-status'), 'initial black void keeps its initialization status visible');
for (const id of ['replay-build','sound-toggle','motion-mode','activity-collapse']) {
  pass(publicJavascript.includes(`byId('${id}').addEventListener(`), `public control handler exists for ${id}`);
}
pass(publicJavascript.includes("querySelectorAll('[data-count-choice]')") && publicJavascript.includes("querySelectorAll('[data-mode-choice]')") && publicJavascript.includes('new IntersectionObserver'), 'public cursor count, collaboration mode and scroll construction controls remain wired');
pass(config.headers.some(rule => rule.source === '/assets/(.*)' && rule.headers.some(header => header.key.toLowerCase() === 'cache-control' && /immutable/.test(header.value))), 'fingerprinted assets receive immutable caching');
pass(config.headers.some(rule => ['/', '/index.html'].includes(rule.source) && rule.headers.some(header => header.key.toLowerCase() === 'cache-control' && /max-age=0, must-revalidate/.test(header.value))), 'HTML revalidates on each request');
for (const name of ['content-security-policy','strict-transport-security','x-content-type-options','x-frame-options','referrer-policy','permissions-policy','cross-origin-resource-policy']) {
  pass(config.headers.some(rule => rule.source === '/(.*)' && rule.headers.some(header => header.key.toLowerCase() === name)), `response header ${name} is configured`);
}

if (failures.length) {
  console.error(`Static production verification failed (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Static production verification passed (${builtFiles.length} deployed files, ${builtFiles.length - 1} content-hashed assets).`);
}
