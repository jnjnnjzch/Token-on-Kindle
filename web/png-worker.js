import { encodeGrayscalePng, rgbaToGrayscale } from './core.mjs';

self.onmessage = event => {
  const { id, width, height, rgba } = event.data || {};
  try {
    const pixels = new Uint8ClampedArray(rgba);
    const png = encodeGrayscalePng(width, height, rgbaToGrayscale(pixels));
    self.postMessage({ id, png: png.buffer }, [png.buffer]);
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
