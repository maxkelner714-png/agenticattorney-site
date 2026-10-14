// @ts-check
import { test, expect } from '@playwright/test';

const EMAIL = 'info@agenticattorney.com';

/** Collect console errors, page errors, CSP violations and every request URL. */
async function watch(page) {
  const log = { console: [], errors: [], requests: [] };
  page.on('console', (m) => { if (m.type() === 'error') log.console.push(m.text()); });
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('request', (r) => log.requests.push(r.url()));
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  });
  return log;
}

const cspViolations = (page) => page.evaluate(() => window.__csp || []);
const chip = (page) => page.locator('#choices .chip');
const mailtoHref = async (page) => {
  const a = page.locator(`a[href^="mailto:${EMAIL}"]`).last();
  await expect(a).toBeVisible();
  return decodeURIComponent((await a.getAttribute('href')) || '');
};

async function clickChips(page, n) {
  for (let i = 0; i < n; i++) {
    const c = chip(page).first();
    await expect(c).toBeVisible();
    const before = await page.locator('#thread').innerHTML();
    await c.click();
    await expect.poll(() => page.locator('#thread').innerHTML()).not.toBe(before);
  }
}

test('index loads clean: no console or page errors, no CSP violations, nothing leaves the origin', async ({ page, baseURL }) => {
  const log = await watch(page);
  await page.goto('/');
  await expect(page.locator('#starters .starter').first()).toBeVisible();
  await expect(page).toHaveTitle(/AgenticAttorney\.com: attorneys for businesses that run on AI agents/);
  await page.waitForLoadState('networkidle');
  expect(log.errors, 'page errors').toEqual([]);
  expect(log.console, 'console errors').toEqual([]);
  expect(await cspViolations(page), 'CSP violations').toEqual([]);
  const offsite = log.requests.filter((u) => !u.startsWith(baseURL));
  expect(offsite, 'requests leaving the origin').toEqual([]);
  expect(log.requests.length).toBeGreaterThan(3);
});

test('deep links select the right tab', async ({ page }) => {
  await page.goto('/#attorneys');
  await expect(page.locator('#tab-att')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#starters')).toContainText('Join as an attorney');
  await page.goto('/#businesses');
  await expect(page.locator('#tab-biz')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#starters')).toContainText('Find an attorney');
});

test('businesses: match flow ends in a mailto with New York in the body', async ({ page }) => {
  const log = await watch(page);
  await page.goto('/');
  await page.locator('#starters .starter', { hasText: 'Find an attorney' }).click();
  const ny = chip(page).filter({ hasText: 'New York' });
  await expect(ny).toBeVisible();
  await ny.click();
  await clickChips(page, 4);
  const href = await mailtoHref(page);
  expect(href).toContain('mailto:' + EMAIL);
  expect(href).toContain('New York');
  expect(href).toContain('Match request');
  expect(log.errors).toEqual([]);
  expect(await cspViolations(page)).toEqual([]);
});

test('attorneys: pricing and the join flow', async ({ page }) => {
  const log = await watch(page);
  await page.goto('/#attorneys');
  await page.locator('#starters .starter', { hasText: 'Pricing' }).click();
  await expect(page.locator('#thread')).toContainText('Founding attorney');
  await page.locator('#startNav .nav-item', { hasText: 'Join as an attorney' }).click();
  await expect(page.locator('#thread')).toContainText('Join as a founding attorney');
  const href = await mailtoHref(page);
  expect(href).toContain('subject=Joining AgenticAttorney.com');
  for (const heading of ['Name:', 'States where you are licensed', 'Practice areas:', 'Firm name and size:']) expect(href).toContain(heading);
  expect(log.errors).toEqual([]);
  expect(await cspViolations(page)).toEqual([]);
});

test.describe('phone width 360x780', () => {
  test.use({ viewport: { width: 360, height: 780 } });
  const noOverflow = async (page, label) => {
    const w = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth, main: document.getElementById('main').scrollWidth,
      scroll: document.getElementById('scroll').scrollWidth, inner: window.innerWidth,
    }));
    expect(w.doc, `${label}: document width`).toBeLessThanOrEqual(w.inner);
    expect(w.main, `${label}: main width`).toBeLessThanOrEqual(w.inner);
    expect(w.scroll, `${label}: scroll width`).toBeLessThanOrEqual(w.inner);
  };
  test('no horizontal overflow on home and mid-flow, both tabs', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#starters .starter').first()).toBeVisible();
    await noOverflow(page, 'businesses home');
    await page.locator('#starters .starter', { hasText: 'Find an attorney' }).click();
    await expect(chip(page).first()).toBeVisible();
    await clickChips(page, 2);
    await noOverflow(page, 'businesses mid-flow');
    await page.goto('/#attorneys');
    await expect(page.locator('#starters .starter').first()).toBeVisible();
    await noOverflow(page, 'attorneys home');
    await page.locator('#starters .starter', { hasText: 'Pricing' }).click();
    await expect(page.locator('#thread')).toContainText('Founding attorney');
    await noOverflow(page, 'attorneys mid-flow');
  });
});

test('legal routes and 404', async ({ page, request }) => {
  for (const [path, title] of [['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/disclaimers', 'Disclaimers']]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.locator('h1')).toContainText(title);
    await expect(page).toHaveTitle(new RegExp(title));
    await expect(page.locator('a[href="/"]').first()).toBeVisible();
  }
  const res = await page.goto('/nope');
  expect(res?.status()).toBe(404);
  await expect(page.locator('h1')).toContainText('does not exist');
  const r = await request.get('/nope');
  expect(r.status()).toBe(404);
  expect(await r.text()).toContain('Go to the home page');
});

test('headers and noscript', async ({ request }) => {
  const r = await request.get('/');
  const html = await r.text();
  expect(html).toContain('<noscript>');
  expect(html).toContain(EMAIL);
  expect(html).toContain('not a law firm');
  expect(html).not.toMatch(/<script>|\son[a-z]+="/);
  expect(r.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(r.headers()['x-content-type-options']).toBe('nosniff');
  const f = await request.get('/assets/fonts/geist-latin-wght-normal.woff2');
  expect(f.status()).toBe(200);
  expect(f.headers()['cache-control']).toContain('immutable');
});
