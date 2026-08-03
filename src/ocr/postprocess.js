/**
 * Монгол (кирилл) + Англи (латин) холимог OCR текстийг цэвэрлэх.
 *
 * Гол асуудал: Tesseract-ыг `mon+eng` хосолсон charset-тэй ажиллуулахад нэг үг
 * дотор хоёр скриптийн ХАРАГДАЦААР ЯЛГААГҮЙ тэмдэгтүүд холилддог —
 * `МОНГОЛ` нь `MOHГOЛ` (латин M, O, H) болж гарна. Нүдээр ижил ч хайлт,
 * эрэмбэлэлт, spell-check, цаашдын боловсруулалт бүгд эвдэрнэ.
 *
 * Шийдэл: үг тус бүрийг тусад нь авч, ХОЁРДМОЛ БУС тэмдэгтүүдээр нь аль
 * скриптийнх болохыг шийдээд, хоёрдмол тэмдэгтүүдийг тэр скрипт рүү нэгтгэнэ.
 *
 * Энэ модуль нь цэвэр функцуудаас бүрдэнэ (DOM хамааралгүй) — `node --test`-ээр
 * шууд тестлэгддэг. `scripts/postprocess.test.mjs`-ийг үзнэ үү.
 */

/**
 * Кирилл ↔ латин хоорондоо БАРАГ БҮХ ФОНТОД ЯЛГААГҮЙ харагддаг хосууд.
 * Зөвхөн үнэхээр ижил хэлбэртэйг нь оруулсан — жишээ нь кирилл `м`/латин `m`
 * ихэнх фонтод өөр харагддаг тул ОРУУЛААГҮЙ (буруу засварт хүргэнэ).
 */
const HOMOGLYPHS = [
  ['А', 'A'], ['В', 'B'], ['Е', 'E'], ['К', 'K'], ['М', 'M'], ['Н', 'H'],
  ['О', 'O'], ['Р', 'P'], ['С', 'C'], ['Т', 'T'], ['У', 'Y'], ['Х', 'X'],
  ['а', 'a'], ['е', 'e'], ['о', 'o'], ['р', 'p'], ['с', 'c'], ['у', 'y'],
  ['х', 'x'],
];

const LAT_TO_CYR = new Map(HOMOGLYPHS.map(([cyr, lat]) => [lat, cyr]));
const CYR_TO_LAT = new Map(HOMOGLYPHS.map(([cyr, lat]) => [cyr, lat]));

/**
 * Кирилл рүү шийдэгдсэн үг дотор л хэрэглэгдэх нэмэлт засварууд.
 * Tesseract нь монголын өвөрмөц Ө/Ү үсгийг грек эсвэл латин extended
 * тэмдэгтээр орлуулж гаргах нь элбэг.
 */
const CYR_EXTRAS = new Map([
  ['θ', 'ө'], ['Θ', 'Ө'], // грек theta θ Θ
  ['ɵ', 'ө'], ['Ɵ', 'Ө'], // латин ɵ Ɵ (barred o)
  ['γ', 'ү'], ['Υ', 'Ү'], // грек gamma γ / upsilon Υ
]);

/** Кирилл рүү шийдэгдсэн, БОДИТ нотолгоотой үг дотор л хэрэглэх тооны засвар. */
const CYR_DIGITS = new Map([['3', 'З'], ['0', 'О']]);

