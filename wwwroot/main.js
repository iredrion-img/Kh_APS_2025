import { initViewer, loadModel } from './viewer.js';
import { initTree } from './sidebar.js';

const CATEGORY_SOURCE_KEYS = [
    'Category',
    '카테고리'
];

const schedulePanelEl = document.getElementById('schedulePanel');
const scheduleTitleEl = document.getElementById('scheduleTitle');
const scheduleDescriptionEl = document.getElementById('scheduleDescription');
const scheduleHeadEl = document.getElementById('scheduleTableHead');
const scheduleBodyEl = document.getElementById('scheduleTableBody');
const scheduleWrapperEl = document.querySelector('#schedulePanel .schedule-table-wrapper');
const scheduleEmptyEl = document.getElementById('scheduleEmptyState');
const scheduleCloseBtn = document.getElementById('scheduleCloseBtn');
const scheduleCollapseBtn = document.getElementById('scheduleCollapseBtn');

function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeTableRows(columns, rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => {
        if (Array.isArray(row)) {
            return row.map((cell) => cell ?? '');
        }
        if (row && typeof row === 'object') {
            return columns.map((col) => {
                const key = col;
                const lowerKey = col?.toLowerCase?.();
                if (row[key] != null) return row[key];
                if (lowerKey && row[lowerKey] != null) return row[lowerKey];
                return '';
            });
        }
        return [row];
    });
}

function clearScheduleTable(message) {
    if (!schedulePanelEl) return;
    schedulePanelEl.dataset.visible = 'false';
    schedulePanelEl.dataset.empty = 'true';
    if (scheduleWrapperEl) scheduleWrapperEl.scrollTop = 0;
    if (scheduleHeadEl) scheduleHeadEl.innerHTML = '';
    if (scheduleBodyEl) scheduleBodyEl.innerHTML = '';
    if (scheduleEmptyEl) {
        scheduleEmptyEl.textContent = message || '표시할 데이터가 없습니다.';
    }
    updateScheduleOffset();
}

function updateScheduleTable(data = {}) {
    if (!schedulePanelEl) return;
    const columns = Array.isArray(data.columns) && data.columns.length ? data.columns : ['항목', '값'];
    const normalizedRows = normalizeTableRows(columns, data.rows || []);

    scheduleTitleEl && (scheduleTitleEl.textContent = data.title || '일람표');
    scheduleDescriptionEl && (scheduleDescriptionEl.textContent = data.description || '조건에 맞춰 데이터를 정리했습니다.');

    if (scheduleHeadEl) {
        scheduleHeadEl.innerHTML = `<tr>${columns.map(col => `<th>${escapeHtml(col)}</th>`).join('')}</tr>`;
    }

    if (scheduleBodyEl) {
        if (normalizedRows.length) {
            scheduleBodyEl.innerHTML = normalizedRows
                .map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
                .join('');
        } else {
            scheduleBodyEl.innerHTML = '';
        }
    }

    if (schedulePanelEl) {
        schedulePanelEl.dataset.visible = 'true';
        schedulePanelEl.dataset.empty = normalizedRows.length ? 'false' : 'true';
        schedulePanelEl.classList.remove('collapsed');
    }
    if (scheduleCollapseBtn) {
        scheduleCollapseBtn.textContent = '접기';
    }
    updateScheduleOffset();
}

scheduleCloseBtn?.addEventListener('click', () => clearScheduleTable());
scheduleCollapseBtn?.addEventListener('click', () => {
    if (!schedulePanelEl) return;
    const collapsed = schedulePanelEl.classList.toggle('collapsed');
    scheduleCollapseBtn.textContent = collapsed ? '펼치기' : '접기';
    updateScheduleOffset();
});

window.updateScheduleTable = updateScheduleTable;
window.clearScheduleTable = clearScheduleTable;
window.computeWallThicknessVolumeTable = computeWallThicknessVolumeTable;

function updateScheduleOffset() {
    const docEl = document.documentElement;
    if (!docEl) return;
    const isVisible = schedulePanelEl?.dataset?.visible === 'true';
    let offset = 0;
    if (schedulePanelEl && isVisible && !schedulePanelEl.classList.contains('collapsed')) {
        const rect = schedulePanelEl.getBoundingClientRect();
        offset = rect.height + 32; // panel height + gap
    }
    docEl.style.setProperty('--schedule-panel-height', `${offset}px`);
    if (document.body) {
        document.body.classList.toggle('schedule-open', offset > 0);
    }
}

