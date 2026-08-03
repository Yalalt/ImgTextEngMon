/**
 * Claude vision OCR proxy.
 *
 * ЯАГААД PROXY ВЭ: Anthropic API key нь браузерын багцад ХЭЗЭЭ Ч орох ёсгүй.
 * Клиент нь зургаа энэ endpoint руу илгээж, key зөвхөн серверийн орчинд үлдэнэ.
 *
 * Хоёр орчинд ижилхэн ажиллана:
 *  - Vercel: `api/*.js` файл автоматаар serverless function болно.
 *  - Локал:  `api/server.js` (`npm run api`) энэ handler-ыг :5174 дээр гаргана.
 */
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5';
const MAX_TOKENS = 16000;
/** Клиент нь урт талыг 2576px, JPEG q0.85 болгож илгээдэг — ихэвчлэн <1.5MB. */
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const SYSTEM_PROMPT = `You transcribe text from images. The images contain Mongolian Cyrillic, English, or a mix of both — often in the same paragraph, the same line, or even the same word.

Rules:
1. Transcribe verbatim. Never translate, summarise, correct spelling, or invent text that is not visible in the image.
2. The Mongolian Cyrillic alphabet is: А Б В Г Д Е Ё Ж З И Й К Л М Н О Ө П Р С Т У Ү Ф Х Ц Ч Ш Щ Ъ Ы Ь Э Ю Я. Ө/ө (U+04E8/U+04E9) and Ү/ү (U+04AE/U+04AF) are real Mongolian letters — use those exact Cyrillic codepoints. Never substitute Latin O/Y, Greek θ/Υ, or the digit 0 for them.
3. Never mix scripts inside a single word. A Cyrillic word must use only Cyrillic codepoints — never the Latin lookalikes A B E K M H O P C T Y X a e o p c y x. An English word must use only Latin codepoints. A genuinely mixed token (for example "iPhone-ийг" or "Excel-д") keeps each part in its own script.
4. Preserve the layout: line breaks, paragraph breaks, and the reading order of columns. Separate paragraphs with a blank line.
5. If a line is blurred, cropped, or you are guessing at it, still give your best reading and set "uncertain": true for that line.
6. Do not include any internal or system XML tags in your output.

Put the full transcription (with newlines) in "text", the same content split per line in "lines", and any caveat about image quality in "notes" (empty string when there is nothing to report).`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    text: {
      type: 'string',
      description: 'Full verbatim transcription, newlines preserved.',
    },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          script: { type: 'string', enum: ['mn', 'en', 'mixed', 'other'] },
          uncertain: { type: 'boolean' },
        },
        required: ['text', 'script', 'uncertain'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string' },
  },
  required: ['text', 'lines', 'notes'],
  additionalProperties: false,
};

let cachedClient = null;
function getClient() {
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

/**
 * Body-г уншина. Vercel нь JSON-ыг урьдчилан задалж `req.body`-д тавьдаг;
 * локал node:http сервер дээр урсгалаас өөрсдөө уншина.
 */
async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('PAYLOAD_TOO_LARGE');
      error.code = 'PAYLOAD_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function firstTextBlock(message) {
  const block = (message.content || []).find((b) => b.type === 'text');
  return block ? block.text : '';
}

/**
 * Хүсэлтийг илгээнэ. Claude Opus 5 дээр серверийн талын `fallbacks` нь
 * зөвлөмжтэй боловч beta тул тухайн орчинд боломжгүй байвал энгийн endpoint
 * руу нэг удаа буцаж оролдоно.
 */
async function createMessage(client, params) {
  try {
    return await client.beta.messages.create({
      ...params,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  } catch (error) {
    const message = String(error?.message || '');
    const isBetaRejection =
      error?.status === 400 && /fallback|beta/i.test(message);
    if (!isBetaRejection) throw error;
    console.warn('[ocr] server-side fallbacks боломжгүй, энгийн endpoint руу шилжлээ:', message);
    return client.messages.create(params);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'POST хүсэлт л хүлээн авна.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return send(res, 503, {
      error: 'ANTHROPIC_API_KEY тохируулагдаагүй байна.',
      hint: '.env файлд ANTHROPIC_API_KEY-г нэмээд серверийг дахин ажиллуулна уу.',
      code: 'NO_API_KEY',
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error.code === 'PAYLOAD_TOO_LARGE') {
      return send(res, 413, { error: 'Зураг хэт том байна. Багасгаад дахин оролдоно уу.' });
    }
    return send(res, 400, { error: 'Хүсэлтийн бие буруу байна (JSON биш).' });
  }

  const { imageBase64, mediaType = 'image/jpeg', effort = 'low' } = body;

  if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
    return send(res, 400, { error: '`imageBase64` талбар шаардлагатай.' });
  }
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return send(res, 400, { error: `Дэмжигдэхгүй зургийн төрөл: ${mediaType}` });
  }

  const startedAt = Date.now();

  try {
    const message = await createMessage(getClient(), {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      // Adaptive thinking + бага effort: транскрипц бол гүн бодох ажил биш ч
      // thinking-ийг бүрэн унтраахад Opus 5 нь заримдаа дотоод XML tag-аа
      // гаргадаг. Бага effort нь зардал/хоцролтыг барих зөв хөшүүрэг.
      thinking: { type: 'adaptive' },
      output_config: {
        effort,
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            },
            {
              type: 'text',
              text: 'Transcribe every piece of text in this image following the rules above.',
            },
          ],
        },
      ],
    });

    // Аюулгүй байдлын ангилагч татгалзсан тохиолдолд `content` хоосон эсвэл
    // дутуу байдаг — `content`-ыг унших ӨМНӨ `stop_reason`-ыг шалгана.
    if (message.stop_reason === 'refusal') {
      return send(res, 422, {
        error: 'Загвар энэ зургийг боловсруулахаас татгалзлаа.',
        code: 'REFUSAL',
        category: message.stop_details?.category ?? null,
      });
    }

    const rawJson = firstTextBlock(message);
    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      return send(res, 502, {
        error: 'Загварын хариу JSON биш байна.',
        code: 'BAD_MODEL_OUTPUT',
      });
    }

    return send(res, 200, {
      text: parsed.text ?? '',
      lines: Array.isArray(parsed.lines) ? parsed.lines : [],
      notes: parsed.notes ?? '',
      model: message.model,
      usage: message.usage,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const status = error?.status;
    if (status === 401) {
      return send(res, 502, { error: 'ANTHROPIC_API_KEY буруу байна.', code: 'BAD_API_KEY' });
    }
    if (status === 429) {
      return send(res, 429, { error: 'Хэт олон хүсэлт. Түр хүлээгээд дахин оролдоно уу.' });
    }
    console.error('[ocr] алдаа:', error);
    return send(res, 502, {
      error: error?.message || 'Claude руу хандахад алдаа гарлаа.',
    });
  }
}
