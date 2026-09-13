import { chromium } from 'playwright';
export async function launchExtension(profile, extension) {
  const system = process.env.BILI_TEST_CHROME;
  const context = await chromium.launchPersistentContext(profile, {
    ...(system ? { executablePath: system } : { channel: 'chromium' }),
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: system
      ? ['--enable-unsafe-extension-debugging']
      : [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1360, height: 900 },
  });
  if (system) {
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: extension });
    await cdp.detach();
  }
  return context;
}
