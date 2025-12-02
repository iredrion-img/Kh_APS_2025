// wwwroot/viewer.js

import './extensions/LoggerExtension.js';
import './extensions/SummaryExtension.js';
import './extensions/HistogramExtension.js';
import './extensions/DataGridExtension.js';

// ------------------------------------------------------
// 1. 토큰 헬퍼 (/api/auth/token 사용)
// ------------------------------------------------------
async function getRawAccessToken() {
  const resp = await fetch('/api/auth/token');
  if (!resp.ok) {
    throw new Error(await resp.text());
  }
  const { access_token, expires_in } = await resp.json();
  return { access_token, expires_in };
}

async function getAccessTokenForViewer(callback) {
  try {
    const { access_token, expires_in } = await getRawAccessToken();
    callback(access_token, expires_in);
  } catch (err) {
    alert('Could not obtain access token. See the console for more details.');
    console.error(err);
  }
}

let globalViewer = null;
window.__APS_MODEL_LOADING = window.__APS_MODEL_LOADING || false;

let propsDbReadyResolve;
let propsDbReadyPromise = createPropsDbReadyPromise();

function createPropsDbReadyPromise() {
  return new Promise((resolve) => {
    propsDbReadyResolve = resolve;
  });
}

function resetPropsDbReadyPromise() {
  propsDbReadyPromise = createPropsDbReadyPromise();
}

