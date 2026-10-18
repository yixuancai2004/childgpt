import { mkdir, copyFile, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true }); await mkdir(dist, { recursive: true });
for (const name of ['index.html','styles.css','app.js']) await copyFile(path.join(root,'web',name), path.join(dist,name));
await copyFile(path.join(root,'src/core.js'),path.join(dist,'core.js'));
await writeFile(path.join(dist,'.nojekyll'),'');
await mkdir(path.join(dist,'results'),{recursive:true});
for (const name of await readdir(path.join(root,'results'))) if (/\.(?:json|csv|txt|md|svg)$/u.test(name)) await copyFile(path.join(root,'results',name),path.join(dist,'results',name));
await mkdir(path.join(dist,'results/demos'), { recursive: true });
for (const kind of ['conversation', 'learning']) {
  const source = path.join(root, 'results/demos', `${kind}.json`);
  try { await copyFile(source, path.join(dist, 'results/demos', `${kind}.json`)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const html = await readFile(path.join(root,'web/index.html'),'utf8');
const css = await readFile(path.join(root,'web/styles.css'),'utf8');
const core = await readFile(path.join(root,'src/core.js'),'utf8');
const app = await readFile(path.join(root,'web/app.js'),'utf8');
// A self-contained key-free demo for opening directly from a ZIP. Hosted CSP remains in dist/index.html.
let recordings = '';
for (const kind of ['conversation', 'learning']) {
  try {
    const data = JSON.parse(await readFile(path.join(root, 'results/demos', `${kind}.json`), 'utf8'));
    recordings += `<script type="application/json" id="recording-${kind}">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>`;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const standalone = html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/u,'').replace('<link rel="stylesheet" href="styles.css">',`<style>${css}</style>`).replace('<script src="core.js"></script>',`${recordings}<script>${core.replaceAll('</script','<\\/script')}</script>`).replace('<script src="app.js"></script>',`<script>${app.replaceAll('</script','<\\/script')}</script>`);
await writeFile(path.join(root,'ChildGPT-demo.html'),standalone);
console.log('Built dist/ (static Pages site) and ChildGPT-demo.html (standalone, no API needed).');
