const crypto = require('crypto');

const tokenStore = new Map();
const TOKEN_RETENTION_MS = 1000 * 60 * 60 * 24; // Retain entries for ~24h past expiry

function cleanup() {
  const now = Date.now();
  for (const [key, value] of tokenStore.entries()) {
    if (!value) {
      tokenStore.delete(key);
      continue;
    }
    if (value.expiresAt && value.expiresAt + TOKEN_RETENTION_MS < now) {
      tokenStore.delete(key);
    }
  }
}

function ensureSessionId(req) {
  if (!req.session) {
    throw new Error('Session middleware not initialized');
  }
  if (!req.session.sessionId) {
    req.session.sessionId = crypto.randomUUID();
  }
  return req.session.sessionId;
}

function getSessionId(req) {
  return req.session?.sessionId || null;
}

function setTokens(sessionId, tokens) {
  if (!sessionId) return;
  cleanup();
  tokenStore.set(sessionId, { ...tokens, storedAt: Date.now() });
}

function getTokens(sessionId) {
  cleanup();
  if (!sessionId) return null;
  return tokenStore.get(sessionId) || null;
}

function clearTokens(sessionId) {
  if (!sessionId) return;
  tokenStore.delete(sessionId);
}

module.exports = {
  ensureSessionId,
  getSessionId,
  setTokens,
  getTokens,
  clearTokens
};
