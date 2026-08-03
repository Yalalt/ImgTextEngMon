/**
 * Локал хөгжүүлэлтийн API сервер — шинэ dependency шаардахгүй (`node:http`).
 *
 * `api/ocr.js` нь Vercel-ийн serverless function-ы гарын үсэгтэй (`(req, res)`).
 * Энэ сервер нь яг тэр handler-ыг локалд ил гаргаж, ижил код хоёр орчинд
 * ажиллах боломж олгоно.
 *
 * CRA-гийн dev server нь `package.json` доторх `"proxy"` талбарын дагуу
 * `/api/*` хүсэлтийг энд дамжуулна.
 *
 *   npm run api      # энэ сервер (:5174)
 *   npm start        # CRA (:3000)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import handler from './ocr.js';

const PORT = Number(process.env.API_PORT) || 5174;

/** `.env` файлыг гараар уншина — dotenv dependency нэмэхээс зайлсхийв. */
function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

  if (pathname === '/api/health') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true, hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY) }));
    return;
  }

  if (pathname !== '/api/ocr') {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  try {
    await handler(req, res);
  } catch (error) {
    console.error('[api] боловсруулаагүй алдаа:', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Дотоод серверийн алдаа.' }));
    }
  }
});

server.listen(PORT, () => {
  const keyState = process.env.ANTHROPIC_API_KEY
    ? 'ANTHROPIC_API_KEY уншигдсан'
    : 'АНХААР: ANTHROPIC_API_KEY олдсонгүй — AI горим ажиллахгүй';
  console.log(`[api] http://localhost:${PORT}/api/ocr дээр сонсож байна (${keyState})`);
});
