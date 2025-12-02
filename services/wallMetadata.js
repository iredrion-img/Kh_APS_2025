const WALL_CATEGORY = 'Revit 벽체';
const WALL_PROPERTIES = [
  'ElementId', 'Category', 'Type', 'Type Name', '유형 이름', 'Level', '레벨',
  '폭', 'Width', '너비', '폭(mm)', '두께', 'Thickness', 'Overall Width', '벽체폭', '구조두께',
  'Height', 'Unconnected Height', '미연결높이', '미연결높이(mm)',
  '면적', 'Area', 'Surface Area',
  '체적', '부피', 'Volume', 'Volume (m3)', 'Volume (m³)'
];

const THICKNESS_KEYS = ['폭', 'Width', '두께', '벽 두께', '구조 두께', 'Wall Width', 'Thickness'];

const toNumber = (v) => {
  if (v === undefined || v === null) return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

const splitKV = (chunk = '') => {
  const [k, ...rest] = chunk.split(':');
  if (!k || !rest.length) return null;
  return [k.trim(), rest.join(':').trim()];
};

function pick(meta, keys = []) {
  for (const k of keys) {
    if (meta[k] !== undefined) return meta[k];
  }
  const lower = Object.keys(meta).map((k) => [k, k.toLowerCase()]);
  for (const k of keys) {
    const lk = k.toLowerCase();
    const hit = lower.find(([orig, low]) => low === lk || low.includes(lk));
    if (hit) return meta[hit[0]];
  }
  return undefined;
}

function extractThickness(meta = {}, name) {
  for (const key of THICKNESS_KEYS) {
    const n = toNumber(meta[key]);
    if (n !== null) {
      return Math.round(n);
    }
  }
  const typeName = meta['유형 이름'] ?? meta['Type Name'];
  const textCandidates = [name, typeName].filter(Boolean);
  const regexes = [/T(\d{2,4})/, /WALL[_-](\d{2,4})/i, /(\d{2,4})mm/i];
  for (const text of textCandidates) {
    for (const re of regexes) {
      const match = String(text).match(re);
      if (match?.[1]) {
        const n = Number(match[1]);
        if (Number.isFinite(n)) return Math.round(n);
      }
    }
  }
  return null;
}

function parseWallRow(row) {
  let id, name, category, rawMeta;
  if (typeof row === 'string') {
    const parts = row.match(/(?:"([^"]*)"|[^,])+/g)?.map((p) => p.replace(/^"|"$/g, '').trim()) || [];
    [id, name, category, rawMeta] = parts;
  } else {
    id = row?.id ?? row?.[0];
    name = row?.name ?? row?.[1];
    category = row?.category ?? row?.[2];
    rawMeta = row?.meta ?? row?.[3];
  }
  if (!rawMeta) return null;

  const meta = {};
  for (const chunk of rawMeta.split('|')) {
    const kv = splitKV(chunk);
    if (kv) meta[kv[0]] = kv[1];
  }
  if (!category && meta.Category) category = meta.Category;
  const nameMatchesWall = (name || '').includes('벽');
  const categoryMatchesWall = category ? category.includes('벽') : false;
  if (!categoryMatchesWall && !nameMatchesWall) return null;

  const volumeRaw = pick(meta, ['체적', '부피', 'Volume', 'Volume (m3)', 'Volume (m³)']);
  const areaRaw = pick(meta, ['면적', 'Area', 'Surface Area']);
  const widthRaw = pick(meta, ['폭', 'Width', '너비', '폭(mm)']);
  const heightRaw = pick(meta, ['Height', 'Unconnected Height', '미연결높이', '미연결높이(mm)']);
  const typeName = meta['유형 이름'] || meta['Type Name'] || meta['유형 설명'];
  const thickness = extractThickness(meta, name || typeName);

  return {
    id: toNumber(id),
    name,
    category: category || WALL_CATEGORY,
    typeName,
    level: meta.Level || meta['레벨'],
    width: toNumber(widthRaw),
    thickness,
    height: toNumber(heightRaw),
    area: toNumber(areaRaw),
    volume: toNumber(volumeRaw),
    meta
  };
}

function collectWalls(rows = []) {
  const out = [];
  for (const r of rows) {
    const p = parseWallRow(r);
    if (p) out.push(p);
  }
  return out;
}

function summarizeByThickness(walls = []) {
  const m = new Map();

  for (const w of walls) {
    const raw = w.thickness;
    if (raw === undefined || raw === null) continue;

    const key = Math.round(Number(raw));
    if (!Number.isFinite(key)) continue;

    if (!m.has(key)) {
      m.set(key, { thickness: key, count: 0, totalArea: 0, totalVolume: 0 });
    }

    const agg = m.get(key);
    agg.count += 1;
    agg.totalArea += w.area || 0;
    agg.totalVolume += w.volume || 0;
  }

  const arr = Array.from(m.values());
  arr.sort((a, b) => a.thickness - b.thickness);

  return arr.map((agg) => ({
    thickness: agg.thickness,
    count: agg.count,
    area: Number(agg.totalArea.toFixed(3)),
    volume: Number(agg.totalVolume.toFixed(3))
  }));
}

module.exports = {
  WALL_CATEGORY,
  WALL_PROPERTIES,
  collectWalls,
  summarizeByThickness
};
