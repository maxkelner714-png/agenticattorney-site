#!/usr/bin/env node
// Build script for AgenticAttorney.com.
// Usage: node scripts/build.mjs [path-to-fragment]   (default: src/prototype.html)
// Zero dependencies. Turns the body-only prototype fragment into a static site in public/.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync, statSync, rmSync } from 'node:fs';
import { join, dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(process.argv[2] || join(ROOT, 'src', 'prototype.html'));
const PUB = join(ROOT, 'public');
const ASSETS = join(PUB, 'assets');
const FONTS = join(ASSETS, 'fonts');
const SHARED_LEGAL = '/mnt/project-files/website/legal';
const SHARED_ASSETS = '/mnt/project-files/website/assets';

const SITE = 'https://agenticattorney.com';
const EMAIL = 'info@agenticattorney.com';
const TITLE = 'AgenticAttorney.com: attorneys for businesses that run on AI agents';
const DESCRIPTION = 'AgenticAttorney.com is a free attorney-matching service for businesses that run on AI agents, covering New York, California, Texas and Nevada, and software for the attorneys who serve them. It is not a law firm.';
const NOT_A_FIRM = 'AgenticAttorney.com is not a law firm and does not give legal advice.';
const THEME_LIGHT = '#F6F3EC';
const THEME_DARK = '#262624';

const log = (...a) => console.log('[build]', ...a);
const warn = (...a) => console.warn('[build] warning:', ...a);

// ---------- 1. Parse the fragment ----------
if (!existsSync(SRC)) { console.error(`[build] fragment not found: ${SRC}`); process.exit(1); }
let fragment = readFileSync(SRC, 'utf8');

// Drop a <title> (the shell sets its own) and every <link> at the top (Google Fonts, preconnects).
fragment = fragment.replace(/<title>[\s\S]*?<\/title>\s*/gi, '');
const droppedLinks = fragment.match(/<link\b[^>]*>\s*/gi) || [];
fragment = fragment.replace(/<link\b[^>]*>\s*/gi, '');
if (droppedLinks.length) log(`removed ${droppedLinks.length} <link> tag(s) from the fragment`);

// Extract every <style> and <script> block in document order.
const styles = [];
fragment = fragment.replace(/<style\b[^>]*>([\s\S]*?)<\/style>\s*/gi, (_, css) => { styles.push(css.trim()); return ''; });
const scripts = [];
fragment = fragment.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>\s*/gi, (_, attrs, js) => {
  if (/\bsrc=/i.test(attrs)) warn('external <script src> found in fragment; it was removed:', attrs.trim());
  else scripts.push(js.trim());
  return '';
});
const markup = fragment.trim();

