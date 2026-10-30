export async function step<T>(
  label: string | undefined,
  operation: () => Promise<T>
) {
  if (!label) return operation();
  const started = Date.now();
  console.info(
    '[adaptive-step]',
    JSON.stringify({
      phase: 'start',
      label,
      at: new Date(started).toISOString(),
      operation: operation.toString().replace(/\s+/g, ' ').slice(0, 180),
    })
  );
  try {
    const value = await operation();
    console.info(
      '[adaptive-step]',
      JSON.stringify({
        phase: 'end',
        label,
        at: new Date().toISOString(),
        elapsed: Date.now() - started,
      })
    );
    return value;
  } catch (error) {
    console.info(
      '[adaptive-step]',
      JSON.stringify({
        phase: 'error',
        label,
        at: new Date().toISOString(),
        elapsed: Date.now() - started,
        error: String(error),
      })
    );
    throw error;
  }
}
export async function viewport(label: string) {
  const value = await step(label + '/viewport', () =>
    browser.execute(() => ({
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      visibility: document.visibilityState,
      url: location.href,
    }))
  );
  console.info(
    '[adaptive-viewport]',
    JSON.stringify({
      label,
      browser: browser.capabilities.browserVersion,
      platform: browser.capabilities.platformName,
      ...value,
    })
  );
}
