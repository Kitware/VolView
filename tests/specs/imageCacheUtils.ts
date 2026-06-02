export async function getFirstCachedImageSpacing() {
  return browser.execute(() => {
    const app = (document.querySelector('#app') as any)?.__vue_app__;
    const pinia =
      app?.config?.globalProperties?.$pinia ??
      (() => {
        const provides = app?._context?.provides;
        if (!provides) return null;
        return Reflect.ownKeys(provides)
          .map((key) => provides[key as keyof typeof provides])
          .find((value: any) => value?._s instanceof Map);
      })();

    const imageCache = pinia?._s?.get('image-cache');
    const id = imageCache?.imageIds?.[0];
    const imageData = imageCache?.getVtkImageData(id);
    if (!imageData) return null;
    return Array.from(imageData.getSpacing()).map(Number);
  });
}

export async function waitForFirstCachedImageSpacing() {
  let spacing: number[] | null = null;
  await browser.waitUntil(
    async () => {
      spacing = await getFirstCachedImageSpacing();
      return spacing?.length === 3 && spacing.every(Number.isFinite);
    },
    {
      timeout: 30_000,
      timeoutMsg: 'Expected first cached image spacing to become available',
    }
  );
  return spacing!;
}
