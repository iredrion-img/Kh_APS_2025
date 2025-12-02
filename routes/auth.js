// routes/auth.js
// Hubs Browser 공식 튜토리얼 패턴 기반 인증 라우터

const express = require('express');
const crypto = require('crypto');
const {
  getAuthorizationUrl,
  authCallbackMiddleware,
  authRefreshMiddleware,
  getUserProfile
} = require('../services/aps.js');
const tokenStore = require('../services/tokenStore');

let router = express.Router();

// 1) 로그인 시작: Autodesk 로그인 페이지로 리다이렉트
router.get('/api/auth/login', function (req, res) {
  tokenStore.ensureSessionId(req);
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauth_state = state;
  res.redirect(getAuthorizationUrl(state));
});

// 2) 로그아웃: 세션 쿠키 제거 후 메인 페이지로
router.get('/api/auth/logout', function (req, res) {
  const sessionId = tokenStore.getSessionId(req);
  if (sessionId) {
    tokenStore.clearTokens(sessionId);
  }
  req.session = null;
  res.redirect('/');
});

// 3) OAuth 콜백: 토큰 생성 후 메인 페이지로
router.get('/api/auth/callback', authCallbackMiddleware, function (req, res) {
  res.redirect('/');
});

// 4) 뷰어/클라이언트가 사용하는 public token
//    => authRefreshMiddleware 가 req.publicOAuthToken 을 세팅
router.get('/api/auth/token', authRefreshMiddleware, function (req, res) {
  res.json(req.publicOAuthToken);
});

// 5) 로그인한 사용자 프로필 정보
router.get('/api/auth/profile', authRefreshMiddleware, async function (req, res, next) {
  try {
    const profile = await getUserProfile(req.internalOAuthToken.access_token);
    res.json({ name: `${profile.name}` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