function parseNumericValue(value) {
    if (value == null) return null;
    if (typeof value === 'number') {
        return Number.isNaN(value) ? null : value;
    }
    if (typeof value === 'string') {
        const match = value.replace(/\s+/g, '').match(/-?\d+(?:[.,]\d+)?/);
        if (!match) return null;
        const num = parseFloat(match[0].replace(',', '.'));
        return Number.isNaN(num) ? null : num;
    }
    return null;
}

function extractLengthInfo(props, candidateKeys = []) {
    for (const key of candidateKeys) {
        if (props[key] != null) {
            const raw = props[key];
            if (typeof raw === 'number') {
                return { numeric: raw, label: raw.toString() };
            }
            if (typeof raw === 'string') {
                const match = raw.match(/-?\d+(?:[.,]\d+)?/);
                if (match) {
                    const unit = raw.replace(match[0], '').trim();
                    const num = parseFloat(match[0].replace(',', '.'));
                    if (!Number.isNaN(num)) {
                        return {
                            numeric: num,
                            label: unit ? `${num}${unit}` : `${num}`
                        };
                    }
                }
                return { numeric: null, label: raw };
            }
        }
    }
    return { numeric: null, label: '' };
}

function extractVolumeValue(props, keys = []) {
    for (const key of keys) {
        if (props[key] != null) {
            const num = parseNumericValue(props[key]);
            if (num != null) return num;
        }
    }
    return null;
}

async function computeWallThicknessVolumeTable() {
    await ensurePropsDbReady();
    const db = window.getPropsDb();
    if (!db) throw new Error('Properties database is not ready.');

    let dbIds = [];
    try {
        dbIds = typeof window.filterByCondition === 'function'
            ? window.filterByCondition({ categoryKeywords: WALL_CATEGORY_KEYWORDS })
            : Object.keys(db).map((id) => Number(id));
    } catch (err) {
        console.warn('filterByCondition failed, using all db entries.', err);
        dbIds = Object.keys(db).map((id) => Number(id));
    }

    const aggregates = new Map();
    for (const dbId of dbIds) {
        const props = db[dbId];
        if (!props) continue;

        const widthInfo = extractLengthInfo(props, WIDTH_PROP_KEYS);
        const volume = extractVolumeValue(props, VOLUME_PROP_KEYS);
        if (volume == null) continue;

        const widthLabel = widthInfo.label || (widthInfo.numeric != null ? widthInfo.numeric.toString() : '기타');
        if (!aggregates.has(widthLabel)) {
            aggregates.set(widthLabel, {
                widthNumeric: widthInfo.numeric,
                volume: 0,
                count: 0
            });
        }
        const entry = aggregates.get(widthLabel);
        entry.volume += volume;
        entry.count += 1;
    }

    const rows = Array.from(aggregates.entries())
        .sort((a, b) => {
            const aVal = a[1].widthNumeric ?? Number.POSITIVE_INFINITY;
            const bVal = b[1].widthNumeric ?? Number.POSITIVE_INFINITY;
            return aVal - bVal;
        })
        .map(([label, data]) => {
            const vol = data.volume;
            const displayVolume = Number.isFinite(vol) ? vol.toFixed(3) : '0';
            return [label, displayVolume, data.count.toString()];
        });

    return {
        title: '벽체 두께별 체적',
        description: '모델 속성에서 벽체의 폭/두께를 기준으로 체적을 집계했습니다.',
        columns: ['두께', '체적 합계', '갯수'],
        rows
    };
}

const METADATA_ALWAYS_INCLUDE = Array.from(new Set([
    ...CATEGORY_SOURCE_KEYS,
    'Family',
    'Family Name',
    '타입 패밀리',
    '패밀리',
    'Type',
    'Type Name',
    '타입 이름',
    'Level',
    '층',
    'Reference Level',
    '참조 레벨',
    'Height',
    'Unconnected Height',
    'Unconnected Height (mm)',
    '미연결 높이',
    '미연결 높이(mm)',
    '미연결 높이 (mm)',
    'Width',
    '벽 두께',
    '벽 폭',
    '폭',
    '두께',
    'Thickness',
    'Overall Width',
    '타입 폭',
    'Nominal Width'
]));