// URN 은 Viewer 에서는 raw, Model Derivative 에서는 URL 인코딩 필요
function getUrlEncodedUrn(urn) {
  if (typeof urn !== 'string' || urn.length === 0) {
    throw new Error('URN is required to call Model Derivative endpoints.');
  }
  return encodeURIComponent(urn.trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchModelDerivativeJson(url, fetchOptions = {}, retryOptions = {}) {
  const {
    retries = 5,
    initialDelay = 400,
    backoffFactor = 1.6,
    label = 'ModelDerivative'
  } = retryOptions;

  let attempt = 0;
  let delay = initialDelay;

  while (true) {
    const resp = await fetch(url, fetchOptions);

    if (resp.status === 202) {
      if (attempt >= retries) {
        throw new Error(`${label}: Request still processing after ${retries + 1} attempts (202).`);
      }
      await sleep(delay);
      attempt += 1;
      delay *= backoffFactor;
      continue;
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(body || `${label}: HTTP ${resp.status}`);
    }

    return resp.json();
  }
}

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function markPropsDbReady(db) {
  window.__APS_PROPS_DB = db;
  window.__APS_MODEL_LOADING = false;
  if (propsDbReadyResolve) {
    propsDbReadyResolve(db);
    propsDbReadyResolve = null;
  }

  try {
    const detail = { count: Object.keys(db || {}).length };
    window.dispatchEvent(new CustomEvent('APS_PROPS_DB_READY', { detail }));
  } catch (err) {
    console.warn('APS_PROPS_DB_READY event dispatch failed:', err);
  }
}

// ------------------------------------------------------
// 2. Viewer 초기화
// ------------------------------------------------------
export function initViewer(container) {
  return new Promise(function (resolve, reject) {
    Autodesk.Viewing.Initializer(
      { env: 'AutodeskProduction', getAccessToken: getAccessTokenForViewer },
      function () {
        const config = {
          extensions: [
            'Autodesk.DocumentBrowser',
            'LoggerExtension',
            'SummaryExtension',
            'HistogramExtension',
            'DataGridExtension'
          ]
        };

        const viewer = new Autodesk.Viewing.GuiViewer3D(container, config);
        viewer.start();
        viewer.setTheme('light-theme');

        viewer.addEventListener(
          Autodesk.Viewing.SELECTION_CHANGED_EVENT,
          (event) => {
            const dbIds = event?.dbIdArray || [];
            try {
              window.dispatchEvent(
                new CustomEvent('APS_SELECTION_CHANGED', { detail: { dbIds } })
              );
            } catch (err) {
              console.warn('APS_SELECTION_CHANGED event dispatch failed:', err);
            }
          }
        );

        globalViewer = viewer;
        window.globalViewer = viewer;

        resolve(viewer);
      }
    );
  });
}

// ------------------------------------------------------
// 3. 모델 로드 + Model Derivative 기반 속성 DB 구축
// ------------------------------------------------------
export function loadModel(viewer, urn) {
  // 새 모델을 로드할 때 기존 속성 DB 상태를 리셋하여 AI 가 최신 데이터를 구분할 수 있게 함
  window.__APS_PROPS_DB = null;
  resetPropsDbReadyPromise();
  window.__APS_MODEL_LOADING = true;
  window.__APS_ACTIVE_URN = urn;
  window.__APS_ACTIVE_VIEW = null;

  function onDocumentLoadSuccess(doc) {
    viewer
      .loadDocumentNode(doc, doc.getRoot().getDefaultGeometry())
      .then(async () => {
        console.log('Model loaded:', urn);
        window.dispatchEvent(new CustomEvent('APS_MODEL_LOADED', { detail: { urn } }));

        // (옵션) 구조 확인용 로그
        logModelDerivativePropertiesOnce(urn).catch(console.error);

        // ✅ Model Derivative 객체트리 + /properties:query 기반 DB 생성
        try {
          await buildPropsDatabaseFromModelDerivative(urn);
        } catch (err) {
          console.error('Error while building props DB from Model Derivative:', err);
          window.__APS_MODEL_LOADING = false;
        }
      });
  }

  function onDocumentLoadFailure(code, message) {
    window.__APS_MODEL_LOADING = false;
    alert('Could not load model. See console for more details.');
    console.error(message);
  }

  Autodesk.Viewing.Document.load('urn:' + urn, onDocumentLoadSuccess, onDocumentLoadFailure);
}

// ------------------------------------------------------
// 4. Model Derivative 공통 유틸 (PowerBI 코드 포팅)
// ------------------------------------------------------
function buildModelDerivativeBaseUrl(region) {
  const prefix =
    region === 'EMEA'
      ? 'https://developer.api.autodesk.com/modelderivative/v2/regions/eu'
      : 'https://developer.api.autodesk.com/modelderivative/v2';
  return prefix;
}

// GetModelViews: /metadata → view GUID 목록
async function getModelViews(urn, token, region) {
  const encodedUrn = getUrlEncodedUrn(urn);
  const base = buildModelDerivativeBaseUrl(region);
  const url = `${base}/designdata/${encodedUrn}/metadata`;
  const json = await fetchModelDerivativeJson(
    url,
    { headers: { Authorization: `Bearer ${token}` } },
    { label: 'GetModelViews' }
  );
  return json?.data?.metadata || [];
}

// GetModelTree: /metadata/{guid} → object tree 루트
async function getModelTree(urn, guid, token, region) {
  const encodedUrn = getUrlEncodedUrn(urn);
  const base = buildModelDerivativeBaseUrl(region);
  const url = `${base}/designdata/${encodedUrn}/metadata/${guid}`;
  const json = await fetchModelDerivativeJson(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    },
    { label: 'GetModelTree' }
  );
  // PowerBI: json[data][objects]{0}
  return json?.data?.objects?.[0] || null;
}

// GetModelProperties: /metadata/{guid}/properties:query
async function getModelProperties(urn, guid, objectIds, token, region) {
  if (!objectIds || objectIds.length === 0) return [];

  const encodedUrn = getUrlEncodedUrn(urn);
  const base = buildModelDerivativeBaseUrl(region);
  const url = `${base}/designdata/${encodedUrn}/metadata/${guid}/properties:query`;

  const payload = {
    pagination: {
      limit: objectIds.length
    },
    query: {
      $in: ['objectid'].concat(objectIds)
    }
  };
  const json = await fetchModelDerivativeJson(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    },
    { label: 'GetModelProperties' }
  );
  return json?.data?.collection || [];
}

function pickBestViewMetadata(metadataArray) {
  if (!Array.isArray(metadataArray) || metadataArray.length === 0) {
    return null;
  }

  const lowerRole = (meta) => normalizeLower(meta?.role);

  const byRole = metadataArray.find((meta) => lowerRole(meta) === '3d');
  if (byRole) return byRole;

  const nameMatches = metadataArray.find((meta) => /3d|default|뷰/i.test(meta?.name || ''));
  if (nameMatches) return nameMatches;

  return metadataArray[0];
}

