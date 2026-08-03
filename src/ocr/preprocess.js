/**
 * Зургийг OCR-т бэлдэх canvas дээрх урьдчилсан боловсруулалт.
 *
 * Хоёр хөдөлгүүр ӨӨР ӨӨР бэлтгэл шаарддаг:
 *  - Tesseract: саарал, контраст сунгасан, шаардлагатай бол хоёртын (binary)
 *    зураг дээр хамгийн сайн ажиллана.
 *  - Claude (VLM): ӨНГӨТ, боловсруулаагүй зураг дээр илүү сайн ажиллана —
 *    binarization нь загварын нарийвчлалыг БУУРУУЛНА.
 */

/** Tesseract ойролцоогоор 300 DPI-д тохируулагдсан; өргөнийг энэ мужид байлгана. */
const TESSERACT_MIN_WIDTH = 1000;
const TESSERACT_MAX_WIDTH = 2600;
/** Санах ой хамгаалалт — үүнээс их пикселтэй зургийг заавал багасгана. */
const MAX_PIXELS = 12_000_000;

/** Claude Opus 5-ын өндөр нарийвчлалтай харааны дээд хязгаар (урт тал). */
const VLM_MAX_EDGE = 2576;
const VLM_JPEG_QUALITY = 0.85;

/**
 * Файлыг ImageBitmap болгож уншина. EXIF эргэлтийг тооцно — утасны зураг
 * хажуу тийш хэвтэж уншигдахаас сэргийлнэ.
 *
 * @param {Blob} file
 * @returns {Promise<ImageBitmap|HTMLImageElement>}
 */
export async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Хуучин браузер options-ыг дэмжихгүй байж магадгүй — доорх зам руу унана.
    }
  }
  return loadViaImageElement(file);
}

function loadViaImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Зургийг унших боломжгүй байна.'));
    };
    img.src = url;
  });
}

function bitmapSize(bitmap) {
  return {
    width: bitmap.width || bitmap.naturalWidth,
    height: bitmap.height || bitmap.naturalHeight,
  };
}

function drawScaled(bitmap, targetWidth, targetHeight) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(targetWidth));
  canvas.height = Math.max(1, Math.round(targetHeight));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/** Tesseract-д тохирох масштабын коэффициентийг тооцно. */
function tesseractScale(width, height) {
  let scale = 1;
  if (width < TESSERACT_MIN_WIDTH) scale = TESSERACT_MIN_WIDTH / width;
  else if (width > TESSERACT_MAX_WIDTH) scale = TESSERACT_MAX_WIDTH / width;

  // Хэт бага зургийг 3 дахинаас илүү сунгах нь ямар ч мэдээлэл нэмэхгүй.
  scale = Math.min(scale, 3);

  const pixels = width * scale * height * scale;
  if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels);
  return scale;
}

/**
 * Luminance-аар саарал болгож, гистограммын 2/98 percentile-ээр контрастыг
 * сунгана. Энэ нь сүүдэртэй, бүдэг гэрэл зураг дээр хамгийн их нөлөөтэй алхам.
 *
 * @returns {Uint8ClampedArray} нэг сувагт саарал утгууд
 */
function toGrayWithContrastStretch(imageData) {
  const { data, width, height } = imageData;
  const count = width * height;
  const gray = new Uint8ClampedArray(count);
  const histogram = new Uint32Array(256);

  for (let i = 0, p = 0; i < count; i += 1, p += 4) {
    const value =
      (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    const rounded = value | 0;
    gray[i] = rounded;
    histogram[rounded] += 1;
  }

  const lowCut = count * 0.02;
  const highCut = count * 0.98;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let v = 0; v < 256; v += 1) {
    acc += histogram[v];
    if (acc >= lowCut) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 0; v < 256; v += 1) {
    acc += histogram[v];
    if (acc >= highCut) {
      hi = v;
      break;
    }
  }

  // Хэт хавтгай гистограмм дээр сунгах нь шумыг л томруулна.
  if (hi - lo >= 16) {
    const span = hi - lo;
    for (let i = 0; i < count; i += 1) {
      gray[i] = ((gray[i] - lo) * 255) / span;
    }
  }
  return gray;
}

/**
 * Bradley/Roth локал (адаптив) хоёртчлол — integral image ашиглана.
 * Тэгш бус гэрэлтэй гэрэл зураг дээр Tesseract-ын дотоод global Otsu-гаас
 * илүү ажиллана. Тэгш гэрэлтэй сканд шаардлагагүй тул сонголтоор өгсөн.
 */
function adaptiveThreshold(gray, width, height, windowRatio = 0.05, bias = 0.15) {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += gray[y * width + x];
      integral[(y + 1) * (width + 1) + (x + 1)] =
        integral[y * (width + 1) + (x + 1)] + rowSum;
    }
  }

  const radius = Math.max(
    7,
    Math.round((Math.min(width, height) * windowRatio) / 2),
  );
  const out = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * (width + 1) + (x1 + 1)] -
        integral[y0 * (width + 1) + (x1 + 1)] -
        integral[(y1 + 1) * (width + 1) + x0] +
        integral[y0 * (width + 1) + x0];
      const mean = sum / area;
      out[y * width + x] = gray[y * width + x] < mean * (1 - bias) ? 0 : 255;
    }
  }
  return out;
}

/**
 * Tesseract-д өгөх canvas бэлдэнэ.
 *
 * @param {ImageBitmap|HTMLImageElement} bitmap
 * @param {{binarize?: boolean}} [options] `binarize` — тэгш бус гэрэлтэй
 *   гэрэл зурагт л асаах (default: false).
 * @returns {HTMLCanvasElement}
 */
export function forTesseract(bitmap, options = {}) {
  const { binarize = false } = options;
  const { width, height } = bitmapSize(bitmap);
  const scale = tesseractScale(width, height);

  const { canvas, ctx } = drawScaled(bitmap, width * scale, height * scale);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let channel = toGrayWithContrastStretch(imageData);
  if (binarize) {
    channel = adaptiveThreshold(channel, canvas.width, canvas.height);
  }

  const { data } = imageData;
  for (let i = 0, p = 0; i < channel.length; i += 1, p += 4) {
    data[p] = channel[i];
    data[p + 1] = channel[i];
    data[p + 2] = channel[i];
    data[p + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Зураг кодлож чадсангүй.'))),
      type,
      quality,
    );
  });
}

async function blobToBase64(blob) {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  // Том буферийг нэг дор `fromCharCode`-д өгвөл стек халина — хэсэгчлэн хөрвүүлнэ.
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < buffer.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, buffer.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Claude vision-д илгээх зураг бэлдэнэ: ӨНГӨТ, урт тал ≤ 2576px, JPEG.
 * Хоёртчлол болон саарал болголт ХИЙХГҮЙ — VLM-д эх өнгө нь илүү мэдээлэл өгнө.
 *
 * @param {ImageBitmap|HTMLImageElement} bitmap
 * @returns {Promise<{base64: string, mediaType: string, width: number, height: number, byteLength: number}>}
 */
export async function forVlm(bitmap) {
  const { width, height } = bitmapSize(bitmap);
  const longEdge = Math.max(width, height);
  const scale = longEdge > VLM_MAX_EDGE ? VLM_MAX_EDGE / longEdge : 1;

  const { canvas } = drawScaled(bitmap, width * scale, height * scale);
  const blob = await canvasToBlob(canvas, 'image/jpeg', VLM_JPEG_QUALITY);

  return {
    base64: await blobToBase64(blob),
    mediaType: 'image/jpeg',
    width: canvas.width,
    height: canvas.height,
    byteLength: blob.size,
  };
}