const WALL_CATEGORY_KEYWORDS = ['벽', 'wall', 'revit wall', 'Revit 벽'];

const WIDTH_PROP_KEYS = [
    'Width',
    '벽 두께',
    '벽 폭',
    '폭',
    '두께',
    'Nominal Width',
    'Thickness',
    'Overall Width',
    '타입 폭',
    '타입 두께'
];

const VOLUME_PROP_KEYS = [
    'Volume',
    '체적',
    '부피',
    '용적',
    'Gross Volume'
];

function normalizeCategoryValue(value) {
    if (!value && value !== 0) return '';
    return String(value)
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/revit/g, '')
        .replace(/category/g, '')
        .replace(/카테고리/g, '');
}

function normalizeMetadataPropertyList(propertyNames = []) {
    const seen = new Map();
    const register = (name) => {
        if (!name) return;
        const key = String(name).toLowerCase();
        if (!seen.has(key)) {
            seen.set(key, name);
        }
    };
    METADATA_ALWAYS_INCLUDE.forEach(register);
    (propertyNames || []).forEach(register);
    return Array.from(seen.values());
}

const SIDEBAR_STORAGE_KEY = 'kh.sidebarWidth';
const CHAT_STORAGE_KEY = 'kh.chatWidth';
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 520;
const CHAT_MIN_WIDTH = 320;
const CHAT_MAX_WIDTH = 560;

function extractCategoryValue(properties = []) {
    if (!Array.isArray(properties)) return '';
    const normalizedKeys = CATEGORY_SOURCE_KEYS.map(key => key.toLowerCase());
    for (const prop of properties) {
        const name = String(prop.displayName || '').toLowerCase();
        if (normalizedKeys.includes(name)) {
            return prop.displayValue ?? '';
        }
    }
    return '';
}

async function ensurePropsDbReady(timeoutMs = 20000) {
    const waitForPropsDb = window.waitForPropsDb;
    if (typeof waitForPropsDb !== 'function') {
        throw new Error('Viewer filter helpers are not ready yet. 페이지를 새로고침한 뒤 다시 시도하세요.');
    }

    const waitPromise = waitForPropsDb();
    if (window.__APS_PROPS_DB) {
        return waitPromise;
    }

    if (!window.__APS_MODEL_LOADING) {
        throw new Error('모델을 선택해 로드한 뒤 다시 시도해주세요.');
    }

    await Promise.race([
        waitPromise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error('모델 속성 데이터가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.')), timeoutMs);
        })
    ]);
    return waitPromise;
}

async function runFilterPreset({ label = '필터', condition = {}, fallbackCondition, minResultCount = 1, timeoutMs = 20000 }) {
    if (!window.globalViewer) {
        throw new Error('Viewer is not initialized yet. 모델을 먼저 로드하세요.');
    }
    if (typeof window.applyFilter !== 'function') {
        throw new Error('Viewer filter helpers are not ready yet.');
    }

    await ensurePropsDbReady(timeoutMs);

    const ids = window.applyFilter(condition) || [];
    if (ids.length >= minResultCount || !fallbackCondition) {
        return { label, ids, condition, fallbackUsed: false };
    }

    console.warn(`${label}: 결과가 ${ids.length}개라서 보조 조건을 사용합니다.`, {
        condition,
        fallbackCondition
    });

    const fallbackIds = window.applyFilter(fallbackCondition) || [];
    return { label, ids: fallbackIds, condition: fallbackCondition, fallbackUsed: true };
}

function getLeafNodes(model) {
    return new Promise((resolve, reject) => {
        model.getObjectTree((tree) => {
            const leaves = [];
            tree.enumNodeChildren(tree.getRootId(), (dbId) => {
                if (tree.getChildCount(dbId) === 0) {
                    leaves.push(dbId);
                }
            }, true);
            resolve(leaves);
        }, reject);
    });
}