// A strict CSP forbids inline handlers. Refuse to build markup that relies on them.
const inlineHandlers = markup.match(/\son[a-z]+\s*=\s*["']/gi) || [];
if (inlineHandlers.length) {
  console.error(`[build] the fragment uses ${inlineHandlers.length} inline event handler(s); the CSP would block them. Move them into the script.`);
  process.exit(1);
}
if (/\bjavascript:/i.test(markup)) { console.error('[build] javascript: URL found in markup'); process.exit(1); }
log(`fragment parsed: ${styles.length} style block(s), ${scripts.length} script block(s), ${markup.length} bytes of markup`);

// ---------- 2. Output folders ----------
rmSync(PUB, { recursive: true, force: true });
mkdirSync(FONTS, { recursive: true });

// ---------- 3. Fonts (self-hosted, latin subsets of the variable fonts) ----------
const fontPlan = [
  { pkg: '@fontsource-variable/newsreader', family: 'Newsreader', files: [
    { file: 'newsreader-latin-opsz-normal.woff2', style: 'normal', weight: '200 800', preload: true },
    { file: 'newsreader-latin-opsz-italic.woff2', style: 'italic', weight: '200 800' },
  ] },
  { pkg: '@fontsource-variable/geist', family: 'Geist', files: [
    { file: 'geist-latin-wght-normal.woff2', style: 'normal', weight: '100 900', preload: true },
    { file: 'geist-latin-wght-italic.woff2', style: 'italic', weight: '100 900' },
  ] },
];
const LATIN_RANGE = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
let fontFaces = '';
const preloads = [];
const licenses = [];
let fontsOk = true;
for (const plan of fontPlan) {
  const dir = join(ROOT, 'node_modules', plan.pkg);
  if (!existsSync(join(dir, 'files'))) { fontsOk = false; warn(`font package ${plan.pkg} not installed; run npm install`); continue; }
  for (const f of plan.files) {
    const src = join(dir, 'files', f.file);
    if (!existsSync(src)) { fontsOk = false; warn(`missing font file ${src}`); continue; }
    copyFileSync(src, join(FONTS, f.file));
    fontFaces += `@font-face{font-family:"${plan.family}";font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url(fonts/${f.file}) format("woff2");unicode-range:${LATIN_RANGE}}\n`;
    if (f.preload) preloads.push(`/assets/fonts/${f.file}`);
  }
  const lic = ['LICENSE', 'LICENSE.txt', 'LICENSE.md'].map((n) => join(dir, n)).find(existsSync);
  licenses.push(`==== ${plan.family} (${plan.pkg}) ====\n\n` + (lic ? readFileSync(lic, 'utf8') : 'SIL Open Font License 1.1. See https://openfontlicense.org/'));
}
if (!fontsOk) {
  console.error('[build] font files are missing; the fragment references Newsreader and Geist. Install devDependencies first.');
  process.exit(1);
}
writeFileSync(join(FONTS, 'LICENSE.txt'),
  'Fonts in this folder are self-hosted copies of Newsreader and Geist, distributed under the SIL Open Font License 1.1.\n\n' + licenses.join('\n\n'));
log(`fonts: ${readdirSync(FONTS).length - 1} woff2 file(s) copied`);

// ---------- 4. CSS and JS ----------
const baseCss = `/* Base styles from the publish skeleton */
:root{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}
body{margin:0;font:14px system-ui;background:#fafaf8}
img{max-width:100%}
[hidden]{display:none!important}
.noscript{max-width:44rem;margin:0 auto;padding:32px 16px;font:16px/1.6 system-ui}
`;
writeFileSync(join(ASSETS, 'fonts.css'), '/* Generated by scripts/build.mjs. Self-hosted fonts for pages that do not load site.css. */\n' + fontFaces);
writeFileSync(join(ASSETS, 'site.css'), '/* Generated by scripts/build.mjs. Edit src/prototype.html, not this file. */\n' + fontFaces + baseCss + '\n' + styles.join('\n\n') + '\n');

// Secondary pages (legal, 404) reuse the site's tokens but need a scrolling document.
writeFileSync(join(ASSETS, 'page.css'), `/* Generated by scripts/build.mjs: layout for secondary pages */
html,body{height:auto}
body{overflow:auto;font:16px/1.6 var(--font-ui,system-ui);background:var(--bg,#F6F3EC);color:var(--fg,#29261F)}
.page{max-width:44rem;margin:0 auto;padding:32px 16px 64px}
.page header{display:flex;align-items:center;gap:10px;margin-bottom:32px}
.page header a{color:inherit;text-decoration:none;font-weight:500}
.page header .mark{font-family:var(--font-display,Georgia,serif);color:var(--accent,#B5552F);font-size:22px}
.page h1{font-family:var(--font-display,Georgia,serif);font-weight:500;font-size:2rem;line-height:1.2;margin:0 0 16px}
.page h2{font-family:var(--font-display,Georgia,serif);font-weight:500;font-size:1.4rem;margin:32px 0 8px}
.page p,.page li{max-width:65ch}
.page .notice{border:1px solid var(--line,#E0DACD);background:var(--surface,#FDFCF9);border-radius:12px;padding:16px 18px;margin:24px 0}
.page .legal{color:var(--muted,#6B665C);font-size:.9rem;margin-top:40px}
.page .home-link{display:inline-block;margin-top:24px;padding:10px 16px;border-radius:999px;background:var(--accent,#B5552F);color:var(--on-accent,#fff);text-decoration:none}
`);

// Theme initializer: runs before paint so a stored theme does not flash.
writeFileSync(join(ASSETS, 'theme-init.js'), `/* Generated by scripts/build.mjs. Applies the stored theme before first paint. */
(function(){try{var t=localStorage.getItem('aa-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();
`);
writeFileSync(join(ASSETS, 'app.js'), '/* Generated by scripts/build.mjs. Edit src/prototype.html, not this file. */\n' + scripts.join('\n\n') + '\n');

// ---------- 5. Shared assets (logo, favicon, share image) ----------
let haveOgImage = false;
let haveFavicons = false;
let assetReadme = '';
if (existsSync(SHARED_ASSETS)) {
  // Only the files the site serves; previews, templates and alternates stay in the shared folder.
  const SHIP = /^(favicon\.svg|favicon-32\.png|favicon\.png|apple-touch-icon\.png|icon-512\.png|og-image\.png|logo-(mark|wordmark)-(light|dark)\.svg)$/;
  for (const name of readdirSync(SHARED_ASSETS)) {
    const p = join(SHARED_ASSETS, name);
    if (!statSync(p).isFile()) continue;
    if (/^readme/i.test(name)) { assetReadme = readFileSync(p, 'utf8'); continue; }
    if (!SHIP.test(name)) continue;
    copyFileSync(p, join(PUB, name));
    log(`asset copied: ${name}`);
  }
}
haveOgImage = existsSync(join(PUB, 'og-image.png'));
haveFavicons = existsSync(join(PUB, 'favicon.svg')) || existsSync(join(PUB, 'favicon.png'));
if (!existsSync(join(PUB, 'favicon.svg'))) {
  writeFileSync(join(PUB, 'favicon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#FDFCF9"/><text x="32" y="46" text-anchor="middle" font-family="Newsreader, 'Iowan Old Style', Georgia, serif" font-size="42" fill="#B5552F">§</text></svg>\n`);
  if (!haveFavicons) log('favicon.svg generated (no shared favicon found)');
}
if (!haveOgImage) warn('og-image.png not found in the shared assets folder; the og:image tag points at /og-image.png, which is not served yet');
if (assetReadme) log('shared assets README found (head snippets are described there; the shell uses standard favicon and share-image tags)');

// ---------- 6. Document shell ----------
const haveIcon512 = existsSync(join(PUB, 'icon-512.png'));
if (haveIcon512) {
  writeFileSync(join(PUB, 'site.webmanifest'), JSON.stringify({
    name: 'AgenticAttorney.com',
    short_name: 'AgenticAttorney',
    icons: [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
    theme_color: THEME_LIGHT,
    background_color: THEME_LIGHT,
    display: 'standalone',
  }, null, 2) + '\n');
}
const faviconLinks = [
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
  existsSync(join(PUB, 'favicon-32.png')) ? '<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">' : '',
  existsSync(join(PUB, 'favicon.png')) ? '<link rel="icon" href="/favicon.png" type="image/png" sizes="any">' : '',
  existsSync(join(PUB, 'apple-touch-icon.png')) ? '<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">' : '',
  haveIcon512 ? '<link rel="manifest" href="/site.webmanifest">' : '',
].filter(Boolean).join('\n');

function shell({ title, description, path, body, head = '', scripts = '', pageCss = false, noindex = false }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<meta name="description" content="${description}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${SITE}${path}">`}
<meta property="og:type" content="website">
<meta property="og:site_name" content="AgenticAttorney.com">
<meta property="og:url" content="${SITE}${path}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="AgenticAttorney.com: attorneys for businesses that run on AI agents">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${SITE}/og-image.png">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME_LIGHT}">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${THEME_DARK}">
${faviconLinks}
${preloads.map((p) => `<link rel="preload" href="${p}" as="font" type="font/woff2" crossorigin>`).join('\n')}
<link rel="stylesheet" href="/assets/site.css">
${pageCss ? '<link rel="stylesheet" href="/assets/page.css">' : ''}
<script src="/assets/theme-init.js"></script>
${head}
</head>
<body>
${body}
${scripts}
</body>
</html>
`;
}

const noscript = `<noscript>
<div class="noscript">
<p>AgenticAttorney.com is a free matching service that connects businesses running on AI agents with attorneys in New York, California, Texas and Nevada, and it builds software for attorneys. This page needs JavaScript for the guided conversation, so please email <a href="mailto:${EMAIL}">${EMAIL}</a> instead.</p>
<p>${NOT_A_FIRM}</p>
</div>
</noscript>`;

writeFileSync(join(PUB, 'index.html'), shell({
  title: TITLE,
  description: DESCRIPTION,
  path: '/',
  body: noscript + '\n' + markup,
  head: `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'AgenticAttorney.com', url: `${SITE}/`, description: DESCRIPTION },
      { '@type': 'Organization', name: 'AgenticAttorney.com', legalName: 'Agentic Attorney LLC', url: `${SITE}/`, email: EMAIL,
        logo: existsSync(join(PUB, 'icon-512.png')) ? `${SITE}/icon-512.png` : undefined,
        areaServed: ['New York', 'California', 'Texas', 'Nevada'].map((name) => ({ '@type': 'State', name })) },
    ],
  })}</script>`,
  scripts: '<script src="/assets/app.js"></script>',
}));
log('index.html written');

// ---------- 7. Legal pages ----------
const LEGAL = [
  { slug: 'terms', title: 'Terms of Use', heading: 'Terms of Use' },
  { slug: 'privacy', title: 'Privacy Policy', heading: 'Privacy Policy' },
  { slug: 'disclaimers', title: 'Disclaimers', heading: 'Disclaimers' },
];
const pageHeader = `<header><span class="mark" aria-hidden="true">§</span><a href="/">AgenticAttorney.com</a></header>`;
let legalSource = 'interim';
for (const page of LEGAL) {
  const sharedFile = join(SHARED_LEGAL, `${page.slug}.html`);
  let body;
  let title = `${page.title}: AgenticAttorney.com`;
  if (existsSync(sharedFile)) {
    const html = readFileSync(sharedFile, 'utf8');
    if (/<html[\s>]/i.test(html)) {
      // A full document: serve it as delivered, except that Google Fonts links become the
      // self-hosted font CSS and inline scripts move to files, so the strict CSP holds.
      let out = html
        .replace(/[ \t]*<link[^>]+fonts\.g(oogleapis|static)\.com[^>]*>\s*\n?/gi, '')
        .replace(/<\/title>/i, '</title>\n<link rel="stylesheet" href="/assets/fonts.css">');
      let n = 0;
      out = out.replace(/<script>([\s\S]*?)<\/script>/gi, (m, code) => {
        n += 1;
        const file = `${page.slug}-${n}.js`;
        writeFileSync(join(ASSETS, file), `/* Generated by scripts/build.mjs from the shared legal page ${page.slug}.html. */\n${code.trim()}\n`);
        return `<script src="/assets/${file}"></script>`;
      });
      if (/<script>|\son[a-z]+="|javascript:/i.test(out)) throw new Error(`legal page ${page.slug}.html still has inline script after the rewrite`);
      writeFileSync(join(PUB, `${page.slug}.html`), out);
      log(`legal page copied as a full document: ${page.slug}.html (${n} inline script(s) moved to /assets)`);
      legalSource = 'shared';
      continue;
    }
    const m = html.match(/<title>([\s\S]*?)<\/title>/i);
    if (m) title = m[1].trim();
    const inner = html.replace(/<title>[\s\S]*?<\/title>/i, '').trim();
    body = `<div class="page">${pageHeader}\n${inner}\n<p><a class="home-link" href="/">Back to the home page</a></p></div>`;
    legalSource = 'shared';
    log(`legal page wrapped from the shared folder: ${page.slug}.html`);
  } else {
    body = `<div class="page">${pageHeader}
<h1>${page.heading}</h1>
<div class="notice"><p>This page is being prepared. Until it is published, questions about ${page.title.toLowerCase()} can go to <a href="mailto:${EMAIL}">${EMAIL}</a>.</p></div>
<p class="legal">${NOT_A_FIRM}</p>
<p><a class="home-link" href="/">Back to the home page</a></p>
</div>`;
    log(`legal page generated as an interim page: ${page.slug}.html`);
  }
  writeFileSync(join(PUB, `${page.slug}.html`), shell({ title, description: `${page.title} for AgenticAttorney.com.`, path: `/${page.slug}`, body, pageCss: true }));
}

// ---------- 8. 404, redirects, headers, robots, sitemap ----------
writeFileSync(join(PUB, '404.html'), shell({
  title: 'Page not found: AgenticAttorney.com',
  description: 'That page does not exist.',
  path: '/404',
  noindex: true,
  pageCss: true,
  body: `<div class="page">${pageHeader}
<h1>That page does not exist.</h1>
<p>The address may have been typed wrong, or the page may have moved. The home page has everything the site offers.</p>
<p><a class="home-link" href="/">Go to the home page</a></p>
<p class="legal">${NOT_A_FIRM}</p>
</div>`,
}));

writeFileSync(join(PUB, '_redirects'), `/terms /terms.html 200
/privacy /privacy.html 200
/disclaimers /disclaimers.html 200
`);

// style-src carries 'unsafe-inline' because the prototype's script builds the audit meter with a style attribute.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests";
writeFileSync(join(PUB, '_headers'), `/*
  Content-Security-Policy: ${CSP}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Frame-Options: DENY
  Strict-Transport-Security: max-age=31536000; includeSubDomains

/assets/fonts/*
  Cache-Control: public, max-age=31536000, immutable
`);

writeFileSync(join(PUB, 'robots.txt'), `User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`);

writeFileSync(join(PUB, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['/', '/terms', '/privacy', '/disclaimers'].map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join('\n')}
</urlset>
`);

log(`done. legal pages: ${legalSource}; og-image: ${haveOgImage ? 'present' : 'missing'}; output: ${PUB}`);
