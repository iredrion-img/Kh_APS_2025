// routes/chat.js - chat router with BIM intent handling and token refresh guard
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { authRefreshMiddleware } = require('../services/aps');
const {
  DEFAULT_METADATA_PROPERTIES,
  WALL_KEYWORDS,
  SHOW_ONLY_KEYWORDS,
  ONLY_KEYWORDS,
  DIMENSION_KEYWORDS,
  TABLE_KEYWORDS,
  QUANTITY_KEYWORDS
} = require('../services/metadataKeywords');

const router = express.Router();
const MAX_UPLOAD_SIZE_MB = Number(process.env.CHAT_UPLOAD_LIMIT_MB || 20);
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: MAX_UPLOAD_SIZE_MB * 1024 * 1024 }
});
const fsp = fs.promises;

// All chat endpoints require a valid session/token (auto-refresh).
router.use(authRefreshMiddleware);

function detectWallOnlyViewCommand(message = '') {
  if (!message) return null;
  const normalized = message.toLowerCase();
  const hasWallKeyword = WALL_KEYWORDS.some((kw) => normalized.includes(kw));
  if (!hasWallKeyword) return null;

  // numeric height filter like "7m", "7000mm"
  const heightMatch = message.match(/(\d+(?:\.\d+)?)\s*(m|mm)/i);
  let heightFilter = null;
  if (heightMatch) {
    const val = parseFloat(heightMatch[1]);
    const unit = heightMatch[2].toLowerCase();
    if (!Number.isNaN(val)) {
      // normalize to millimeters to avoid confusion client side
      heightFilter = unit === 'm' ? val * 1000 : val;
    }
  }

  const wantsShow = SHOW_ONLY_KEYWORDS.some((kw) => normalized.includes(kw));
  if (!wantsShow) return null;

  const wantsOnly = ONLY_KEYWORDS.some((kw) => normalized.includes(kw));
  if (!wantsOnly && !message.includes('만')) {
    return null;
  }
  return {
    action: 'filter',
    category: 'Revit 벽',
    mode: 'isolate',
    filters: heightFilter ? [{ field: 'Height', op: '>', value_mm: heightFilter }] : undefined
  };
}

function detectWallThicknessVolumeIntent(message = '') {
  const normalized = message.toLowerCase();
  const hasWall = ['벽', 'wall'].some((k) => normalized.includes(k));
  const hasThickness = ['두께', '폭', 'width', 'thickness'].some((k) => normalized.includes(k));
  const hasVolume = ['체적', '부피', 'volume'].some((k) => normalized.includes(k));
  const hasTable = TABLE_KEYWORDS.some((k) => normalized.includes(k));

  if (hasWall && hasThickness && hasVolume && hasTable) {
    return {
      action: 'calculate_wall_stats',
      category: 'Revit 벽'
    };
  }
  return null;
}

// Pick metadata fields relevant to the question
function getRelevantProperties(message = '') {
  const normalized = message.toLowerCase();
  const props = new Set(['Category', '카테고리', 'Name', '이름']); // minimal required fields

  if (normalized.includes('type') || normalized.includes('타입') || normalized.includes('형')) {
    props.add('Type'); props.add('Type Name'); props.add('타입 이름');
  }
  if (normalized.includes('family') || normalized.includes('패밀리')) {
    props.add('Family'); props.add('Family Name'); props.add('패밀리');
  }
  if (normalized.includes('level') || normalized.includes('레벨') || normalized.includes('층')) {
    props.add('Level'); props.add('레벨'); props.add('층');
  }

  const wantsDimensions = DIMENSION_KEYWORDS.some((k) => normalized.includes(k));
  if (wantsDimensions) {
    if (normalized.includes('height') || normalized.includes('높이')) {
      props.add('Height'); props.add('Unconnected Height'); props.add('미연결 높이');
    }
    if (normalized.includes('width') || normalized.includes('폭') || normalized.includes('두께') || normalized.includes('thickness')) {
      props.add('Width'); props.add('Thickness'); props.add('두께'); props.add('폭'); props.add('너비');
    }
    if (normalized.includes('area') || normalized.includes('면적')) {
      props.add('Area'); props.add('면적');
    }
    if (normalized.includes('volume') || normalized.includes('체적') || normalized.includes('부피')) {
      props.add('Volume'); props.add('체적'); props.add('부피');
    }
  }

  if (props.size <= 4 && (normalized.includes('속성') || normalized.includes('정보') || normalized.includes('데이터'))) {
    return DEFAULT_METADATA_PROPERTIES;
  }

  return Array.from(props);
}