// (옵션) 구조 확인용: GET /metadata/{guid}/properties 결과를 그대로 로그
let _loggedOnce = false;
async function logModelDerivativePropertiesOnce(urn, region) {
  if (_loggedOnce) return;
  _loggedOnce = true;

  try {
    const { access_token } = await getRawAccessToken();
    const metadataArray = await getModelViews(urn, access_token, region);
    const selectedView = pickBestViewMetadata(metadataArray);
    if (!selectedView) {
      console.warn('Cannot log properties: metadata call returned no views.');
      return;
    }

    const encodedUrn = getUrlEncodedUrn(urn);
    const base = buildModelDerivativeBaseUrl(region);
    const propsUrl = `${base}/designdata/${encodedUrn}/metadata/${selectedView.guid}/properties`;
    const propsJson = await fetchModelDerivativeJson(
      propsUrl,
      { headers: { Authorization: `Bearer ${access_token}` } },
      { label: 'LogModelDerivativeProperties' }
    );
    console.log('Model Derivative properties (raw GET):', propsJson);
    window.__lastPropsJson = propsJson;
  } catch (err) {
    console.error('logModelDerivativePropertiesOnce error:', err);
  }
}

// ------------------------------------------------------
// 5. Object Tree 재귀 탐색 → objectIds 수집
// ------------------------------------------------------
function collectObjectIdsFromTree(node, out) {
  if (!node || typeof node !== 'object') return;

  if (node.objectid != null) {
    out.push(node.objectid);
  }

  const children = node.objects || node.children || [];
  if (Array.isArray(children)) {
    for (const child of children) {
      collectObjectIdsFromTree(child, out);
    }
  }
}

// ------------------------------------------------------
// 6. Model Derivative 기반 __APS_PROPS_DB 구축
// ------------------------------------------------------
async function buildPropsDatabaseFromModelDerivative(urn, region) {
  const { access_token } = await getRawAccessToken();

  // 1) view GUID 획득
  const views = await getModelViews(urn, access_token, region);
  if (!Array.isArray(views) || views.length === 0) {
    console.warn('No views returned from Model Derivative metadata.');
    return;
  }
  const selectedView = pickBestViewMetadata(views);
  if (!selectedView) {
    console.warn('Could not select a view from metadata response.');
    return;
  }
  const guid = selectedView.guid;
  window.__APS_ACTIVE_VIEW = {
    guid,
    name: selectedView?.name,
    role: selectedView?.role,
    viewableID: selectedView?.guid
  };
  console.log('Using model view guid:', guid, '(', selectedView?.name || 'unknown', ')');

  // 2) object tree 로부터 objectIds 수집
  const root = await getModelTree(urn, guid, access_token, region);
  if (!root) {
    console.warn('Model tree root not found.');
    return;
  }
  const objectIds = [];
  collectObjectIdsFromTree(root, objectIds);
  console.log('MD props: total objectIds from tree:', objectIds.length);
  if (objectIds.length === 0) {
    console.warn('No objectIds collected from model tree.');
    return;
  }

  // 3) /properties:query 여러 번 호출
  const db = {};
  const chunkSize = 1000;
  for (let i = 0; i < objectIds.length; i += chunkSize) {
    const chunk = objectIds.slice(i, i + chunkSize);
    try {
      const collection = await getModelProperties(
        urn,
        guid,
        chunk,
        access_token,
        region
      );
      console.log(
        `MD props: fetched ${collection.length} items for chunk ${
          i / chunkSize
        }`
      );

      for (const obj of collection) {
        if (!obj || typeof obj !== 'object') continue;
        const id = obj.objectid;
        if (id == null) continue;

        if (!db[id]) db[id] = {};

        if (obj.name) db[id]['__name'] = obj.name;
        if (obj.externalId) db[id]['__externalId'] = obj.externalId;

        const categories = obj.properties || {};
        for (const categoryName in categories) {
          const cat = categories[categoryName];

          if (Array.isArray(cat)) {
            for (const prop of cat) {
              if (!prop) continue;
              const key = prop.displayName || prop.attributeName || prop.name;
              const val =
                prop.displayValue ??
                prop.value ??
                prop.defaultValue ??
                (typeof prop === 'object' ? undefined : prop);
              if (key != null && val !== undefined) db[id][key] = val;
            }
          } else if (typeof cat === 'object' && cat !== null) {
            for (const propName in cat) {
              const prop = cat[propName];
              const key = prop?.displayName || propName;
              const val =
                prop?.displayValue ??
                prop?.value ??
                prop?.defaultValue ??
                (prop !== null && typeof prop === 'object' ? undefined : prop);
              if (key != null && val !== undefined) db[id][key] = val;
            }
          }
        }
      }
    } catch (err) {
      console.error('getModelProperties error for chunk starting at', i, err);
    }
  }

  markPropsDbReady(db);
  console.log('Props DB built (MD). Total elements:', Object.keys(db).length);

  // ✅ 벽체 rows 미리 생성해 전역에 저장
try { refreshWallRows(); } catch (e) { console.warn('refreshWallRows failed:', e); }
}