async function getModelCategories(model) {
    const leaves = await getLeafNodes(model);
    return new Promise((resolve, reject) => {
        model.getBulkProperties(leaves, { propFilter: CATEGORY_SOURCE_KEYS }, (results) => {
            const categories = new Set();
            for (const result of results) {
                for (const prop of result.properties) {
                    if (prop.displayValue) {
                        categories.add(String(prop.displayValue));
                    }
                }
            }
            resolve(Array.from(categories).sort((a, b) => a.localeCompare(b, 'ko-KR')));
        }, reject);
    });
}

async function filterByCategory(model, category) {
    const leaves = await getLeafNodes(model);
    const normalizedSearch = normalizeCategoryValue(category);
    const rawSearch = String(category || '').toLowerCase();

    return new Promise((resolve, reject) => {
        model.getBulkProperties(leaves, { propFilter: CATEGORY_SOURCE_KEYS }, (results) => {
            const ids = [];

            for (const result of results) {
                for (const prop of result.properties) {
                    const rawVal = prop?.displayValue;
                    if (rawVal == null) continue;

                    const val = String(rawVal);
                    const normalizedActual = normalizeCategoryValue(val);

                    // 1. 정확히 일치
                    if (val === category) {
                        ids.push(result.dbId);
                        break;
                    }

                    // 2. 부분 일치 (예: "벽" -> "Revit 벽", "기둥" -> "구조 기둥")
                    const hasDirectInclude = rawSearch && val.toLowerCase().includes(rawSearch);
                    const hasNormalizedMatch = normalizedSearch && normalizedActual && (
                        normalizedActual.includes(normalizedSearch) ||
                        normalizedSearch.includes(normalizedActual)
                    );

                    if (hasDirectInclude || hasNormalizedMatch) {
                        ids.push(result.dbId);
                        break;
                    }
                }
            }
            resolve(ids);
        }, reject);
    });
}

async function applyCategoryFilter(categoryLabel, options = {}) {
    if (!categoryLabel) {
        window.globalViewer.showAll();
        return { label: '전체 모델', ids: [] };
    }

    if (!window.globalViewer) {
        throw new Error('Viewer is not initialized yet. 모델을 먼저 로드하세요.');
    }

    const ids = await filterByCategory(window.globalViewer.model, categoryLabel);
    const mode = options.mode || 'isolate';
    
    if (ids.length > 0) {
        if (mode === 'hide') {
            window.globalViewer.hide(ids);
        } else {
            window.globalViewer.isolate(ids);
            window.globalViewer.fitToView(ids);
        }
    } else {
        if (mode === 'isolate') {
            window.globalViewer.showAll();
        }
    }

    return { label: options.label ?? `${categoryLabel} 카테고리`, ids };
}

/**
 * AI 학습용 모델 메타데이터 추출 (CSV 문자열 반환)
 */
async function getModelMetadataCSV() {
    if (!window.globalViewer || !window.globalViewer.model) {
        throw new Error('모델이 로드되지 않았습니다.');
    }

    const model = window.globalViewer.model;
    const leaves = await getLeafNodes(model);
    
    return new Promise((resolve, reject) => {
        model.getBulkProperties(leaves, {}, (results) => {
            let csvContent = "ID,Name,Category,Properties\n";

            results.forEach((item) => {
                const id = item.dbId;
                const name = item.name;
                // 카테고리 찾기
                const catProp = item.properties.find(p => p.displayName === 'Category' || p.displayName === '카테고리');
                const category = catProp ? catProp.displayValue : 'Unknown';

                // 주요 속성들을 하나의 텍스트로 요약
                const propsSummary = item.properties
                    .filter(p => p.displayValue && typeof p.displayValue !== 'object') // 값이 있는 것만
                    .map(p => `${p.displayName}:${p.displayValue}`)
                    .join(' | ');

                // CSV 행 추가 (특수문자 처리)
                const row = [
                    id,
                    `"${name.replace(/"/g, '""')}"`,
                    `"${String(category).replace(/"/g, '""')}"`,
                    `"${propsSummary.replace(/"/g, '""')}"`
                ].join(",");
                csvContent += row + "\n";
            });
            resolve(csvContent);
        }, reject);
    });
}

