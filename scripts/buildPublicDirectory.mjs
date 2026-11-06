import fs from 'node:fs';
import path from 'node:path';
import { renderPublicDirectory } from '../server/publicDirectoryPages.mjs';

const {files,count} = renderPublicDirectory();
for (const [route, content] of files) {
  const file = path.join('dist', route.slice(1) + (route.endsWith('/') ? 'index.html' : ''));
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(file, content);
}
const origin = 'https://www.conferencegate.com';
const robots = fs.readFileSync('dist/robots.txt','utf8');
fs.writeFileSync('dist/robots.txt',robots.replace(/Sitemap: .*$/m,`Sitemap: ${origin}/sitemap.xml`));
const home = fs.readFileSync('dist/about.html','utf8');
const linked = home.replace(/<nav\b[^>]*>/,match=>match+'<a href="/conferences/">Explore conferences</a><a href="#about">About</a>');
if (linked === home) throw new Error('Homepage navigation not found');
fs.writeFileSync('dist/about.html',linked);
console.log(`Published ${count} public conference pages.`);