// ------------------------------------------------------
// 7. 필터 엔진 (유연 매칭)
// ------------------------------------------------------
export function filterByCondition(condition) {
  const db = window.__APS_PROPS_DB || {};
  const result = [];

  for (const [dbId, props] of Object.entries(db)) {
    if (!passesCondition(props, condition)) continue;
    result.push(parseInt(dbId, 10));
  }

  return result;
}

const CATEGORY_KEYS = [
  'Category',
  'CategoryId',
  '카테고리',
  '분류',
  '범주',
  'Type Name',
  '종류',
  'Family',
  '패밀리',
  '패밀리 및 유형',
  '패밀리 및 타입',
  'System Classification',
  'Structural Usage',
  'Function'
];

const NAME_KEYS = [
  '__name',
  'Name',
  'Element Name',
  'Type',
  'Type Name',
  'Family and Type',
  'Family',
  'Symbol Name',
  '__externalId',
  'ExternalId',
  'External Id'
];

const HEIGHT_KEYS = [
  'Height',
  'Unconnected Height',
  'Unconnected Height (mm)',
  '미연결 높이',
  '미연결 높이(mm)',
  '미연결 높이 (mm)',
  'Base Constraint Height',
  'Top Offset',
  '높이',
  '높이(이름?)'
];

const MATERIAL_KEYS = [
  'Material',
  'Materials',
  'Material Name',
  'Structural Material',
  '재료',
  '구조 재료',
  '구조재료',
  '마감 재료',
  '마감재료'
];

const AREA_KEYS = ['Area', '면적', '표면적'];
const VOLUME_KEYS = ['Volume', '체적', '용적'];
const LEVEL_KEYS = ['Level', '레벨', '층', '참조 레벨', 'Reference Level'];

function buildStringProfile(props) {
  const categories = new Set();
  for (const key of CATEGORY_KEYS) {
    if (props[key] != null) {
      categories.add(normalizeString(props[key]));
    }
  }

  const texts = new Set();
  for (const key of NAME_KEYS) {
    if (props[key] != null) {
      texts.add(normalizeString(props[key]));
    }
  }

  // include categories also in searchable text pool
  for (const cat of categories) {
    texts.add(cat);
  }

  const searchableList = Array.from(texts).filter(Boolean);
  const searchableTextLower = searchableList.map((s) => s.toLowerCase()).join(' | ');

  return {
    categories: Array.from(categories).filter(Boolean),
    searchableList,
    searchableTextLower
  };
}

function ensureKeywordArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter((kw) => kw != null && String(kw).trim().length > 0);
  return [value].filter((kw) => kw != null && String(kw).trim().length > 0);
}

function includesAnyKeyword(targetLowerText, keywords) {
  if (!targetLowerText) return false;
  return keywords.some((kw) => targetLowerText.includes(kw.toLowerCase()));
}

function includesEveryKeyword(targetLowerText, keywords) {
  if (!targetLowerText) return false;
  return keywords.every((kw) => targetLowerText.includes(kw.toLowerCase()));
}

function parseNumeric(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return Number.isNaN(raw) ? null : raw;
  }
  if (typeof raw === 'string') {
    const match = raw.replace(/\s+/g, '').match(/-?\d+(?:[.,]\d+)?/);
    if (!match) return null;
    const num = parseFloat(match[0].replace(',', '.'));
    return Number.isNaN(num) ? null : num;
  }
  return null;
}