/**
 * AI 학습용 모델 메타데이터 추출 및 다운로드
 */
async function exportModelMetadataToCSV() {
    try {
        const csvContent = await getModelMetadataCSV();
        
        // 파일 다운로드 트리거
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `model_metadata_${new Date().getTime()}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // 행 개수 계산 (헤더 제외)
        const count = csvContent.split('\n').length - 2; 
        return count;
    } catch (err) {
        console.error(err);
        throw err;
    }
}

/**
 * AI 요청에 따라 특정 속성만 포함된 CSV 추출
 */
async function getSpecificPropertiesCSV(propertyNames, options = {}) {
    if (!window.globalViewer || !window.globalViewer.model) {
        throw new Error('??? ???? ?????.');
    }

    const model = window.globalViewer.model;
    const leaves = await getLeafNodes(model);
    const finalProperties = normalizeMetadataPropertyList(propertyNames);
    const normalizedCategoryFilter = options.category ? normalizeCategoryValue(options.category) : '';

    return new Promise((resolve, reject) => {
        model.getBulkProperties(leaves, {}, (results) => {
            let csvContent = "ID," + finalProperties.map(p => `"${p}"`).join(",") + "\n";

            results.forEach((item) => {
                const id = item.dbId;
                const categoryValue = extractCategoryValue(item.properties);
                if (normalizedCategoryFilter) {
                    const normalizedActual = normalizeCategoryValue(categoryValue);
                    const matches = normalizedActual && (
                        normalizedActual.includes(normalizedCategoryFilter) ||
                        normalizedCategoryFilter.includes(normalizedActual)
                    );
                    if (!matches) {
                        return;
                    }
                }

                const propertyMap = new Map();
                (item.properties || []).forEach(prop => {
                    const key = String(prop.displayName || '').toLowerCase();
                    if (!propertyMap.has(key)) {
                        propertyMap.set(key, prop);
                    }
                });

                const rowValues = [id];
                let hasAnyValue = false;

                finalProperties.forEach(propName => {
                    if (!propName) return;
                    const prop = propertyMap.get(String(propName).toLowerCase());
                    let val = prop ? prop.displayValue : '';
                    if (val == null) val = '';
                    else hasAnyValue = true;
                    rowValues.push(`"${String(val).replace(/"/g, '""')}"`);
                });

                if (hasAnyValue) {
                    csvContent += rowValues.join(",") + "\n";
                }
            });
            resolve(csvContent);
        }, reject);
    });
}

window.getSpecificPropertiesCSV = getSpecificPropertiesCSV;
window.resolveMetadataProperties = normalizeMetadataPropertyList;

