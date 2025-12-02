// wwwroot/assistant-frontend.js
(function () {
  const $form      = document.getElementById('chatForm');
  const $input     = document.getElementById('userInput');
  const $area      = document.getElementById('chatArea');
  const $fileBtn   = document.getElementById('fileBtn');
  const $fileInput = document.getElementById('fileInput');
  const $dateTxt   = document.getElementById('dateText');
  const $restart   = document.getElementById('restartBtn');
  const $status    = document.getElementById('chatStatus');

  if ($area) {
    $area.classList.add('chat-thread');
    $area.innerHTML = '';
  }

  let currentThreadId = null;
  let isModelDataUploaded = false;

  function setDateNow() {
    if (!$dateTxt) return;
    const now = new Date();
    const fmt = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    $dateTxt.textContent = fmt;
  }
  setDateNow();

  function createBubbleRow(role, text) {
    if (!$area) return null;
    const wrap = document.createElement('div');
    wrap.className = `chat-row ${role}`;

    const avatar = document.createElement('div');
    avatar.className = `chat-avatar ${role === 'assistant' ? 'assistant' : 'user'}`;
    avatar.textContent = role === 'assistant' ? 'AI' : '나';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = text ?? '';

    if (role === 'assistant') {
      wrap.appendChild(avatar);
      wrap.appendChild(bubble);
    } else {
      wrap.appendChild(bubble);
      wrap.appendChild(avatar);
    }

    $area.appendChild(wrap);
    $area.scrollTop = $area.scrollHeight;
    return { wrap, bubble };
  }

  function appendBubble(role, text, { sources } = {}) {
    const created = createBubbleRow(role, text ?? '');
    if (!created) return;

    if (Array.isArray(sources) && sources.length) {
      const list = document.createElement('ul');
      list.className = 'chat-sources';
      sources.forEach((src) => {
        const li = document.createElement('li');
        li.textContent = `異쒖쿂 ${src.filename || src.file_id || '?뚯씪'}${src.quote ? ` ??"${src.quote}"` : ''}`;
        list.appendChild(li);
      });
      created.bubble.appendChild(list);
    }

    $area.scrollTop = $area.scrollHeight;
  }

  let loadingRow = null;
  function showLoading() {
    const created = createBubbleRow('assistant', '');
    if (!created) return;
    const loader = document.createElement('div');
    loader.className = 'chat-loading';
    loader.innerHTML = '<span class="chat-dot"></span><span class="chat-dot"></span><span class="chat-dot"></span>';
    created.bubble.appendChild(loader);
    loadingRow = created.wrap;
  }
  function hideLoading() {
    if (loadingRow?.parentNode) loadingRow.parentNode.removeChild(loadingRow);
    loadingRow = null;
  }

  function setChatBusy(isBusy, text) {
    if (!$status) return;
    $status.textContent = text ? text : (isBusy ? 'AI ?묐떟 ?앹꽦 以?..' : '以鍮??꾨즺');
    $status.dataset.state = isBusy ? 'busy' : 'idle';
  }

  $fileBtn?.addEventListener('click', () => $fileInput?.click());

  $fileInput?.addEventListener('change', () => {
    if ($fileInput.files.length > 0) {
      $fileBtn.style.backgroundColor = '#d1d5db';
      $fileBtn.textContent = '✔';
    } else {
      $fileBtn.style.backgroundColor = '';
      $fileBtn.textContent = '+';
    }
  });

  function containsAny(text, patterns) {
    if (!text) return false;
    return patterns.some((p) => text.includes(p));
  }

  function isWallSummaryIntent(message = '') {
    const text = message || '';
    return /(두께별|두께|체적|집계|표로|벽체\s*두께)/i.test(text);
  }

  // =========================
  // ?섎떒 ?붿빟 ?⑤꼸 ?쒖떆 ?ы띁
  // =========================
  function ensureBottomSummaryPanelVisible() {
    const panel = document.getElementById('bottomSummaryPanel');
    if (panel) {
      panel.classList.remove('hidden');
      panel.style.zIndex = 9999;
    }
  }

  function safeUpdateScheduleTable(table) {
    if (typeof window.updateScheduleTable !== 'function') return false;
    ensureBottomSummaryPanelVisible();
    window.updateScheduleTable(table);
    return true;
  }

    // ✅ 서버 요약 응답에서 "두께별 집계 표"를 최대한 찾아서 렌더링
  function renderWallSummaryTable(summary) {
    if (!summary) return false;

    // 1) 서버가 이미 두께별 요약을 만들어 준 경우 (객체 배열)
    let grouped =
      summary.grouped_summary ||
      summary.groupedSummary ||
      summary.grouped ||
      null;

    if (Array.isArray(grouped) && grouped.length && typeof grouped[0] === 'object') {
      const rows = grouped.map(g => [
        g.thickness_mm ?? g.thickness ?? '미상',
        g.count ?? g.qty ?? 0,
        g.volume_sum_m3 ?? g.volume ?? g.volume_m3 ?? 0
      ]);

      return safeUpdateScheduleTable({
        title: '벽체 두께별 집계',
        description: '서버 집계 JSON 기반 표',
        columns: ['Thickness (mm)', 'Count', 'Volume (m3)'],
        rows
      });
    }

    // 2) 예전처럼 서버가 "벽체 목록"만 주고, 두께별 집계는 없는 경우
    //    → grouped_action.rows 를 기반으로 프런트에서 직접 두께별/체적 합계를 계산
    const ga = summary.grouped_action;
    if (!ga || !Array.isArray(ga.rows) || !ga.rows.length) {
      console.warn('[summary] No grouped_summary or grouped_action.rows in summary', summary);
      return false;
    }

    const cols = ga.columns || summary.columns || [];
    const thicknessIdx = cols.findIndex(
      c => /thick/i.test(c) || /두께/.test(c) || /width/i.test(c)
    );
    const volumeIdx = cols.findIndex(
      c => /volume/i.test(c) || /체적/.test(c) || /부피/.test(c)
    );

    if (thicknessIdx < 0 || volumeIdx < 0) {
      console.warn('[summary] Cannot find thickness/volume columns', cols);
      return false;
    }

    // rows = [ [ID, Level, Width, Thickness, Height, Volume], ... ] 형태라고 가정
    const agg = new Map();
    for (const row of ga.rows) {
      if (!Array.isArray(row)) continue;
      const tRaw = Number(row[thicknessIdx]);
      const vRaw = Number(row[volumeIdx]);
      if (!Number.isFinite(tRaw)) continue;

      const tKey = Math.round(tRaw);         // 두께(mm) 정수 기준으로 그룹핑
      const vVal = Number.isFinite(vRaw) ? vRaw : 0;

      if (!agg.has(tKey)) {
        agg.set(tKey, { t: tKey, count: 0, vol: 0 });
      }
      const entry = agg.get(tKey);
      entry.count += 1;
      entry.vol += vVal;
    }

    const tableRows = Array.from(agg.values())
      .sort((a, b) => a.t - b.t)
      .map(e => [e.t, e.count, Number(e.vol.toFixed(3))]);

    const table = {
      title: '벽체 두께별 집계',
      description: '벽체 메타데이터를 기반으로 프런트에서 직접 집계한 결과',
      columns: ['Thickness (mm)', 'Count', 'Volume (m3)'],
      rows: tableRows
    };

    console.log('[summary] render table from grouped_action (local agg)', table);
    return safeUpdateScheduleTable(table);
  }

  // =========================
  // 벽체 요약 요청
  // =========================
  // ✅ /api/walls/summary 호출: 오직 __LAST_WALL_ROWS만 사용
  async function fetchWallSummaryFromServer() {
    const wallRows = Array.isArray(window.__LAST_WALL_ROWS) ? window.__LAST_WALL_ROWS : null;
    if (!wallRows || !wallRows.length) {
      throw new Error('벽체 목록 데이터(window.__LAST_WALL_ROWS)가 아직 준비되지 않았습니다.');
    }

    console.log('[summary] calling /api/walls/summary with', wallRows.length, 'rows');

    const res = await fetch('/api/walls/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: wallRows })
    });

    if (!res.ok) {
      throw new Error(`summary API failed: HTTP ${res.status}`);
    }

    const data = await res.json();
    console.log('[summary] server response', data);

    window.__DEBUG_LAST_SUMMARY = data;
    return data;
  }
async function runResetAction() {
    if (typeof window.showEntireModel === 'function') {
      window.showEntireModel();
    } else if (typeof window.resetModel === 'function') {
      window.resetModel();
    } else {
      throw new Error('酉곗뼱媛 ?꾩쭅 以鍮꾨릺吏 ?딆븯?듬땲??');
    }
    appendBubble('assistant', '紐⑤뜽 ?꾩껜 蹂닿린 ?곹깭濡??꾪솚?덉뒿?덈떎.');
    setDateNow();
  }

  async function tryHandleLocalCommand(rawMessage) {
    const normalized = (rawMessage || '').toLowerCase();
    const isResetCommand =
      (containsAny(normalized, ['?꾩껜', '珥덇린', 'reset', 'show all']) &&
       containsAny(normalized, ['蹂댁뿬', 'show', 'display', '蹂닿린', '?뚮젮']));

    if (isResetCommand) {
      try {
        await runResetAction();
      } catch (err) {
        appendBubble('assistant', err?.message || '紐⑤뜽??珥덇린?뷀븯吏 紐삵뻽?듬땲??');
        console.error('Reset command failed', err);
      }
      return true;
    }

    return false;
  }

  // 紐⑤뜽?먯꽌 吏곸젒 吏묎퀎?섎뒗 蹂댁“ 濡쒖쭅 (諛깆뾽??
  async function tryGenerateWallThicknessTable() {
    if (typeof window.computeWallThicknessVolumeTable !== 'function') return false;
    try {
      const table = await window.computeWallThicknessVolumeTable();
      if (table && Array.isArray(table.rows) && table.rows.length) {
        safeUpdateScheduleTable(table);
        appendBubble('assistant', '(?먮룞) 紐⑤뜽 湲곕컲 踰쎌껜 ?먭퍡/泥댁쟻 ?쒕? ?앹꽦?덉뒿?덈떎.');
        return true;
      }
      appendBubble('assistant', '(?먮룞) 紐⑤뜽?먯꽌 踰쎌껜 ?먭퍡 ?곗씠?곕? 李얠? 紐삵뻽?듬땲??');
      return false;
    } catch (err) {
      console.error('Failed to compute wall thickness table', err);
      appendBubble('assistant', '(?먮룞) ???앹꽦 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.');
      return false;
    }
  }

  function shouldAutoGenerateWallTable(userMessage, assistantReply, action) {
    if (!userMessage) return false;
    const safeReply = (assistantReply || '').trim();
    if (action && action.action === 'render_table') return false;
    if (safeReply && safeReply !== '답변을 준비하지 못했습니다.') return false;

    const text = userMessage.toLowerCase();
    const hasWall = /(벽|wall)/i.test(text);
    const hasThickness = /(두께|thick|width)/i.test(text);
    const hasVolume = /(체적|부피|volume)/i.test(text);
    const hasTable = /(표|table|schedule)/i.test(text);
    return hasWall && hasThickness && hasVolume && hasTable;
  }

  window.tryGenerateWallThicknessTable = tryGenerateWallThicknessTable;
  window.shouldAutoGenerateWallTable = shouldAutoGenerateWallTable;

  window.addEventListener('APS_MODEL_LOADED', () => {
    isModelDataUploaded = false;
    console.log('New model loaded, resetting AI data context.');
  });

  // =========================
  // ??submit 泥섎━
  // =========================
  $form?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const message = ($input?.value || '').trim();
    const file = $fileInput?.files?.[0];
    const originalUserMessage = message;

    if (!message && !file) return;

    let userDisplay = message;
    if (file) {
      userDisplay = (userDisplay ? userDisplay + '\n' : '') + `[?뚯씪 泥⑤?: ${file.name}]`;
    }
    appendBubble('user', userDisplay);

    if ($input) $input.value = '';
    if ($fileInput) {
      $fileInput.value = '';
      $fileBtn.style.backgroundColor = '';
      $fileBtn.textContent = '+';
    }

    if (!file && await tryHandleLocalCommand(message)) {
      return;
    }

    showLoading();
    setChatBusy(true, 'AI ?묐떟 ?앹꽦 以?..');

    try {
      const wantsWallSummary = isWallSummaryIntent(message);
      let wallSummary = null;
      let skipAutoUpload = false;

      // ???ъ슜?먭? "?먭퍡/泥댁쟻 ??瑜??붿껌?덉쓣 ?뚮쭔 ?쒕쾭 吏묎퀎 諛??섎떒 ???뚮뜑
      if (wantsWallSummary) {
        try {
          wallSummary = await fetchWallSummaryFromServer();
          skipAutoUpload = true;

          const rendered = renderWallSummaryTable(wallSummary);
          if (rendered) {
            appendBubble('assistant', '(?먮룞) ?쒕쾭 ?먭퍡/泥댁쟻 吏묎퀎 ?곗씠?곕? ?붾㈃ ?섎떒???쒕줈 ?쒖떆?덉뒿?덈떎.');
          } else {
            appendBubble('assistant', '(?먮룞) ?쒕쾭 吏묎퀎???깃났?덉?留????곗씠?곌? 鍮꾩뼱?덉뒿?덈떎.');
          }
        } catch (err) {
          console.warn('Failed to fetch wall summary', err);
          appendBubble('assistant', '(?먮룞) 踰쎌껜 吏묎퀎 ?곗씠?곕? 遺덈윭?ㅼ? 紐삵뻽?듬땲?? ?쇰컲 吏덈Ц?쇰줈 泥섎━?⑸땲??');
        }
      }

      const formData = new FormData();
      const summaryNote = wallSummary
        ? `?꾨옒 JSON? 紐⑤뜽/?쒕쾭媛 怨꾩궛??踰쎌껜 ?먭퍡蹂?泥댁쟻 吏묎퀎 寃곌낵??
?덈뒗 怨꾩궛?섏? 留먭퀬 ?쒕줈留??뺣━?댁쨾.

[JSON]
${JSON.stringify(wallSummary, null, 2)}

[異쒕젰 ?뺤떇]
| 踰쎌껜 ?먭퍡 (mm) | 踰쎌껜 媛쒖닔 | 泥댁쟻 ?⑷퀎 (m쨀) |
|---:|---:|---:|
?먭퍡 ?ㅻ쫫李⑥닚?쇰줈 ?쒕쭔 異쒕젰.`
        : '';

      formData.append('message', summaryNote || message);
      if (currentThreadId) {
        formData.append('thread_id', currentThreadId);
      }

      if (file) {
        formData.append('file', file);
      } else if (!skipAutoUpload && !isModelDataUploaded && typeof window.getModelMetadataCSV === 'function') {
        try {
          const csvContent = await window.getModelMetadataCSV();
          const blob = new Blob([csvContent], { type: 'text/csv' });
          const autoFile = new File([blob], 'current_model_data.csv', { type: 'text/csv' });
          formData.append('file', autoFile);
          isModelDataUploaded = true;
          console.log('Auto-uploaded model metadata CSV.');
        } catch (err) {
          console.warn('Failed to auto-extract model data:', err);
        }
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        body: formData
      });

      hideLoading();
      setChatBusy(false);

      if (!res.ok) {
        let errMsg = `?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎. (HTTP ${res.status})`;
        try {
          const payload = await res.json();
          if (payload?.detail) errMsg += `\n${payload.detail}`;
          else if (payload?.error) errMsg += `\n${payload.error}`;
        } catch (parseErr) {
          console.warn('Failed to parse error payload', parseErr);
        }
        appendBubble('assistant', errMsg);
        return;
      }

      const data = await res.json();
      currentThreadId = data.thread_id || currentThreadId;

      appendBubble('assistant', data.reply ?? data.content ?? '?듬???以鍮꾪븯吏 紐삵뻽?듬땲??', {
        sources: data.sources
      });

      // --- AI action 泥섎━遺 ---
      if (data.action && data.action.action === 'filter') {
        try {
          const result = await window.applyAiFilter(data.action);
          if (result && result.ids && result.ids.length === 0) {
            appendBubble('assistant', `(?먮룞) '${data.action.category || '?붿껌 議곌굔'}'???대떦?섎뒗 媛앹껜媛 紐⑤뜽???놁뒿?덈떎.`);
          }
        } catch (err) {
          console.error(err);
          appendBubble('assistant', '(?먮룞) 酉곗뼱 ?꾪꽣 ?곸슜 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.');
        }
      } else if (data.action && data.action.action === 'calculate_wall_stats') {
        // 諛깆뿏?쒓? 蹂꾨룄 怨꾩궛 ?≪뀡??蹂대깉???? ?곗꽑 ?쒕쾭 ?붿빟 ?쒕? ?꾩슦怨? ???섎㈃ 濡쒖뺄 吏묎퀎 ?쒕룄
        if (!renderWallSummaryTable(wallSummary)) {
          await tryGenerateWallThicknessTable();
        }
      } else if (data.action && data.action.action === 'render_table') {
        if (typeof data.action.rows !== 'undefined') {
          safeUpdateScheduleTable({
            title: data.action.title,
            description: data.action.description,
            columns: data.action.columns,
            rows: data.action.rows
          });
        }
      } else if (data.action && data.action.action === 'reset') {
        try {
          window.showEntireModel();
          appendBubble('assistant', '(?먮룞) 紐⑤뜽??珥덇린?뷀뻽?듬땲??');
        } catch (err) {
          console.error(err);
        }
      }

      // ?먮룞 ?앹꽦? "???붿껌 臾몄옣"?닿퀬, GPT ?듬???鍮꾩뼱 ?덉쓣 ?뚮쭔
      if (shouldAutoGenerateWallTable(originalUserMessage, data.reply, data.action)) {
        await tryGenerateWallThicknessTable();
      }

      setDateNow();
    } catch (err) {
      hideLoading();
      setChatBusy(false);
      appendBubble('assistant', '?ㅽ듃?뚰겕 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.');
      console.error(err);
    }
  });

  $restart?.addEventListener('click', () => {
    if ($area) {
      $area.innerHTML = '';
      appendBubble('assistant', '??梨꾪똿???쒖옉?섏꽭??');
    }
    currentThreadId = null;
    setDateNow();
  });

  $input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $form?.requestSubmit?.();
    }
  });

  // ??珥덇린 硫섑듃
  if ($area && !$area.childElementCount) {
    appendBubble('assistant', 'Kunhwa AI 파트너입니다. 물어보세요');
  }

  })();