function convertLengthToMeters(value, unitHint) {
  if (value == null) return null;
  const unit = unitHint ? unitHint.toLowerCase() : '';
  if (unit.includes('mm')) return value / 1000;
  if (unit.includes('cm')) return value / 100;
  if (unit.includes('m')) return value;
  if (unit.includes('ft') || unit.includes('feet')) return value * 0.3048;
  if (unit.includes('in')) return value * 0.0254;
  if (Math.abs(value) > 50) {
    return value / 1000;
  }
  return value;
}

function resolveLengthValue(props, candidateKeys = [], fallbackRegex) {
  for (const key of candidateKeys) {
    if (props[key] != null) {
      const raw = props[key];
      if (typeof raw === 'string') {
        const normalized = raw.trim();
        if (normalized) {
          const numMatch = normalized.match(/-?\d+(?:[.,]\d+)?/);
          if (numMatch) {
            const value = parseFloat(numMatch[0].replace(',', '.'));
            if (!Number.isNaN(value)) {
              return convertLengthToMeters(value, normalized.replace(numMatch[0], ''));
            }
          }
        }
      } else if (typeof raw === 'number') {
        if (!Number.isNaN(raw)) {
          return convertLengthToMeters(raw);
        }
      }
    }
  }

  if (fallbackRegex) {
    for (const [key, val] of Object.entries(props)) {
      if (fallbackRegex.test(key)) {
        if (typeof val === 'string') {
          const normalized = val.trim();
          if (normalized) {
            const numMatch = normalized.match(/-?\d+(?:[.,]\d+)?/);
            if (numMatch) {
              const value = parseFloat(numMatch[0].replace(',', '.'));
              if (!Number.isNaN(value)) {
                return convertLengthToMeters(value, normalized.replace(numMatch[0], ''));
              }
            }
          }
        } else if (typeof val === 'number' && !Number.isNaN(val)) {
          return convertLengthToMeters(val);
        }
      }
    }
  }

  return null;
}

function resolveNumericValue(props, candidateKeys = [], fallbackRegex) {
  for (const key of candidateKeys) {
    if (props[key] != null) {
      const num = parseNumeric(props[key]);
      if (num != null) return num;
    }
  }

  if (fallbackRegex) {
    for (const [key, val] of Object.entries(props)) {
      if (fallbackRegex.test(key)) {
        const num = parseNumeric(val);
        if (num != null) return num;
      }
    }
  }

  return null;
}

function resolveStringValue(props, candidateKeys = []) {
  for (const key of candidateKeys) {
    if (props[key] != null) {
      return normalizeString(props[key]);
    }
  }
  return '';
}

function passesCondition(props, condition) {
  if (!condition) return true;

  const profile = buildStringProfile(props);
  const aggregatedText = profile.searchableTextLower;
  const categoryText = profile.categories.map((cat) => cat.toLowerCase()).join(' | ');

  // --- 카테고리 ---
  const categoryKeywords = [
    ...ensureKeywordArray(condition.category),
    ...ensureKeywordArray(condition.categoryKeywords)
  ];
  if (categoryKeywords.length > 0) {
    if (!categoryText || !includesAnyKeyword(categoryText, categoryKeywords.map(normalizeLower))) {
      return false;
    }
  }

  // --- 포함 키워드 ---
  const includeKeywords = ensureKeywordArray(condition.includeKeywords);
  if (includeKeywords.length > 0) {
    if (!includesEveryKeyword(aggregatedText, includeKeywords.map(normalizeLower))) {
      return false;
    }
  }

  // --- 제외 키워드 ---
  const excludeKeywords = ensureKeywordArray(condition.excludeKeywords);
  if (excludeKeywords.length > 0) {
    if (includesAnyKeyword(aggregatedText, excludeKeywords.map(normalizeLower))) {
      return false;
    }
  }

  // --- 층/레벨 ---
  if (condition.level) {
    const requiredLevels = ensureKeywordArray(condition.level);
    if (requiredLevels.length > 0) {
      const levelText = normalizeLower(resolveStringValue(props, LEVEL_KEYS));
      if (!levelText || !includesAnyKeyword(levelText, requiredLevels.map(normalizeLower))) {
        return false;
      }
    }
  }

  // --- 재료 ---
  if (condition.material) {
    const requiredMaterials = ensureKeywordArray(condition.material);
    if (requiredMaterials.length > 0) {
      // 재료는 여러 속성에 걸쳐 있을 수 있으므로 모든 MATERIAL_KEYS를 검사
      let found = false;
      for (const key of MATERIAL_KEYS) {
        if (props[key]) {
          const val = normalizeLower(props[key]);
          if (includesAnyKeyword(val, requiredMaterials.map(normalizeLower))) {
            found = true;
            break;
          }
        }
      }
      if (!found) return false;
    }
  }

  // --- 높이 ---
  const heightValue = resolveLengthValue(props, HEIGHT_KEYS, /height|높이/i);
  if (condition.minHeight != null && heightValue != null && heightValue < condition.minHeight) {
    return false;
  }
  if (condition.maxHeight != null && heightValue != null && heightValue > condition.maxHeight) {
    return false;
  }

  // --- 면적 ---
  const areaValue = resolveNumericValue(props, AREA_KEYS, /area|면적|표면적/i);
  if (condition.minArea != null && areaValue != null && areaValue < condition.minArea) {
    return false;
  }
  if (condition.maxArea != null && areaValue != null && areaValue > condition.maxArea) {
    return false;
  }

  // --- 체적 ---
  const volumeValue = resolveNumericValue(props, VOLUME_KEYS, /volume|체적|용적/i);
  if (condition.minVolume != null && volumeValue != null && volumeValue < condition.minVolume) {
    return false;
  }
  if (condition.maxVolume != null && volumeValue != null && volumeValue > condition.maxVolume) {
    return false;
  }

  // --- 커스텀 프레디케이트 ---
  if (typeof condition.customPredicate === 'function') {
    if (!condition.customPredicate(props, profile)) {
      return false;
    }
  }

  return true;
}

