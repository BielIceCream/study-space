import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const screens = [{ width: 1366, height: 768 }, { width: 1600, height: 900 }, { width: 1920, height: 1080 }];
const scales = [1, 1.25, 1.5];
const recording = process.env.STUDYSPACE_VISUAL_BASELINE === '1';

for (const screen of screens) for (const scale of scales) {
  // Reserve logical space for the standard Windows title bar/taskbar. This is a
  // renderer simulation; actual WebView2/OS DPI equivalence requires native QA.
  const viewport = { width: Math.floor(screen.width / scale) - 16, height: Math.floor(screen.height / scale) - 80 };
  const name = `${screen.width}x${screen.height}-${scale * 100}pct`;
  test(`Biblioteca Windows ${name}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: scale, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
    try {
      await page.goto('http://127.0.0.1:1420');
      await expect(page.getByRole('heading', { name: 'Seu espaço, seu ritmo.' })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('.welcome-banner')).toBeVisible();
      await expect(page.locator('.study-illustration')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await page.evaluate(() => document.fonts.check('14px "Inter Variable"') && document.fonts.check('27px "Manrope Variable"'))).toBe(true);
      const sidebar = page.locator('.sidebar');
      const rectangle = await sidebar.boundingBox();
      const report = { screen, scale, viewport, sidebarHeight: rectangle?.height, sidebarOverflow: (rectangle?.height ?? 0) > viewport.height };
      const reportPath = recording ? 'docs/windows/reference' : '.cache/desktop-visual';
      await mkdir(reportPath, { recursive: true });
      await writeFile(join(reportPath, `${name}.json`), JSON.stringify(report, null, 2) + '\n');
      // Keep evidence of the real mission UI before hiding only its authorized controls.
      await expect(page.getByRole('button', { name: 'Abrir JARVIS', exact: true })).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`library-${name}-real-ui.png`), animations: 'disabled' });
      const missionStyle = await page.addStyleTag({ content: '[data-mission-control] { display: none !important; }' });
      // Only the short sidebar is masked: its old min-height clips controls and
      // the explicit correction is checked below. All other pixels stay compared.
      try {
        await expect(page).toHaveScreenshot(`library-${name}.png`, {
          animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.001,
          mask: viewport.height < 500 ? [sidebar] : [],
        });
      } finally { await missionStyle.evaluate(element => element.parentNode?.removeChild(element)); }
      await page.screenshot({ path: testInfo.outputPath(`library-${name}-unmasked.png`), animations: 'disabled' });
      if (!recording) {
        expect(report.sidebarOverflow).toBe(false);
        await page.getByRole('button', { name: 'Ativar tema escuro' }).scrollIntoViewIfNeeded();
        await expect(page.getByRole('button', { name: 'Ativar tema escuro' })).toBeInViewport();
        await page.getByRole('button', { name: 'Ativar tema escuro' }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await page.getByRole('button', { name: 'Biblioteca', exact: true }).scrollIntoViewIfNeeded();
        await expect(page.getByRole('button', { name: 'Biblioteca', exact: true })).toBeInViewport();
      }
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
