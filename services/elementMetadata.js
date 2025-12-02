const COMMON_PROPERTIES = [
  'ElementId', 'Category', 'Family', 'Family Name', 'Type', 'Type Name', '유형 이름', 'Level', '레벨',
  '폭', 'Width', '벽 폭', '두께', 'Thickness', 'Overall Width', '타입 폭', '타입 두께',
  'Height', 'Unconnected Height', '미연결 높이', '미연결 높이(mm)',
  '면적', 'Area', 'Surface Area',
  '체적', '부피', 'Volume', 'Volume (m3)', 'Volume (m³)'
];

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

// Generic element parser: no category filtering
function parseElementRow(row) {
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

  const volumeRaw = pick(meta, ['체적', '부피', 'Volume', 'Volume (m3)', 'Volume (m³)']);
  const areaRaw = pick(meta, ['면적', 'Area', 'Surface Area']);
  const widthRaw = pick(meta, ['폭', 'Width', '벽 폭']);
  const thicknessRaw = pick(meta, ['두께', 'Thickness', 'Overall Width', '타입 폭', '타입 두께']);
  const heightRaw = pick(meta, ['Height', 'Unconnected Height', '미연결 높이', '미연결 높이(mm)']);

  return {
    id: toNumber(id),
    name,
    category: category || meta.Category || '',
    typeName: meta['유형 이름'] || meta['Type Name'] || meta['유형 해설'],
    level: meta.Level || meta['레벨'],
    width: toNumber(widthRaw),
    thickness: toNumber(thicknessRaw) ?? toNumber(widthRaw),
    height: toNumber(heightRaw),
    area: toNumber(areaRaw),
    volume: toNumber(volumeRaw),
    meta
  };
}

function collectElements(rows = []) {
  const out = [];
  for (const r of rows) {
    const p = parseElementRow(r);
    if (p) out.push(p);
  }
  return out;
}

function summarizeByCategory(elements = []) {
  const m = new Map();
  for (const e of elements) {
    const key = e.category || '미상';
    if (!m.has(key)) m.set(key, { category: key, count: 0, totalVolume: 0, totalArea: 0 });
    const agg = m.get(key);
    agg.count += 1;
    agg.totalVolume += e.volume || 0;
    agg.totalArea += e.area || 0;
  }
  return Array.from(m.values()).map((agg) => ({
    category: agg.category,
    count: agg.count,
    area: Number(agg.totalArea.toFixed(3)),
    volume: Number(agg.totalVolume.toFixed(3))
  }));
}

module.exports = {
  COMMON_PROPERTIES,
  collectElements,
  summarizeByCategory
};