async function applyAiFilter(condition) {
    if (!window.globalViewer) {
        throw new Error('Viewer is not initialized yet.');
    }

    const mode = condition.mode || 'isolate';

    const otherConditionsExist =
        Boolean(condition.level) ||
        Boolean(condition.name_contains) ||
        Boolean(condition.material) ||
        condition.min_height != null ||
        condition.max_height != null ||
        condition.min_area != null ||
        condition.max_area != null ||
        condition.min_volume != null ||
        condition.max_volume != null;

    if (condition.category && !otherConditionsExist) {
        return applyCategoryFilter(condition.category, { label: `${condition.category} 카테고리`, mode });
    }

    // 1. 카테고리 조건이 있으면, 신뢰도 높은 SVF 기반 filterByCategory 우선 사용
    let baseIds = null;
    if (condition.category) {
        try {
            baseIds = await filterByCategory(window.globalViewer.model, condition.category);
            if (baseIds.length === 0) {
                console.warn('Category filter returned 0 results; falling back to PropsDB scan.', condition.category);
                baseIds = null; // allow fallback logic below to run keyword search instead of showing all
            }
        } catch (err) {
            console.warn('SVF category filter failed, falling back to PropsDB', err);
        }
    }

    // 2. 나머지 조건 준비
    const filterOptions = {
        // categoryKeywords: ... (아래 Case B에서 사용)
        level: condition.level,
        material: condition.material,
        includeKeywords: condition.name_contains ? [condition.name_contains] : [],
        minHeight: condition.min_height,
        maxHeight: condition.max_height,
        minArea: condition.min_area,
        maxArea: condition.max_area,
        minVolume: condition.min_volume,
        maxVolume: condition.max_volume
    };

    // 3. 필터링 실행
    // Case A: 카테고리로 1차 필터링된 ID가 있는 경우 (또는 빈 배열이어도 검색 시도한 경우)
    if (baseIds !== null) {
        // 추가 조건이 있는지 확인
            const hasOtherConditions = otherConditionsExist;

        let finalIds = baseIds;

        if (hasOtherConditions) {
            await ensurePropsDbReady();
            const db = window.getPropsDb();
            if (db) {
                finalIds = baseIds.filter(dbId => {
                    const props = db[dbId];
                    // 이미 카테고리는 만족했으므로, filterOptions(카테고리 제외)만 체크
                    return props && window.passesCondition(props, filterOptions);
                });
            }
        }

        // 결과 반영
        if (finalIds.length > 0) {
            if (mode === 'hide') {
                window.globalViewer.showAll(); // 숨기기 모드일 때는 먼저 전체를 보여줌
                window.globalViewer.hide(finalIds);
            } else {
                window.globalViewer.isolate(finalIds);
                window.globalViewer.fitToView(finalIds);
            }
        } else {
            if (mode === 'isolate') {
                window.globalViewer.showAll();
            }
        }
        return { label: 'AI 맞춤 필터', ids: finalIds };
    }

    // Case B: 카테고리 조건이 없거나 SVF 필터 실패 -> 기존 PropsDB 전수 검색
    const fallbackOptions = {
        ...filterOptions,
        categoryKeywords: condition.category ? [condition.category] : []
    };

    const result = await runFilterPreset({
        label: 'AI 맞춤 필터',
        condition: fallbackOptions,
        fallbackCondition: null,
        minResultCount: 1,
        timeoutMs: 20000
    });

    // Case B 결과 반영 (runFilterPreset은 ID만 반환하므로 여기서 처리)
    if (result.ids && result.ids.length > 0) {
        if (mode === 'hide') {
            window.globalViewer.showAll(); // 숨기기 모드일 때는 먼저 전체를 보여줌
            window.globalViewer.hide(result.ids);
        } else {
            window.globalViewer.isolate(result.ids);
            window.globalViewer.fitToView(result.ids);
        }
    } else {
        if (mode === 'isolate') {
            window.globalViewer.showAll();
        }
    }

    return result;
}

window.applyAiFilter = applyAiFilter;
window.exportModelMetadataToCSV = exportModelMetadataToCSV;
window.applyCategoryFilter = applyCategoryFilter;

initResizablePanels();

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function readStoredWidth(key, min, max) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) {
            return null;
        }
        const parsed = parseInt(raw, 10);
        if (Number.isNaN(parsed)) {
            return null;
        }
        return clampNumber(parsed, min, max);
    } catch (err) {
        console.warn('Failed to read saved width', err);
        return null;
    }
}

function persistWidth(key, value) {
    try {
        localStorage.setItem(key, String(Math.round(value)));
    } catch (err) {
        console.warn('Failed to store width preference', err);
    }
}

