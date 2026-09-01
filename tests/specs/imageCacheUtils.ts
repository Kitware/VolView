type CachedImageScalars = { type: string; values: number[] };

async function readFirstCachedImage(property: 'spacing' | 'complete-scalars') {
  return browser.execute((requestedProperty) => {
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
    if (requestedProperty === 'spacing') {
      return Array.from(imageData.getSpacing()).map(Number);
    }
    if (imageCache.imageStatus[id] !== 'complete') return null;

    const data = imageData.getPointData().getScalars()?.getData();
    if (!data) return null;
    return {
      type: data.constructor.name,
      values: Array.from(data as ArrayLike<number>),
    };
  }, property);
}

export function getFirstCachedImageSpacing() {
  return readFirstCachedImage('spacing') as Promise<number[] | null>;
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

export function getFirstCompleteCachedImageScalars() {
  return readFirstCachedImage(
    'complete-scalars'
  ) as Promise<CachedImageScalars | null>;
}

export async function waitForFirstCompleteCachedImageScalars() {
  let scalars: CachedImageScalars | null = null;
  await browser.waitUntil(
    async () => {
      scalars = await getFirstCompleteCachedImageScalars();
      return scalars !== null;
    },
    {
      timeout: 30_000,
      timeoutMsg: 'Expected first cached image scalars to become available',
    }
  );
  return scalars!;
}