// ------------------------------------------------------
// 8. 속성 조회 헬퍼 (AI/외부 스크립트에서 사용)
// ------------------------------------------------------
function getPropsDb() {
  return window.__APS_PROPS_DB || null;
}

function getPropertiesForDbId(dbId) {
  if (dbId == null) return null;
  const db = getPropsDb();
  if (!db) return null;
  return db[dbId] || null;
}

function getPropertiesForDbIds(dbIds) {
  if (!Array.isArray(dbIds) || dbIds.length === 0) return [];
  const db = getPropsDb();
  if (!db) return [];
  return dbIds
    .map((dbId) => ({ dbId, properties: db[dbId] || null }))
    .filter((entry) => entry.properties);
}

function getSelectedDbIds() {
  if (!globalViewer || typeof globalViewer.getSelection !== 'function') return [];
  const selection = globalViewer.getSelection();
  return Array.isArray(selection) ? selection : [];
}

function getSelectedProperties() {
  return getPropertiesForDbIds(getSelectedDbIds());
}

async function waitForPropsDb() {
  if (getPropsDb()) return getPropsDb();
  return propsDbReadyPromise;
}

function whenPropsDbReady(callback) {
  if (typeof callback !== 'function') return;
  if (getPropsDb()) {
    callback(getPropsDb());
    return;
  }
  propsDbReadyPromise.then(callback);
}

// ------------------------------------------------------
// 8. 글로벌 바인딩
// ------------------------------------------------------
window.globalViewer = globalViewer;
window.filterByCondition = filterByCondition;
window.passesCondition = passesCondition;
window.getPropsDb = getPropsDb;
window.getPropertiesForDbId = getPropertiesForDbId;
window.getPropertiesForDbIds = getPropertiesForDbIds;
window.getSelectedDbIds = getSelectedDbIds;
window.getSelectedProperties = getSelectedProperties;
window.waitForPropsDb = waitForPropsDb;
window.whenPropsDbReady = whenPropsDbReady;

window.applyFilter = function (condition) {
  try {
    const ids = filterByCondition(condition);
    console.log(`applyFilter: found ${ids.length} elements.`);
    if (globalViewer && ids.length > 0) {
      globalViewer.isolate(ids);
      globalViewer.fitToView(ids);
    } else if (globalViewer) {
      console.warn('No elements matched the condition.');
      globalViewer.showAll();
      globalViewer.fitToView();
    } else {
      console.warn('Viewer is not initialized yet.');
    }
    return ids;
  } catch (err) {
    console.error('applyFilter error:', err);
    return [];
  }
};

