/**
 * `node --test scripts/postprocess.test.mjs`
 *
 * Хоёрдмол (homoglyph) тэмдэгттэй холбоотой тестүүдэд оролт/хүлээлтийг
 * `\uXXXX` escape-ээр бичсэн. Учир нь кирилл `О` (U+041E) ба латин `O` (U+004F)
 * эх кодод НҮДЭЭР ЯЛГАГДАХГҮЙ — литералаар бичвэл тест өөрөө худал болох
 * эрсдэлтэй.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanText,
  cleanLines,
  linesToText,
  normalizeScripts,
  detectDominantScript,
  joinHyphenatedLineBreaks,
  stripNoiseLines,
  collapseBlankLines,
} from '../src/ocr/postprocess.js';

// --- Кирилл тэмдэгтүүд ---
const CYR = {
  M: 'М', O: 'О', N: 'Н', G: 'Г', L: 'Л',
  H: 'Х', A: 'А', R: 'Р', S: 'С', T: 'Т',
  U: 'У', o: 'о', a: 'а', s: 'с', x: 'х',
};

test('кирилл үгэн дэх латин hомоглифыг кирилл рүү нэгтгэнэ', () => {
  // "МОНГОЛ" — латин M, H, O-гоор бохирдсон (Г, Л нь кирилл хэвээр)
  const input = 'MOHГOЛ';
  const expected = CYR.M + CYR.O + CYR.N + CYR.G + CYR.O + CYR.L;

  assert.notEqual(input, expected, 'оролт нь аль хэдийн зөв байж болохгүй');
  assert.equal(normalizeScripts(input), expected);
});

test('англи үгэн дэх кирилл hомоглифыг латин руу нэгтгэнэ', () => {
  // "Computer" — эхний C нь кирилл С (U+0421) болж таниулагдсан
  const input = 'Сomputer';
  assert.equal(normalizeScripts(input), 'Computer');
});

test('жинхэнэ холимог үгийг хөндөхгүй', () => {
  // iPhone-ийг: латин нотолгоо (i, h, n) БА кирилл нотолгоо (и, й, г) хоёулаа бий
  const input = 'iPhone-ийг';
  assert.equal(normalizeScripts(input), input);
});

test('грек/латин-extended тэмдэгтийг Ө, Ү рүү засна', () => {
  // "өргөн" — Ө-г грек theta-гаар таниулсан
  assert.equal(normalizeScripts('θргθн'), 'өргөн');
  // "Үнэ" — Ү-г грек upsilon-оор таниулсан
  assert.equal(normalizeScripts('Υнэ'), 'Үнэ');
  // barred o (U+0275) → ө
  assert.equal(normalizeScripts('ɵдөр'), 'өдөр');
});

test('бодит кирилл нотолгоотой үед л тоог үсэг рүү засна', () => {
  // "Захиал" — З-г 3 гэж таниулсан, а/х нь латин болсон
  const input = '3aхиaл';
  const expected = 'З' + CYR.a + CYR.x + 'и' + CYR.a + CYR.L.toLowerCase();
  assert.equal(normalizeScripts(input), expected);
});

test('тоо агуулсан товчлолыг эвдэхгүй', () => {
  const mongolianContext = 'Энэ бол монгол баримт бичиг. ';
  for (const token of ['MP3', 'A4', 'COVID-19', 'H2O']) {
    const out = normalizeScripts(mongolianContext + token);
    assert.ok(out.endsWith(token), `${token} өөрчлөгдөх ёсгүй, гарсан нь: ${out}`);
  }
});

test('бүхэлдээ хоёрдмол урт үгийг баримтын давамгай хэлээр шийднэ', () => {
  // "ХАРАХ" бүхэлдээ латинаар танигдсан (X A P A X — бүгд хоёрдмол)
  const ctx = 'Энэ бол монгол баримт бичиг. ';
  assert.equal(detectDominantScript(ctx + 'XAPAX'), 'cyr');

  const cyrillicHarah = CYR.H + CYR.A + CYR.R + CYR.A + CYR.H;
  assert.equal(normalizeScripts(ctx + 'XAPAX'), ctx + cyrillicHarah);

  // Унтраасан үед хөндөхгүй
  assert.equal(normalizeScripts(ctx + 'XAPAX', { useDominant: false }), ctx + 'XAPAX');
});

test('богино хоёрдмол товчлолыг давамгай хэлээр таамаглахгүй', () => {
  const ctx = 'Энэ бол монгол баримт бичиг. ';
  assert.ok(normalizeScripts(ctx + 'OK').endsWith('OK'));
  assert.ok(normalizeScripts(ctx + 'CT').endsWith('CT'));
});

test('дээж хэт бага бол давамгай хэл тодорхойлохгүй', () => {
  assert.equal(detectDominantScript('би '), null);
});

test('мөр төгсгөлийн зураасаар тасарсан үгийг нийлүүлнэ', () => {
  assert.equal(
    joinHyphenatedLineBreaks('үргэлжил-\nсэн'),
    'үргэлжилсэн',
  );
});

test('дараагийн мөр том үсгээр эхэлбэл зураасыг хадгална', () => {
  const listItem = 'Аймаг-\nУлаан';
  assert.equal(joinHyphenatedLineBreaks(listItem), listItem);
});

test('үсэг/тоогүй шум мөрийг хаяна, хоосон мөрийг хадгална', () => {
  const input = 'Нэг\n~-~\n\n|||\nХоёр';
  assert.equal(stripNoiseLines(input), 'Нэг\n\nХоёр');
});

test('олон дараалсан хоосон мөрийг шахна', () => {
  assert.equal(collapseBlankLines('a\n\n\n\n\nb'), 'a\n\nb');
});

test('cleanText нь бүх шатыг дараалуулж ажиллана', () => {
  const raw = [
    'MOHГOЛ  УЛС ,ба түүний байгуул-',
    'лага   ',
    '~~~',
    '',
    '',
    '',
    'Powered by Сomputer',
  ].join('\r\n');

  const out = cleanText(raw);

  assert.ok(out.includes(CYR.M + CYR.O + CYR.N + CYR.G + CYR.O + CYR.L), 'МОНГОЛ нэгтгэгдсэн байх');
  assert.ok(out.includes('байгууллага'), 'зураас нийлсэн байх');
  assert.ok(!out.includes('~~~'), 'шум мөр хасагдсан байх');
  assert.ok(!/\n{3,}/.test(out), '3+ хоосон мөр үлдээгүй байх');
  assert.ok(out.includes('Powered by Computer'), 'англи хэсэг латинаараа үлдсэн байх');
  assert.ok(!/ ,/.test(out), 'таслалын өмнөх зай авагдсан байх');
});

// --- cleanLines / linesToText ---
// UI нь мөр бүрийг тусад нь итгэлцүүртэй харуулдаг. Хэрэв мөрүүдийг нэг бүрчлэн
// цэвэрлэвэл мөр дамнасан зураас хэзээ ч нийлэхгүй тул ХАРАГДАХ болон ХУУЛАГДАХ
// текст зөрнө. Доорх тестүүд яг үүнээс хамгаална.

test('cleanLines нь мөр дамнасан зураасыг нийлүүлнэ', () => {
  const lines = cleanLines([
    { text: 'Энэ нь 1942 онд байгуул-', confidence: 90 },
    { text: 'лагдсан байна.', confidence: 60 },
  ]);

  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'Энэ нь 1942 онд байгууллагдсан байна.');
});

test('нийлсэн мөрийн итгэлцүүр нь хамгийн сул нь байна', () => {
  const lines = cleanLines([
    { text: 'үргэлжил-', confidence: 95 },
    { text: 'сэн', confidence: 41 },
  ]);
  assert.equal(lines[0].confidence, 41);
});

test('дараагийн мөр том үсгээр эхэлбэл мөрүүд нийлэхгүй', () => {
  const lines = cleanLines([
    { text: 'Аймаг-', confidence: 90 },
    { text: 'Улаанбаатар', confidence: 90 },
  ]);
  assert.equal(lines.length, 2);
});

test('хоосон мөрөөр тусгаарлагдсан ч зураасаар тасарсан үг нийлнэ', () => {
  // Өргөн мөр хоорондын зайтай зураг дээр Tesseract мөр бүрийг тусдаа догол
  // мөр гэж үзэж, хооронд нь хоосон мөр оруулдаг.
  const lines = cleanLines([
    { text: 'Энэ нь 1942 онд байгуул-', confidence: 90 },
    { text: '', confidence: null },
    { text: 'лагдсан байна.', confidence: 85 },
  ]);

  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'Энэ нь 1942 онд байгууллагдсан байна.');
});

test('cleanLines нь дараалсан хоосон мөрийг нэг болгож шахна', () => {
  const lines = cleanLines([
    { text: 'Эхлэл', confidence: 90 },
    { text: '', confidence: null },
    { text: '', confidence: null },
    { text: '', confidence: null },
    { text: 'Төгсгөл', confidence: 90 },
  ]);
  assert.deepEqual(
    lines.map((l) => l.text),
    ['Эхлэл', '', 'Төгсгөл'],
  );
});

test('эхэн ба төгсгөлийн хоосон мөрийг хаяна', () => {
  const lines = cleanLines([
    { text: '', confidence: null },
    { text: 'Ганц мөр', confidence: 90 },
    { text: '', confidence: null },
  ]);
  assert.deepEqual(
    lines.map((l) => l.text),
    ['Ганц мөр'],
  );
});

test('cleanLines нь шум мөрийг хаяж, хоосон мөрийг хадгална', () => {
  const lines = cleanLines([
    { text: 'Нэгдүгээр хэсэг', confidence: 90 },
    { text: '~~~~~', confidence: 12 },
    { text: '', confidence: null },
    { text: 'Хоёрдугаар хэсэг', confidence: 88 },
  ]);
  assert.deepEqual(
    lines.map((l) => l.text),
    ['Нэгдүгээр хэсэг', '', 'Хоёрдугаар хэсэг'],
  );
});

test('cleanLines нь гаднаас өгсөн давамгай хэлийг мөр бүрд хэрэглэнэ', () => {
  // Ганц мөрөөс давамгай хэлийг тодорхойлох боломжгүй — бүх баримтаас
  // тооцсон утгыг дамжуулж байж л энэ ажиллана.
  const [line] = cleanLines([{ text: 'XAPAX', confidence: 80 }], { dominant: 'cyr' });
  assert.equal(line.text, CYR.H + CYR.A + CYR.R + CYR.A + CYR.H);
});

test('linesToText нь харагдаж буй мөрүүдээс яг таарах текст угсарна', () => {
  const lines = cleanLines([
    { text: 'Эхний мөр', confidence: 90 },
    { text: '', confidence: null },
    { text: '', confidence: null },
    { text: '', confidence: null },
    { text: 'Сүүлийн мөр', confidence: 90 },
  ]);

  const text = linesToText(lines);
  assert.equal(text, 'Эхний мөр\n\nСүүлийн мөр');
  // Харагдац = хуулагдах текст: мөр бүр гаралтад байх ёстой.
  for (const line of lines) {
    if (line.text) assert.ok(text.includes(line.text));
  }
});

test('гаралтад кирилл үгэн дотор латин codepoint үлдээгүй', () => {
  const out = cleanText('MOHГOЛ УЛС');
  for (const ch of out) {
    assert.ok(!/[A-Za-z]/.test(ch), `латин тэмдэгт үлдсэн: U+${ch.codePointAt(0).toString(16)}`);
  }
});
