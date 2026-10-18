import sources from '../../scripts/samples/pet-ct-sources.json';

export const PET_CT_URLS = sources.map(
  (source) =>
    `https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?${new URLSearchParams(
      {
        SeriesInstanceUID: source.series,
        SOPInstanceUID: source.sop,
      }
    )}`
);