const CYRILLIC_BLOCK = /[Ѐ-ӿ]/;
const LATIN_BASIC = /[A-Za-z]/;
const LETTER = /\p{L}/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Үг гэж үзэх зүйл: үсэг/тоо/зураас/апостроф-ийн дараалал (`Bloomberg-ийн`, `COVID-19`). */
const TOKEN_RE = /[\p{L}\p{N}'’-]+/gu;

/** Хоёрдмол БИШ кирилл тэмдэгт мөн үү (= кирилл гэдгийн нотолгоо). */
function isCyrillicEvidence(ch) {
  return CYRILLIC_BLOCK.test(ch) && !CYR_TO_LAT.has(ch);
}

/** Хоёрдмол БИШ латин тэмдэгт мөн үү (= латин гэдгийн нотолгоо). */
function isLatinEvidence(ch) {
  return LATIN_BASIC.test(ch) && !LAT_TO_CYR.has(ch);
}

/**
 * Бүх текстийн давамгай скриптийг тодорхойлно. Нотолгоо огт агуулаагүй
 * (бүхэлдээ хоёрдмол) үгийг шийдэхэд л хэрэглэгдэнэ.
 *
 * @returns {'cyr'|'lat'|null} 80%-иас давсан тодорхой давамгай байхгүй бол null.
 */
export function detectDominantScript(text) {
  let cyr = 0;
  let lat = 0;
  for (const ch of text) {
    if (isCyrillicEvidence(ch)) cyr += 1;
    else if (isLatinEvidence(ch)) lat += 1;
  }
  const total = cyr + lat;
  if (total < 10) return null; // хэт бага дээж — таамаглахгүй
  if (cyr / total > 0.8) return 'cyr';
  if (lat / total > 0.8) return 'lat';
  return null;
}

/**
 * Нэг үгийн скриптийг шийдэж, хоёрдмол тэмдэгтүүдийг нэгтгэнэ.
 *
 * @param {string} token
 * @param {{dominant: 'cyr'|'lat'|null, useDominant: boolean}} ctx
 */
function fixToken(token, ctx) {
  let cyrEvidence = 0;
  let latEvidence = 0;
  let letterCount = 0;
  let digitCount = 0;
  let unmappableDigit = false;

  for (const ch of token) {
    if (isCyrillicEvidence(ch)) cyrEvidence += 1;
    else if (isLatinEvidence(ch)) latEvidence += 1;
    if (LETTER.test(ch)) letterCount += 1;
    else if (/\p{N}/u.test(ch)) {
      digitCount += 1;
      if (!CYR_DIGITS.has(ch)) unmappableDigit = true;
    }
  }

  let target = null;
  if (cyrEvidence > 0 && latEvidence === 0) target = 'cyr';
  else if (latEvidence > 0 && cyrEvidence === 0) target = 'lat';
  else if (cyrEvidence === 0 && latEvidence === 0) {
    // Бүхэлдээ хоёрдмол — өөрийн нотолгоо алга.
    // Зөвхөн 3+ үсэгтэй, тоогүй үг дээр л баримтын давамгай хэлээр шийднэ.
    // Ингэснээр `A4`, `MP3`, `CD`, `OK` зэрэг богино/тоотой товчлол хөндөгдөхгүй.
    if (ctx.useDominant && ctx.dominant && letterCount >= 3 && digitCount === 0) {
      target = ctx.dominant;
    }
  }
  // cyrEvidence > 0 && latEvidence > 0 → жинхэнэ холимог (`Bloomberg-ийн`) → хөндөхгүй.

  if (!target) return token;

  const map = target === 'cyr' ? LAT_TO_CYR : CYR_TO_LAT;
  // Тооны засварыг зөвхөн БОДИТ кирилл нотолгоотой үед хийнэ (давамгай
  // хэлээр таамагласан үед биш) — `MP3` мэтийг эвдэхээс сэргийлнэ.
  const applyDigits =
    target === 'cyr' && cyrEvidence > 0 && letterCount >= 2 && !unmappableDigit;

  let out = '';
  for (const ch of token) {
    if (map.has(ch)) out += map.get(ch);
    else if (target === 'cyr' && CYR_EXTRAS.has(ch)) out += CYR_EXTRAS.get(ch);
    else if (applyDigits && CYR_DIGITS.has(ch)) out += CYR_DIGITS.get(ch);
    else out += ch;
  }
  return out;
}

/**
 * Текст доторх үг бүрийн скриптийг нэгтгэнэ.
 *
 * @param {string} text
 * @param {{useDominant?: boolean, dominant?: 'cyr'|'lat'|null}} [options]
 */
export function normalizeScripts(text, options = {}) {
  const { useDominant = true } = options;
  const dominant =
    options.dominant !== undefined ? options.dominant : detectDominantScript(text);
  const ctx = { dominant, useDominant };
  return text.replace(TOKEN_RE, (token) => fixToken(token, ctx));
}

/** CRLF/CR → LF, мөрийн ард үлдсэн зайг таслах, тэг өргөнтэй тэмдэгт цэвэрлэх. */
export function normalizeWhitespace(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
}

/**
 * Үсэг ч, тоо ч агуулаагүй мөрийг хаяна (OCR-ийн ирмэгийн шум: `|`, `~-~`, `.`).
 * Хоосон мөрийг ХАДГАЛНА — тэдгээр нь догол мөрийн зааг.
 */
export function stripNoiseLines(text) {
  return text
    .split('\n')
    .filter((line) => line.trim() === '' || LETTER_OR_DIGIT.test(line))
    .join('\n');
}

/**
 * Мөр төгсгөлийн зураасаар тасарсан үгийг нийлүүлнэ:
 * `үргэлжил-\nсэн` → `үргэлжилсэн`. Дараагийн мөр жижиг үсгээр эхэлж байж л
 * нийлүүлнэ — жагсаалтын `-` эсвэл нэрийн зураасыг эвдэхгүйн тулд.
 */
export function joinHyphenatedLineBreaks(text) {
  return text.replace(
    /(\p{L})[-‐‑]\n[ \t]*(\p{Ll})/gu,
    (_m, before, after) => before + after,
  );
}

/** Цэг таслалын өмнөх илүү зай авах, `,`/`;`-ийн дараа зай баталгаажуулах. */
export function fixPunctuationSpacing(text) {
  return text
    .replace(/[ \t]+([,.;:!?%»)\]}])/g, '$1')
    .replace(/([«([{])[ \t]+/g, '$1')
    .replace(/(\p{L})([,;])(\p{L})/gu, '$1$2 $3');
}

/** 3+ дараалсан хоосон мөрийг 2 болгож, эхлэл/төгсгөлийн хоосон зайг авна. */
export function collapseBlankLines(text) {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Бүрэн цэвэрлэх дараалал.
 *
 * @param {string} raw OCR хөдөлгүүрийн түүхий гаралт
 * @param {object} [options]
 * @param {boolean} [options.useDominant=true] Бүхэлдээ хоёрдмол үгийг баримтын
 *   давамгай хэлээр шийдэх эсэх. Монгол баримтад ашигтай; олон англи товчлолтой
 *   баримтад унтраахыг зөвлөнө.
 * @param {boolean} [options.stripNoise=true]
 * @param {'cyr'|'lat'|null} [options.dominant] Давамгай хэлийг гаднаас өгөх.
 *   Мөр мөрөөр нь цэвэрлэхэд БҮХ баримтаас тооцсон утгыг дамжуулахад хэрэгтэй —
 *   ганц мөрөөс давамгай хэлийг тодорхойлох боломжгүй.
 * @returns {string}
 */
export function cleanText(raw, options = {}) {
  const { useDominant = true, stripNoise = true } = options;
  if (!raw) return '';

  let text = normalizeWhitespace(raw);
  if (stripNoise) text = stripNoiseLines(text);
  text = joinHyphenatedLineBreaks(text);
  text = normalizeScripts(
    text,
    'dominant' in options
      ? { useDominant, dominant: options.dominant }
      : { useDominant },
  );
  text = fixPunctuationSpacing(text);
  return collapseBlankLines(text);
}

/**
 * Мөрийн ЖАГСААЛТЫГ цэвэрлэнэ.
 *
 * Яагаад тусдаа функц вэ: UI нь мөр бүрийг итгэлцүүртэй нь тусад нь харуулдаг
 * тул мөрүүдийг нэг бүрчлэн `cleanText`-ээр дамжуулах уруу таталт үүсдэг.
 * Гэвч зураас нийлүүлэлт нь ХОЁР МӨРИЙГ хамардаг тул тэгвэл хийгдэхгүй —
 * улмаар харагдаж буй текст болон хуулагдах текст ЗӨРНӨ.
 *
 * Тиймээс нийлүүлэлтийг жагсаалтын түвшинд хийж, `linesToText`-ээр эцсийн
 * текстийг ЯГ ЭНЭ мөрүүдээс угсарна — эх сурвалж нэг болно.
 *
 * @param {{text: string, confidence: number|null}[]} rawLines
 * @param {{useDominant?: boolean, dominant?: 'cyr'|'lat'|null}} [options]
 * @returns {{text: string, confidence: number|null}[]}
 */
export function cleanLines(rawLines, options = {}) {
  const merged = [];
  /**
   * Хоосон мөрийг ШУУД гаргахгүй хойшлуулна. Учир нь өргөн мөр хоорондын
   * зайтай зураг дээр Tesseract мөр бүрийг тусдаа догол мөр гэж үзэж, мөр
   * бүрийн хооронд хоосон мөр оруулдаг. Тэгвэл зураасаар тасарсан үг хэзээ ч
   * нийлэхгүй болно. Хойшлуулснаар "мөр төгсгөлийн зураас" гэдэг илүү хүчтэй
   * дохио давамгайлна.
   */
  let sawBlank = false;

  for (const line of rawLines) {
    const text = normalizeWhitespace(line.text || '');

    if (text.trim() === '') {
      sawBlank = true;
      continue;
    }
    // Үсэг ч, тоо ч агуулаагүй мөр = OCR шум.
    if (!LETTER_OR_DIGIT.test(text)) continue;

    const previous = merged[merged.length - 1];
    const continuesPrevious =
      previous &&
      /\p{L}[-‐‑]$/u.test(previous.text) &&
      /^\p{Ll}/u.test(text.trim());

    if (continuesPrevious) {
      previous.text = previous.text.replace(/[-‐‑]$/, '') + text.trim();
      // Нийлсэн мөрийн итгэлцүүр нь хоёрын СУЛ нь — хамгийн эргэлзээтэй
      // хэсгийг нуухгүй байх ёстой.
      previous.confidence = minConfidence(previous.confidence, line.confidence);
      sawBlank = false;
      continue;
    }

    // Хамгийн ихдээ НЭГ хоосон мөр гаргана — `collapseBlankLines`-тай ижил
    // үр дүн өгснөөр дэлгэц дээрх мөрүүд болон эцсийн текст яг таарна.
    if (sawBlank && merged.length > 0) merged.push({ text: '', confidence: null });
    sawBlank = false;

    merged.push({ text, confidence: line.confidence ?? null });
  }

  const dominantOption =
    'dominant' in options ? { dominant: options.dominant } : {};

  return merged.map((line) => ({
    ...line,
    text: fixPunctuationSpacing(
      normalizeScripts(line.text, {
        useDominant: options.useDominant !== false,
        ...dominantOption,
      }),
    ),
  }));
}

function minConfidence(a, b) {
  if (typeof a !== 'number') return typeof b === 'number' ? b : null;
  if (typeof b !== 'number') return a;
  return Math.min(a, b);
}

/** Цэвэрлэсэн мөрүүдээс эцсийн текстийг угсарна (харагдац = хуулагдах текст). */
export function linesToText(lines) {
  return collapseBlankLines(lines.map((line) => line.text).join('\n'));
}
