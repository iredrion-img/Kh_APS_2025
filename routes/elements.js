const express = require('express');
const { authRefreshMiddleware } = require('../services/aps');
const { COMMON_PROPERTIES, collectElements, summarizeByCategory } = require('../services/elementMetadata');

const router = express.Router();

router.use('/api/elements', authRefreshMiddleware);

// 최소 필드 목록
router.get('/api/elements/fields', (_req, res) => {
  res.json({ properties: COMMON_PROPERTIES });
});

// rows 받아서 전체 요소 테이블 + 카테고리별 집계
router.post('/api/elements/summary', (req, res) => {
  const rows = req.body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows[] is required' });
  }
  if (rows.length > 5000) {
    return res.status(413).json({ error: 'Too many rows' });
  }

  const elements = collectElements(rows);
  const grouped = summarizeByCategory(elements);
  res.json({
    columns: ['ID', 'Category', 'Level', 'Width', 'Thickness', 'Height', 'Volume'],
    rows: elements.map((e) => [
      e.id,
      e.category || '',
      e.level || '',
      e.width ?? '',
      e.thickness ?? e.width ?? '',
      e.height ?? '',
      e.volume ?? ''
    ]),
    grouped,
    action: {
      action: 'render_table',
      title: '요소 목록',
      description: '추출된 모든 요소',
      columns: ['ID', 'Category', 'Level', 'Width', 'Thickness', 'Height', 'Volume'],
      rows: elements.map((e) => [
        e.id,
        e.category || '',
        e.level || '',
        e.width ?? '',
        e.thickness ?? e.width ?? '',
        e.height ?? '',
        e.volume ?? ''
      ])
    },
    grouped_action: {
      action: 'render_table',
      title: '카테고리별 집계',
      description: '카테고리별 개수/면적/체적 합계',
      columns: ['Category', 'Count', 'Area', 'Volume'],
      rows: grouped.map((g) => [
        g.category,
        g.count,
        g.area,
        g.volume
      ])
    }
  });
});

module.exports = router;
