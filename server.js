// server.js (CommonJS)
require('dotenv').config();

const express = require('express');
const session = require('cookie-session');
const path = require('path');
const cors = require('cors');
const { PORT, SERVER_SESSION_SECRET } = require('./config.js');
const { authRefreshMiddleware } = require('./services/aps');
const authRouter = require('./routes/auth.js');
const hubsRouter = require('./routes/hubs.js');
const chatRouter = require('./routes/chat.js');
const wallsRouter = require('./routes/walls.js');
const elementsRouter = require('./routes/elements.js');

const SERVER_ORIGIN = process.env.SERVER_ORIGIN || `http://localhost:${PORT}`;
const RAW_CLIENT_ORIGINS = (process.env.CLIENT_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const DEFAULT_DEV_ORIGINS = (process.env.DEV_CLIENT_ORIGINS || `${SERVER_ORIGIN},http://localhost:5173,http://localhost:5174,http://localhost:3000`)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const CLIENT_ORIGINS = RAW_CLIENT_ORIGINS.length ? RAW_CLIENT_ORIGINS : DEFAULT_DEV_ORIGINS;
if (!RAW_CLIENT_ORIGINS.length) {
  console.warn(`CLIENT_ORIGINS not set. Using default dev origins: ${DEFAULT_DEV_ORIGINS.join(', ')}`);
}
const CLIENT_ORIGIN_SET = new Set([SERVER_ORIGIN, ...CLIENT_ORIGINS]);
const CORS_ALLOW_ALL = process.env.CORS_ALLOW_ALL === 'true';
if (CORS_ALLOW_ALL) {
  console.warn('CORS_ALLOW_ALL=true. All origins will be allowed. Use only for local testing.');
}

const corsOptions = {
  origin: (origin, callback) => {
    if (CORS_ALLOW_ALL || !origin) {
      return callback(null, true);
    }
    if (CLIENT_ORIGIN_SET.has(origin)) {
      return callback(null, true);
    }
    console.warn(`Blocked CORS request from origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
};

const app = express();

// 프록시 뒤에서 secure 쿠키/실제 IP 처리
app.set('trust proxy', 1);

// 요청 로깅(501/경로 문제를 한눈에 확인)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(cors(corsOptions));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 정적 파일(wwwroot)
app.use(express.static(path.join(__dirname, 'wwwroot')));

// 세션
app.use(session({
  name: 'kunhwa.sid',
  secret: SERVER_SESSION_SECRET,     // 또는 keys: [SERVER_SESSION_SECRET]
  maxAge: 24 * 60 * 60 * 1000,       // 1 day
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true
}));

// 루트 헬스체크(브라우저에서 즉시 확인)
app.get('/health', (_req, res) => {
  res.json({ ok: true, msg: 'Kunhwa APS server up', endpoint: 'POST /api/chat' });
});

// 기존 APS 라우트
app.use(authRouter);
app.use(hubsRouter);
app.use(wallsRouter);
app.use(elementsRouter);

// OpenAI Assistants 라우트 (★ listen 전에 등록)
app.use('/api/chat', authRefreshMiddleware, chatRouter);

// 알 수 없는 API 경로 처리(501 대신 명확한 404/405)
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Unknown API route.' });
  }
  next();
});

// SPA fallback for client-side routing
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'wwwroot', 'index.html'));
});

// 공통 에러 핸들러(스택 숨기고 JSON으로 응답)
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  console.error('Global error:', err);
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : (err.message || 'Request failed')
  });
});

// 서버 기동
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});
