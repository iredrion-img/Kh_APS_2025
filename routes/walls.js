const express = require('express');
const { authRefreshMiddleware } = require('../services/aps');
const { WALL_PROPERTIES, collectWalls, summarizeByThickness } = require('../services/wallMetadata');

const router = express.Router();

// Protect all wall APIs with token refresh
router.use('/api/walls', authRefreshMiddleware);

// Minimal field list to request from client
router.get('/api/walls/fields', (_req, res) => {
  res.json({ properties: WALL_PROPERTIES });
});

function buildWallSummary(rows = []) {
  const walls = collectWalls(rows);
  const grouped = summarizeByThickness(walls);
  const groupedSummary = grouped.map((g) => ({
    thickness_mm: g.thickness,
    count: g.count,
    volume_sum_m3: g.volume
  }));
  return { walls, grouped, groupedSummary };
}

// GET summary: rows supplied via query (?rows=[...]) or (non-standard) GET body
router.get('/api/walls/summary', (req, res) => {
  let rows = req.query?.rows;
  if (typeof rows === 'string') {
    try {
      rows = JSON.parse(rows);
    } catch (e) {
      return res.status(400).json({ error: 'rows query must be JSON array' });
    }
  }
  if (!rows && Array.isArray(req.body?.rows)) {
    rows = req.body.rows; // allow GET with body for compatibility
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows[] is required (pass as query ?rows=[...])' });
  }
  if (rows.length > 5000) {
    return res.status(413).json({ error: 'Too many rows' });
  }

  const { groupedSummary } = buildWallSummary(rows);
  return res.json(groupedSummary.sort((a, b) => a.thickness_mm - b.thickness_mm));
});

// Summarize walls: raw rows + thickness grouping + chart action
router.post('/api/walls/summary', (req, res) => {
  const rows = req.body?.rows;
  console.log('[summary] called');
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows[] is required' });
  }
  if (rows.length > 5000) {
    return res.status(413).json({ error: 'Too many rows' });
  }

  const walls = collectWalls(rows);
  const grouped = summarizeByThickness(walls);
  console.log('[walls summary] grouped thickness =', grouped.map((g) => g.thickness));
  console.log('[summary] result =', grouped);

  // Server-side finalized aggregation for AI/table rendering
  const groupedSummary = grouped.map((g) => ({
    thickness_mm: g.thickness,
    count: g.count,
    volume_sum_m3: Number((g.volume || 0).toFixed(3))
  }));

  res.json({
    columns: ['ID', 'Level', 'Width', 'Thickness', 'Height', 'Volume'],
    rows: walls.map((w) => [
      w.id,
      w.level ?? '',
      w.width ?? '',
      w.thickness ?? w.width ?? '',
      w.height ?? '',
      w.volume ?? ''
    ]),
    grouped,
    grouped_summary: groupedSummary,
    action: {
      action: 'render_table',
      title: '벽체 목록',
      description: '추출된 모든 벽체',
      columns: ['ID', 'Level', 'Width', 'Thickness', 'Height', 'Volume'],
      rows: walls.map((w) => [
        w.id,
        w.level ?? '',
        w.width ?? '',
        w.thickness ?? w.width ?? '',
        w.height ?? '',
        w.volume ?? ''
      ])
    },
    grouped_action: {
      action: 'render_table',
      title: '두께별집계',
      description: '두께별 서버 집계 (AI는 이 JSON만 사용)',
      columns: ['Thickness (mm)', 'Count', 'Volume (m3)'],
      rows: groupedSummary.map((g) => [
        g.thickness_mm ?? '미상',
        g.count,
        g.volume_sum_m3
      ])
    },
    grouped_chart: {
      action: 'render_chart',
      type: 'bar',
      title: '두께별체적',
      labels: groupedSummary.map((g) => String(g.thickness_mm ?? '미상')),
      datasets: [
        { label: 'Volume', data: groupedSummary.map((g) => g.volume_sum_m3) },
        { label: 'Count', data: groupedSummary.map((g) => g.count) }
      ]
    }
  });
});

module.exports = router;
