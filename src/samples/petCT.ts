import sources from './pet-ct-sources.json' with { type: 'json' };

export const PET_CT_SOURCES = sources.map((source) => ({
  ...source,
  url: `https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?${new URLSearchParams(
    {
      SeriesInstanceUID: source.series,
      SOPInstanceUID: source.sop,
    }
  )}`,
}));

export const PET_CT_URLS = PET_CT_SOURCES.map(({ url }) => url);
