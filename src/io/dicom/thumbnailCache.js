export default class ThumbnailCache {
  constructor(defaultWidth, defaultHeight) {
    this.cache = new WeakMap();
    this.width = defaultWidth;
    this.height = defaultHeight;
  }

  async getThumbnail(dicomImage) {
    if (this.cache.has(dicomImage)) {
      return this.cache.get(dicomImage);
    }

    const {
      rows,
      cols,
      minValue,
      maxValue,
      pixelData,
    } = dicomImage;

    const imdata = new ImageData(cols, rows);
    for (let i = 0, si = 0; i < pixelData.length; i += 1, si += 4) {
      const pixel = Math.floor(255 * ((pixelData[i] - minValue) / maxValue));
      imdata.data[si + 0] = pixel;
      imdata.data[si + 1] = pixel;
      imdata.data[si + 2] = pixel;
      imdata.data[si + 3] = 255;
    }

    this.cache.set(dicomImage, imdata);
    return imdata;
  }
}