function detectBimMetadataIntent(message = '') {
  if (!message) return null;
  const normalized = message.toLowerCase();
  const wantsWall = normalized.includes('벽') || normalized.includes('wall');
  const wantsTable = TABLE_KEYWORDS.some((k) => normalized.includes(k));
  const wantsQuant = QUANTITY_KEYWORDS.some((k) => normalized.includes(k));

  const wantsThicknessGroup = normalized.includes('두께별') || normalized.includes('thickness');
  const wantsChart = normalized.includes('차트') || normalized.includes('chart');

  if (wantsWall && (wantsTable || wantsQuant)) {
    const relevantProps = getRelevantProperties(message);
    const finalProps = relevantProps.length > 4 ? relevantProps : DEFAULT_METADATA_PROPERTIES;

    const baseIntent = {
      category: 'Revit 벽',
      properties: finalProps,
      mode: normalized.includes('숨기') || normalized.includes('hide') ? 'hide' : 'isolate'
    };

    if (wantsThicknessGroup) {
      return {
        ...baseIntent,
        action: 'calculate_wall_stats',
        group_by: 'Thickness',
        view: wantsChart ? 'chart' : 'table'
      };
    }

    return baseIntent;
  }
  return null;
}

// Health check
router.get('/health', (_req, res) => {
  res.json({ ok: true, endpoint: 'POST /api/chat' });
});

// Main chat endpoint
router.post('/', upload.single('file'), async (req, res) => {
  try {
    const message = (req.body?.message || '').toString().trim();
    const wallViewAction = detectWallOnlyViewCommand(message);
    if (wallViewAction) {
      return res.json({
        reply: '요청하신 벽체만 추출하여 화면에 표시했습니다.',
        action: wallViewAction,
        sources: [],
        thread_id: req.body.thread_id || `thread_${Date.now()}`
      });
    }

    const wallStatsAction = detectWallThicknessVolumeIntent(message);
    if (wallStatsAction) {
      return res.json({
        reply: '벽체 두께와 체적을 계산해 표로 정리합니다.',
        action: wallStatsAction,
        sources: [],
        thread_id: req.body.thread_id || `thread_${Date.now()}`
      });
    }

    const intent = detectBimMetadataIntent(message);

    if (req.file?.path) {
      try { await fsp.unlink(req.file.path); } catch (_e) {}
    }

    if (intent) {
      return res.json({
        reply: '모델 정보를 확인하고 있습니다...',
        action: {
          action: intent.action || 'request_metadata',
          properties: intent.properties,
          category: intent.category,
          mode: intent.mode,
          group_by: intent.group_by
        },
        sources: [],
        thread_id: req.body.thread_id || `thread_${Date.now()}`
      });
    }

    return res.json({
      reply: message || '무엇을 도와드릴까요?',
      action: null,
      sources: [],
      thread_id: req.body.thread_id || `thread_${Date.now()}`
    });
  } catch (err) {
    console.error('[/api/chat] error:', err);
    res.status(500).json({ error: 'Internal server error', detail: String(err.message || err) });
  }
});

// Simple upload helper (temporary storage)
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ ok: true, filename: req.file.originalname });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed', detail: String(err.message || err) });
  } finally {
    if (req.file?.path) {
      try { await fsp.unlink(req.file.path); } catch (_e) {}
    }
  }
});

module.exports = router;
