import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const output = join(root, 'native-web');
await mkdir(output, { recursive: true });
for (const name of ['index.html', 'playback.js', 'backup.js', 'icon.svg', 'manifest.webmanifest']) {
  await copyFile(join(root, name), join(output, name));
}
// Avoid a stale GitHub Pages service worker intercepting Capacitor file requests.
let html = await readFile(join(output, 'index.html'), 'utf8');
html = html.replace(
  /if\('serviceWorker'in navigator\)navigator\.serviceWorker\.register\('sw\.js'\)\.catch\(\(\)=>\{\}\);/g,
  "if(!window.Capacitor && 'serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});"
);
await writeFile(join(output, 'index.html'), html);
console.log('Prepared native-web/ from the existing My Music website.');

