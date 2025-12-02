// Shared keyword lists and default metadata property names for intent detection.
// Contains both Korean and English variants for robustness.

const DEFAULT_METADATA_PROPERTIES = [
  'Category', '카테고리',
  'Family', 'Family Name', '패밀리', '타입 패밀리',
  'Type', 'Type Name', '타입 이름',
  'Level', '레벨', '층', 'Reference Level', '참조 레벨',
  'Height', 'Unconnected Height', '미연결 높이', '미연결 높이(mm)', 'Unconnected Height (mm)', '미연결 높이 (mm)',
  'Width', '너비', '폭', '두께', 'Thickness', 'Overall Width', '명목 너비', 'Nominal Width', '명목 두께', '벽 두께', '벽 폭',
  'Volume', '체적', '부피',
  'Area', '면적'
];

const WALL_KEYWORDS = ['벽체', '벽', 'wall'];
const SHOW_ONLY_KEYWORDS = ['보여', '보여줘', '보기', '표시', 'show', '추출', '확인', '검토'];
const ONLY_KEYWORDS = ['만', 'only'];

const DIMENSION_KEYWORDS = [
  '크기', '치수', 'size', 'dimension',
  '길이', 'length', '높이', 'height',
  '너비', 'width', '폭', '두께', 'thickness',
  '면적', 'area', '체적', '부피', 'volume'
];

const TABLE_KEYWORDS = ['표', '테이블', 'table', 'schedule', '목록', '리스트'];

const QUANTITY_KEYWORDS = [
  '수량', '개수', 'count',
  'volume', '체적', '부피',
  'area', '면적',
  'width', '너비', '폭', '두께', 'thickness',
  '추출', '확인'
];

module.exports = {
  DEFAULT_METADATA_PROPERTIES,
  WALL_KEYWORDS,
  SHOW_ONLY_KEYWORDS,
  ONLY_KEYWORDS,
  DIMENSION_KEYWORDS,
  TABLE_KEYWORDS,
  QUANTITY_KEYWORDS
};