window.resetModel = function () {
  try {
    if (globalViewer) {
      globalViewer.showAll();
      globalViewer.fitToView();
    } else {
      console.warn('Viewer is not initialized yet.');
    }
  } catch (err) {
    console.error('resetModel error:', err);
  }
};

window.showEntireModel = window.resetModel;

// ------------------------------------------------------
// 9. 벽체 rows 생성 헬퍼 (summary API 입력용)
// ------------------------------------------------------

const THICKNESS_KEYS = [
  '폭', 'Width', '두께', '벽 두께', '구조 두께', 'Wall Width', 'Thickness'
];

function extractThicknessFromText(text) {
  if (!text) return null;
  const t = String(text);

  let m = t.match(/T(\d{2,4})/i);
  if (m) return Number(m[1]);

  m = t.match(/WALL[_-](\d{2,4})/i);
  if (m) return Number(m[1]);

  m = t.match(/(\d{2,4})\s*mm/i);
  if (m) return Number(m[1]);

  return null;
}

export function buildWallRowsFromPropsDb(db) {
  const rows = [];
  const propsDb = db || window.__APS_PROPS_DB || {};

  for (const [dbIdStr, props] of Object.entries(propsDb)) {
    if (!props) continue;

    // 카테고리 판정
    const profile = buildStringProfile(props);
    const categoryTextLower = profile.categories.map(c => c.toLowerCase()).join(' | ');

    const isWall =
      categoryTextLower.includes('revit 벽') ||
      categoryTextLower.includes('wall') ||
      includesAnyKeyword(profile.searchableTextLower, ['revit 벽', '벽', 'wall']);

    if (!isWall) continue;

    // thickness 찾기
    let thickness_m = resolveLengthValue(props, THICKNESS_KEYS, /width|thickness|두께|폭/i);
    let thickness_mm = thickness_m != null ? thickness_m * 1000 : null;

    // thickness 백업
    if (thickness_mm == null) {
      const nameText =
        resolveStringValue(props, NAME_KEYS) ||
        props['Type Name'] ||
        props['유형 이름'] ||
        props['__name'];
      const tmm = extractThicknessFromText(nameText);
      if (tmm != null) thickness_mm = tmm;
    }

    if (thickness_mm == null) continue;

    // 체적 확보
    const volume_m3 = resolveNumericValue(props, VOLUME_KEYS, /volume|체적|용적/i);
    if (volume_m3 == null) continue;

    rows.push({
      id: Number(dbIdStr),
      name: props['__name'] || props['Name'] || '',
      thickness_mm: Math.round(Number(thickness_mm)),
      volume_m3: Number(volume_m3)
    });
  }

  return rows;
}

export function refreshWallRows() {
  const db = window.__APS_PROPS_DB;
  if (!db) return [];
  const rows = buildWallRowsFromPropsDb(db);
  window.__LAST_WALL_ROWS = rows;
  console.log('[walls] rows prepared =', rows.length);
  return rows;
}

window.refreshWallRows = refreshWallRows;
window.buildWallRowsFromPropsDb = buildWallRowsFromPropsDb;

// ✅ 하단 패널 렌더러
window.updateScheduleTable = function(table) {
  const panel = document.getElementById('bottomSummaryPanel');
  const titleEl = document.getElementById('bottomSummaryTitle');
  const descEl = document.getElementById('bottomSummaryDesc');
  const wrapEl = document.getElementById('bottomSummaryTableWrap');
  const closeBtn = document.getElementById('bottomSummaryClose');

  if (!panel || !wrapEl) {
    console.warn('bottom summary panel not found');
    return;
  }

  // 제목/설명
  if (titleEl) titleEl.textContent = table?.title || '요약 표';
  if (descEl) descEl.textContent = table?.description || '';

  // 표 생성
  const columns = table?.columns || [];
  const rows = table?.rows || [];

  const html = `
    <table>
      <thead>
        <tr>${columns.map((c) => `<th>${c}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `
          <tr>${r.map((v) => `<td>${v}</td>`).join('')}</tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  wrapEl.innerHTML = html;
  panel.classList.remove('hidden');

  // 닫기 버튼
  if (closeBtn && !closeBtn.__bound) {
    closeBtn.__bound = true;
    closeBtn.addEventListener('click', () => {
      panel.classList.add('hidden');
    });
  }
};
