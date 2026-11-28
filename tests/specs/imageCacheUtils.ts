import { expect, type Page } from '@playwright/test';

type CachedImageScalars = { type: string; values: number[] };

export const createImageCacheUtils = (page: Page) => {
  const readFirstCachedImage = (property: 'spacing' | 'complete-scalars') =>
    page.evaluate((requestedProperty) => {
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

  const getFirstCachedImageSpacing = () =>
    readFirstCachedImage('spacing') as Promise<number[] | null>;

  const waitForFirstCachedImageSpacing = async () => {
    let spacing: number[] | null = null;
    await expect
      .poll(
        async () => {
          spacing = await getFirstCachedImageSpacing();
          return spacing?.length === 3 && spacing.every(Number.isFinite);
        },
        {
          message: 'Expected first cached image spacing to become available',
        }
      )
      .toBe(true);
    return spacing!;
  };

  const getFirstCompleteCachedImageScalars = () =>
    readFirstCachedImage(
      'complete-scalars'
    ) as Promise<CachedImageScalars | null>;

  const waitForFirstCompleteCachedImageScalars = async () => {
    let scalars: CachedImageScalars | null = null;
    await expect
      .poll(
        async () => {
          scalars = await getFirstCompleteCachedImageScalars();
          return scalars !== null;
        },
        {
          message: 'Expected first cached image scalars to become available',
        }
      )
      .toBe(true);
    return scalars!;
  };

  return {
    getFirstCachedImageSpacing,
    waitForFirstCachedImageSpacing,
    getFirstCompleteCachedImageScalars,
    waitForFirstCompleteCachedImageScalars,
  };
};

export type ImageCacheUtils = ReturnType<typeof createImageCacheUtils>;
