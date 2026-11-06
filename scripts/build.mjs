import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const sourceFiles = [
  'style.css',
  'script.js',
  'assets/pranav-shenoy.jpg',
  'assets/pranav-shenoy-resume.pdf'
];

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function fingerprintedName(file, buffer) {
  const extension = path.extname(file);
  return `${path.basename(file, extension)}.${digest(buffer).slice(0, 16)}${extension}`;
}

function stripDevOnly(source, startMarker, endMarker) {
  let result = '';
  let cursor = 0;
  while (true) {
    const start = source.indexOf(startMarker, cursor);
    if (start < 0) break;
    const end = source.indexOf(endMarker, start + startMarker.length);
    if (end < 0) throw new Error(`Missing development-only end marker: ${endMarker}`);
    result += source.slice(cursor, start);
    cursor = end + endMarker.length;
  }
  result += source.slice(cursor);
  if (result.includes(startMarker) || result.includes(endMarker)) throw new Error('Development-only markers were not fully removed.');
  return result;
}

function productionStyle(source) {
  return stripDevOnly(source, '/* DEV_ONLY_START:PROFILE_EDITOR */', '/* DEV_ONLY_END:PROFILE_EDITOR */')
    .replaceAll('.motion-reduced .canvas-dock,.motion-reduced .inspect-drawer{scroll-behavior:auto;transition:none}', '.motion-reduced .canvas-dock{scroll-behavior:auto;transition:none}')
    .replaceAll('.canvas-dock,.inspect-drawer{transition:none!important}', '.canvas-dock{transition:none!important}')
    .replaceAll('.inspect-drawer{right:8px;bottom:62px;width:calc(100vw - 16px);padding:16px}', '')
    .replaceAll('body.motion-reduced .canvas-dock,body.motion-reduced .inspect-drawer{transition:none!important}', 'body.motion-reduced .canvas-dock{transition:none!important}')
    .replaceAll(',.apply-profile:focus-visible', '');
}

function productionScript(source) {
  return stripDevOnly(source, '/* DEV_ONLY_START:PROFILE_EDITOR */', '/* DEV_ONLY_END:PROFILE_EDITOR */');
}

const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
if (config.buildCommand !== 'node scripts/build.mjs' || config.outputDirectory !== 'dist') {
  throw new Error('Vercel build configuration must use this script and the dist output directory.');
}

const sourceHtml = await readFile(path.join(root, 'index.html'), 'utf8');
const inlineScripts = [...sourceHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
if (inlineScripts.length !== 1) throw new Error('Expected only the single CSP-hashed early JavaScript bootstrap.');

const cspRule = config.headers.find(rule => rule.source === '/(.*)');
const csp = cspRule?.headers.find(header => header.key.toLowerCase() === 'content-security-policy')?.value || '';
const bootstrapHash = `sha256-${createHash('sha256').update(inlineScripts[0]).digest('base64')}`;
if (!csp.includes(bootstrapHash) || /unsafe-(?:inline|eval)/i.test(csp)) {
  throw new Error('CSP must allow the exact bootstrap hash and must not allow unsafe-inline or unsafe-eval.');
}

const assetNames = new Map();
const outputs = [];
for (const file of sourceFiles) {
  let contents = await readFile(path.join(root, file));
  if (file === 'script.js') contents = Buffer.from(productionScript(contents.toString('utf8')));
  if (file === 'style.css') contents = Buffer.from(productionStyle(contents.toString('utf8')));
  const name = fingerprintedName(file, contents);
  const destination = path.join('assets', name);
  assetNames.set(file, destination.replaceAll(path.sep, '/'));
  outputs.push({ destination, contents });
}

let html = stripDevOnly(sourceHtml, '<!-- DEV_ONLY_START:PROFILE_EDITOR -->', '<!-- DEV_ONLY_END:PROFILE_EDITOR -->')
  .replaceAll('href="style.css"', `href="${assetNames.get('style.css')}"`)
  .replaceAll('src="script.js"', `src="${assetNames.get('script.js')}"`)
  .replaceAll('assets/pranav-shenoy.jpg', assetNames.get('assets/pranav-shenoy.jpg'))
  .replaceAll('assets/pranav-shenoy-resume.pdf', assetNames.get('assets/pranav-shenoy-resume.pdf'));

const publicAssetText = outputs.filter(item => /(?:script|style)\.[a-f0-9]+\.(?:js|css)$/.test(item.destination)).map(item => item.contents.toString('utf8')).join('\n');
if (/CUSTOMIZE|inspect-toggle|inspect-drawer|profile-form|profileForm|updateProfile|apply-profile/.test(html + publicAssetText)) {
  throw new Error('A development-only profile editor control leaked into the production output.');
}

if (html.includes('href="style.css"') || html.includes('src="script.js"')) {
  throw new Error('A source CSS or JavaScript reference was not fingerprinted.');
}

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'assets'), { recursive: true });
await writeFile(path.join(output, 'index.html'), html);
for (const item of outputs) {
  const destination = path.join(output, item.destination);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, item.contents);
}

console.log(`Built static portfolio to dist/ (${outputs.length} fingerprinted assets, no runtime services).`);