function initResizablePanels() {
    const root = document.documentElement;
    const sidebar = document.getElementById('sidebar');
    const sidebarResizer = document.getElementById('sidebarResizer');
    const chatResizer = document.getElementById('chatResizer');
    const chatBox = document.getElementById('chatBox');

    const savedSidebarWidth = readStoredWidth(SIDEBAR_STORAGE_KEY, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
    if (savedSidebarWidth) {
        root.style.setProperty('--sidebar-width', `${savedSidebarWidth}px`);
    } else if (sidebar) {
        requestAnimationFrame(() => {
            const width = sidebar.getBoundingClientRect().width;
            if (width) {
                root.style.setProperty('--sidebar-width', `${Math.round(width)}px`);
            }
        });
    }

    const savedChatWidth = readStoredWidth(CHAT_STORAGE_KEY, CHAT_MIN_WIDTH, CHAT_MAX_WIDTH);
    if (savedChatWidth) {
        root.style.setProperty('--chat-panel-width', `${savedChatWidth}px`);
    }

    function startSidebarDrag(startX, pointerType) {
        if (!sidebar) return;
        const initialWidth = sidebar.getBoundingClientRect().width || SIDEBAR_MIN_WIDTH;
        let latestWidth = initialWidth;

        const move = (clientX) => {
            const next = clampNumber(initialWidth + (clientX - startX), SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
            latestWidth = next;
            root.style.setProperty('--sidebar-width', `${next}px`);
        };

        const moveHandler = (event) => {
            const clientX = pointerType === 'mouse' ? event.clientX : event.touches?.[0]?.clientX;
            if (clientX == null) return;
            event.preventDefault();
            move(clientX);
        };

        const stopHandler = () => {
            document.body.classList.remove('is-resizing');
            if (pointerType === 'mouse') {
                window.removeEventListener('mousemove', moveHandler);
                window.removeEventListener('mouseup', stopHandler);
            } else {
                window.removeEventListener('touchmove', moveHandler);
                window.removeEventListener('touchend', stopHandler);
                window.removeEventListener('touchcancel', stopHandler);
            }
            persistWidth(SIDEBAR_STORAGE_KEY, latestWidth);
        };

        document.body.classList.add('is-resizing');

        if (pointerType === 'mouse') {
            window.addEventListener('mousemove', moveHandler);
            window.addEventListener('mouseup', stopHandler);
        } else {
            window.addEventListener('touchmove', moveHandler, { passive: false });
            window.addEventListener('touchend', stopHandler);
            window.addEventListener('touchcancel', stopHandler);
        }
    }

    function startChatDrag(startX, pointerType) {
        if (!chatBox || !document.body.classList.contains('chat-open')) {
            return;
        }
        const initialWidth = chatBox.getBoundingClientRect().width || savedChatWidth || CHAT_MIN_WIDTH;
        let latestWidth = initialWidth;

        const move = (clientX) => {
            const delta = startX - clientX;
            const next = clampNumber(initialWidth + delta, CHAT_MIN_WIDTH, CHAT_MAX_WIDTH);
            latestWidth = next;
            root.style.setProperty('--chat-panel-width', `${next}px`);
        };

        const moveHandler = (event) => {
            const clientX = pointerType === 'mouse' ? event.clientX : event.touches?.[0]?.clientX;
            if (clientX == null) return;
            event.preventDefault();
            move(clientX);
        };

        const stopHandler = () => {
            document.body.classList.remove('is-resizing');
            if (pointerType === 'mouse') {
                window.removeEventListener('mousemove', moveHandler);
                window.removeEventListener('mouseup', stopHandler);
            } else {
                window.removeEventListener('touchmove', moveHandler);
                window.removeEventListener('touchend', stopHandler);
                window.removeEventListener('touchcancel', stopHandler);
            }
            persistWidth(CHAT_STORAGE_KEY, latestWidth);
        };

        document.body.classList.add('is-resizing');

        if (pointerType === 'mouse') {
            window.addEventListener('mousemove', moveHandler);
            window.addEventListener('mouseup', stopHandler);
        } else {
            window.addEventListener('touchmove', moveHandler, { passive: false });
            window.addEventListener('touchend', stopHandler);
            window.addEventListener('touchcancel', stopHandler);
        }
    }

    sidebarResizer?.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        startSidebarDrag(event.clientX, 'mouse');
    });
    sidebarResizer?.addEventListener('touchstart', (event) => {
        const touch = event.touches?.[0];
        if (!touch) return;
        event.preventDefault();
        startSidebarDrag(touch.clientX, 'touch');
    }, { passive: false });

    chatResizer?.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        startChatDrag(event.clientX, 'mouse');
    });
    chatResizer?.addEventListener('touchstart', (event) => {
        const touch = event.touches?.[0];
        if (!touch) return;
        event.preventDefault();
        startChatDrag(touch.clientX, 'touch');
    }, { passive: false });
}

function setupQuickActions() {
    const resetBtn = document.getElementById('btnResetView');

    resetBtn?.addEventListener('click', () => {
        try {
            showEntireModel();
        } catch (err) {
            console.error(err);
            alert(err.message || '모델을 초기화하지 못했습니다.');
        }
    });
}

setupQuickActions();
setupCategoryFilterDropdown();

