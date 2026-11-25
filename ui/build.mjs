import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryFile = path.join(__dirname, 'src', 'app.ts');
const outHtml = path.join(__dirname, 'app.html');

const result = await esbuild.build({
  entryPoints: [entryFile],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2022'],
  write: false,
});

const jsBundle = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const existingHtml = fs.existsSync(outHtml) ? fs.readFileSync(outHtml, 'utf8') : '';
const styleMatch = existingHtml.match(/<style>([\s\S]*?)<\/style>/);
const css = styleMatch ? styleMatch[1] : '';

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Skill Explorer</title>
  <style>${css}</style>
</head>
<body>
  <div id="app" class="shell"></div>
  <script>${jsBundle}</script>
</body>
</html>
`;

fs.writeFileSync(outHtml, html, 'utf8');
console.log(`Built ${outHtml} (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB)`);