function setupCategoryFilterDropdown() {
    const selectEl = document.getElementById('categoryFilterSelect');
    const applyBtn = document.getElementById('btnApplyCategory');

    if (!selectEl || !applyBtn) {
        return;
    }

    const defaultButtonText = applyBtn.textContent;

    function setReadyState(isReady) {
        selectEl.disabled = !isReady;
        applyBtn.disabled = !isReady;
        applyBtn.textContent = isReady ? defaultButtonText : '필터 준비 중...';
    }

    const refreshCategories = async () => {
        if (!window.globalViewer || !window.globalViewer.model) return;
        
        try {
            setReadyState(false);
            const categories = await getModelCategories(window.globalViewer.model);
            
            selectEl.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '카테고리를 선택하세요';
            selectEl.appendChild(placeholder);

            categories.forEach((category) => {
                const option = document.createElement('option');
                option.value = category;
                option.textContent = category;
                selectEl.appendChild(option);
            });

            setReadyState(true);
        } catch (err) {
            console.error('Failed to load categories:', err);
            setReadyState(true);
        }
    };

    setReadyState(false);

    async function handleApply() {
        const value = selectEl.value;
        if (!value) {
            showEntireModel();
            return;
        }

        const prevText = applyBtn.textContent;
        applyBtn.disabled = true;
        applyBtn.textContent = '필터 적용 중...';
        try {
            const result = await applyCategoryFilter(value, { label: `${value} 카테고리` });
            if (result.ids.length === 0) {
                alert(`'${value}' 카테고리에 해당하는 요소를 찾지 못했습니다.`);
            }
        } catch (err) {
            console.error(err);
            alert(err.message || '카테고리 필터를 적용하지 못했습니다.');
        } finally {
            applyBtn.disabled = false;
            applyBtn.textContent = prevText;
        }
    }

    applyBtn.addEventListener('click', () => {
        handleApply();
    });

    selectEl.addEventListener('change', () => {
        if (selectEl.value) {
            handleApply();
        } else {
            showEntireModel();
        }
    });

    const exportBtn = document.getElementById('btnExportMeta');
    exportBtn?.addEventListener('click', async () => {
        if (exportBtn.disabled) return;
        const prevText = exportBtn.textContent;
        exportBtn.disabled = true;
        exportBtn.textContent = '추출 중...';
        try {
            const count = await window.exportModelMetadataToCSV();
            alert(`${count}개 요소의 메타데이터가 추출되었습니다.\n다운로드된 CSV 파일을 AI 채팅창에 업로드하여 질문하세요.`);
        } catch (err) {
            console.error(err);
            alert('메타데이터 추출 실패');
        } finally {
            exportBtn.disabled = false;
            exportBtn.textContent = prevText;
        }
    });

    window.addEventListener('APS_MODEL_LOADED', refreshCategories);
    // Also try immediately if viewer is ready
    if (window.globalViewer && window.globalViewer.model) {
        refreshCategories();
    }
}

const login = document.getElementById('login');
const openChatBtn = document.getElementById('openChatBtn');

// 초기 상태: 채팅 버튼 숨김
if (openChatBtn) {
    openChatBtn.style.display = 'none';
}

try {
    const resp = await fetch('/api/auth/profile');
    if (resp.ok) {
        const user = await resp.json();
        login.innerText = `Logout (${user.name})`;
        login.onclick = () => {
            const iframe = document.createElement('iframe');
            iframe.style.visibility = 'hidden';
            iframe.src = 'https://accounts.autodesk.com/Authentication/LogOut';
            document.body.appendChild(iframe);
            iframe.onload = () => {
                window.location.replace('/api/auth/logout');
                document.body.removeChild(iframe);
            };
        }
        
        // 로그인 성공 시 채팅 버튼 표시
        if (openChatBtn) {
            openChatBtn.style.display = 'flex';
        }

        const viewer = await initViewer(document.getElementById('preview'));
        initTree('#tree', (id) => loadModel(viewer, window.btoa(id).replace(/=/g, '')));
    } else {
        login.innerText = 'Login';
        login.onclick = () => window.location.replace('/api/auth/login');
    }
    login.style.visibility = 'visible';
} catch (err) {
    alert('Could not initialize the application. See console for more details.');
    console.error(err);
}
