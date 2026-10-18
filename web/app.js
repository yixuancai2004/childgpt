/* Browser UI. Works as a static GitHub Pages project, as a standalone file, or with server.mjs. */
(function () {
  'use strict';
  const C = window.ChildGPT, $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const storage = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { toast('Browser storage is unavailable; the demo remains in memory.'); } }, remove(k) { try { localStorage.removeItem(k); } catch {} } };
  let remember = storage.get('childgpt.remember') === 'yes';
  let engine;
  try { engine = new C.Engine(remember ? JSON.parse(storage.get('childgpt.state') || 'null') : null); } catch { engine = new C.Engine(); }
  let mode = 'chat', busy = false, demoRunning = false, remote = null, functional = null, simulation = null, monte = null, sweep = null, providerTrace = null, toastTimer;
  let initializing = true, normalSession = null, activeDemo = null, stopDemo = false, connectionFailure = '';
  const demoNames = { conversation: '一起开一家小咖啡馆', learning: '教 Milo 学会月铃礼' };
  const demoSteps = {
    conversation: [
      { label: '打个招呼', input: { mode: 'chat', text: 'Hi, Milo.' } },
      { label: '接住日常聊天', input: { mode: 'chat', text: 'I can tell you how to cook' } },
      { label: '一起玩想象游戏', input: { mode: 'chat', text: "Let's pretend we are opening a tiny café. You choose its name." } }
    ],
    learning: [
      { label: '第一次听说', input: { mode: 'chat', text: '月铃礼是什么？' } },
      { label: '用自然语言教他', input: { mode: 'chat', text: '月铃礼就是先系蓝绳；再敲三下铜铃。' } },
      { label: '受控漏记（演示按钮指定，非随机）', input: { mode: 'recall', concept: '月铃礼', forceError: true } },
      { label: '自然语言纠正', input: { mode: 'chat', text: '不对，月铃礼应该是先系红绳；再敲三下铜铃。' } },
      { label: '再次回忆（按当前掌握度抽样）', input: { mode: 'chat', text: '月铃礼是什么？' } }
    ]
  };
  const names = { studio: 'Learning studio', algorithms: 'Algorithm trace', evaluation: 'Evaluation lab', settings: 'Connect & privacy' };
  const pct = (value, places = 0) => value == null ? '—' : `${(value * 100).toFixed(places)}%`;
  function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500); }
  function download(name, content, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const jsonDownload = (name, data) => download(name, JSON.stringify(data, null, 2));
  function persist() { if (!remote && !activeDemo && remember) storage.set('childgpt.state', JSON.stringify(engine.export())); }
  function navigate(page) {
    if (!names[page]) page = 'studio';
    document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === `page-${page}`));
    document.querySelectorAll('.nav-link').forEach(el => el.classList.toggle('active', el.dataset.page === page));
    $('page-label').textContent = names[page]; document.title = `ChildGPT · ${names[page]}`;
    if (location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
    if (page === 'algorithms') renderAlgorithms();
  }
  function setBusy(value) {
    busy = value;
    const locked = value || demoRunning || initializing;
    for (const id of ['send-button', 'next-question', 'profile-select', 'delete-profile', 'invite-button', 'metadata-toggle', 'invitation-toggle', 'text-input', 'retry-reply']) $(id).disabled = locked || Boolean(activeDemo);
    for (const id of ['guided-demo', 'conversation-demo', 'disconnect']) $(id).disabled = locked;
    document.querySelectorAll('[data-recording], #connect-form button, [data-memory]').forEach(el => { el.disabled = locked || (Boolean(activeDemo) && el.hasAttribute('data-memory')); });
    $('demo-return').disabled = value || demoRunning;
    $('demo-export').disabled = value || demoRunning || !activeDemo;
    $('send-button').textContent = value ? 'Thinking…' : ({ teach: 'Teach Milo ↗', correct: 'Update memory ↗', ask: 'Ask Milo ↗', recall: 'Recall together ↗', chat: 'Send message ↗' }[mode]);
  }
  function selectMode(next) {
    mode = next;
    document.querySelectorAll('[data-action]').forEach(el => el.classList.toggle('selected', el.dataset.action === mode));
    $('structured-fields').hidden = mode === 'chat'; $('free-text-field').hidden = mode !== 'chat';
    $('content-field').hidden = !['teach', 'correct'].includes(mode);
    $('composer-note').textContent = activeDemo ? '这是独立演示。点击“回到我的聊天”继续你自己的对话。' : mode !== 'chat' ? 'Advanced controls select an action explicitly. Close this panel to return to chat.' : remote?.apiEnabled ? 'We can just chat, share a story, or play. You don’t have to teach me something every time.' : '本地模式 · 当前是简单规则回复，还没有使用语言模型。';
    setBusy(busy);
  }
  async function request(route, method = 'GET', data, connection = remote) {
    const headers = { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(connection?.token ? { Authorization: `Bearer ${connection.token}` } : {}) };
    const res = await fetch(`${connection?.base || ''}${route}`, { method, headers, ...(data ? { body: JSON.stringify(data) } : {}), credentials: 'omit', signal: AbortSignal.timeout(45000) });
    let value; try { value = await res.json(); } catch { throw new Error('Backend returned a non-JSON response. Check the backend URL.'); }
    if (!res.ok) { const error = new Error(value.error || `Backend HTTP ${res.status}`); error.status = res.status; throw error; }
    return value;
  }
  async function perform(input, internal = false) {
    if (busy || initializing || (activeDemo && !internal)) return;
    setBusy(true);
    try {
      let result;
      if (remote) { result = await request('/api/turn', 'POST', { input, profile: engine.state.activeProfile }); engine = new C.Engine(result.state); providerTrace = result.provider || null; }
      else { result = engine.transact(input); providerTrace = null; }
      persist(); render();
      if (result.skipped && result.message) toast(result.message);
      if (result.provider?.wording?.includes('fallback')) toast(`本次回复未由模型生成：${failureLabel(result.provider.error)}。可重试这条回复。`);
      return result;
    } catch (e) { toast(e.message || 'Unable to complete this action.'); }
    finally { setBusy(false); }
  }
  function failureLabel(error) { return ({ 'rate-limited': '服务限流', 'credentials-rejected': '密钥被拒绝', timeout: '请求超时', 'invalid-output': '模型输出未通过检查', unavailable: '服务暂不可用' })[error?.code] || (error?.code ? '模型请求失败' : '未连接模型'); }
  function generationLabel(message) {
    const g = message.generation;
    if (g?.source === 'llm') return `${g.service} · ${g.model} · 模型生成`;
    if (g?.source === 'fallback') return `本地规则回复 · ${failureLabel(g.error)}`;
    return remote || activeDemo?.recorded ? '历史回复 · 来源未记录' : '本地规则回复 · 未连接模型';
  }
  function render() {
    const p = engine.profile(), clock = activeDemo?.recorded ? Date.parse(p.history.at(-1)?.at || activeDemo.createdAt) : Date.now(), growth = C.developmentStatus(p);
    document.body.classList.toggle('viewing-demo', Boolean(activeDemo));
    $('growth-stage').textContent = growth.label;
    $('growth-progress').textContent = growth.next ? `${growth.known}/${growth.next.known} concepts · ${growth.reinforced}/${growth.next.reinforced} reinforced · ${growth.lessons}/${growth.next.lessons} lessons → ${growth.next.label}` : `${growth.known} concepts · ${growth.lessons} lessons together`;
    const learned = p.memories.filter(m => m.content);
    $('profile-select').value = p.id; $('memory-count').textContent = learned.length; $('memory-pill').textContent = `${p.memories.length} item${p.memories.length === 1 ? '' : 's'}`;
    $('mastery-value').textContent = learned.length ? pct(C.mean(learned.map(m => C.retention(m, clock).effectiveMastery))) : '—';
    $('mode-badge').textContent = initializing ? '◌ CONNECTING' : activeDemo?.recorded ? '◷ 实测回放' : remote ? (remote.apiEnabled ? `● ${remote.service || 'LLM'} · ${remote.model || 'CONNECTED API'}` : '● SERVER DEMO · NO API') : '● KEY-FREE DEMO';
    $('live-dot').classList.toggle('offline', !remote?.apiEnabled || Boolean(activeDemo?.recorded));
    $('chat-subtitle').textContent = activeDemo?.recorded ? '已保存的实测对话 · 不是本次实时生成' : remote?.apiEnabled ? 'Curious, and ready to talk with you.' : 'Local mode · simple rule-based replies';
    const notice = $('connection-notice');
    notice.textContent = initializing ? '正在连接本地模型服务…' : activeDemo?.recorded ? `实测记录 · ${new Date(activeDemo.createdAt).toLocaleString()} · 点击“现场演示”可重新调用模型。` : remote?.apiEnabled ? `已连接 ${remote.service || 'LLM'} / ${remote.model}。每条回复下方显示实际生成来源。演示使用独立记忆，不影响你的聊天。` : connectionFailure || '当前没有连接 LLM。这里的聊天是本地规则回复；现场演示需要连接模型。';
    notice.classList.toggle('warning', !initializing && !remote?.apiEnabled && !activeDemo?.recorded);
    $('demo-panel').hidden = !activeDemo;
    if (activeDemo) { $('demo-title').textContent = demoNames[activeDemo.kind]; $('demo-status').textContent = activeDemo.status; }
    $('demo-stop').hidden = !demoRunning;
    $('retry-reply').hidden = !remote?.apiEnabled || p.history.at(-1)?.generation?.source !== 'fallback' || Boolean(activeDemo);
    selectMode(mode);
    $('remember-toggle').checked = remember; $('metadata-toggle').checked = p.metadataEnabled; $('invitation-toggle').checked = p.invitationsEnabled;
    $('invitation-bar').hidden = !p.pendingInvitation;
    const history = $('chat-history');
    if (!p.history.length) history.innerHTML = '<div class="welcome"><div class="welcome-avatar">✳</div><h3>Hi, I’m Milo.</h3><p>We can talk about your day, make up a game, or just say hello.</p><div class="example">Start anywhere:<br><strong>“嗨，Milo，今天想玩什么？”</strong></div></div>';
    else history.innerHTML = p.history.map(m => `<div class="message ${m.role === 'user' ? 'user' : 'assistant'}"><span class="message-label">${m.role === 'user' ? escape(p.label) + ' · you' : 'Milo · AI learner'}</span><div class="bubble">${escape(m.text)}</div>${m.role === 'assistant' ? `<span class="reply-source ${m.generation?.source === 'llm' ? 'generated' : 'fallback'}">${escape(generationLabel(m))}</span>` : ''}${m.action ? `<span class="action-tag">${escape(m.action.replaceAll('_', ' '))}</span>` : ''}</div>`).join('');
    history.scrollTop = history.scrollHeight;
    $('memory-list').innerHTML = p.memories.length ? p.memories.slice(-6).map(m => {
      const index = p.memories.indexOf(m), retention = C.retention(m, clock), mastery = retention.effectiveMastery;
      return `<div class="memory-item"><div class="memory-title"><span>${escape(m.concept)}</span><small>${pct(mastery)} current mastery</small></div><p>${escape(m.content || m.pendingContent)}</p><div class="progress-track" aria-label="Current mastery ${pct(mastery)}"><div class="progress-fill" style="width:${Math.round(mastery * 100)}%"></div></div><div class="memory-provenance">${escape(m.topic)} · ${escape(m.sourceInteraction)}<br>${m.learningCount || 0} lessons · ${m.correctionHistory.length} corrections · ${m.related.length} related concepts${m.pendingContent ? '<br>⚠ Pending explanation awaits clarification' : ''}</div><div class="memory-actions"><button class="text-button" data-memory="${index}" data-memory-action="recall">Recall</button><button class="text-button" data-memory="${index}" data-memory-action="error">Scripted omission</button><button class="text-button" data-memory="${index}" data-memory-action="confirm">Confirm</button></div></div>`;
    }).join('') + (p.memories.length > 6 ? '<p class="subtle">Showing the latest 6 memories. Export the profile for the full store.</p>' : '') : '<div class="empty-memory"><span>▤</span><p>A blank page, for now.<br>The first lesson begins with you.</p></div>';
    $('trace-summary').innerHTML = p.lastTrace ? `<span class="trace-action">${escape(p.lastTrace.action)}</span><br>${escape(p.lastTrace.reason)}<br><small>${p.lastTrace.allowedKnowledge.length} permitted fact · ${escape(p.lastTrace.realization)}</small>` : 'Teach a concept to inspect the memory and action that guide the next reply.';
    renderAlgorithms();
    setBusy(busy);
  }
  function renderAlgorithms() {
    const p = engine.profile(), t = p.lastTrace;
    const pairs = t ? [['Interpreted intent', t.inputMode], ['Action', t.action], ['Concept', t.concept], ['Knowledge boundary', t.knowledgeBoundary], ['Allowed fact', t.allowedKnowledge.join('\n') || 'None — ask to learn'], ['Source interaction', t.sourceInteraction || 'None'], ['Memory item', t.memoryId || 'None'], ['Mastery', `${t.masteryBefore ?? 'not stored'} → ${t.masteryAfter ?? 'not stored'}`], ['Learning stage', t.development ? `${t.development.label} · ${t.development.lessons} lessons` : 'Legacy trace'], ['Retention', t.retention ? `Strength ${t.retention.strength} · ${t.retention.elapsedDays} days since reinforcement · half-life ${t.retention.stabilityDays.toFixed(2)} days` : 'No selected memory'], ['Decision rule', t.reason], ['Recall decision', t.recall ? `${t.recall.band} mastery · draw ${t.recall.draw} → ${t.recall.outcome}` : 'Teaching, clarification or exploration'], ['Controlled error', t.corruption ? `${t.corruption.operator}: ${t.corruption.detail}` : 'None'], ['Realization', t.realization], ['Provider status', providerTrace ? JSON.stringify(providerTrace) : 'No provider request'], ['Ranked candidates', t.candidates.map(c => `${c.concept}: ${c.score}`).join('; ') || 'No candidates']] : [];
    $('live-trace').innerHTML = t ? `<dl class="trace-table">${pairs.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl>` : '<div class="trace-empty">Interact in the Learning studio to inspect a real decision.</div>';
    $('topic-graph').innerHTML = p.memories.length ? C.TOPICS.map(topic => { const rows = p.memories.filter(m => m.topic === topic); return rows.length ? `<div class="graph-group"><strong>${escape(topic)}</strong><p>${rows.map(m => escape(m.concept)).join(' ↔ ')}</p><small>${rows.length} nodes · ${rows.reduce((a, m) => a + m.related.length, 0) / 2} keyword edges</small></div>` : ''; }).join('') + (p.memories.some(m => m.mentions?.length) ? `<div class="graph-group"><strong>Curiosity queue</strong><p>${[...new Set(p.memories.flatMap(m => m.mentions || []))].map(escape).join(' · ')}</p><small>Quoted terms mentioned while teaching</small></div>` : '') : '<div class="trace-empty">Topic links appear after you teach two related concepts.</div>';
    const metadata = C.summarizeMetadata(p.metadata);
    $('metadata-summary').innerHTML = `<dl class="trace-table">${[['Response rate', pct(metadata.responseRate)], ['Mean response delay', metadata.meanResponseDelayMs == null ? 'No prompted response yet' : `${(metadata.meanResponseDelayMs / 1000).toFixed(1)} s`], ['Mean reply length', metadata.meanExplanationCharacters == null ? '—' : `${metadata.meanExplanationCharacters} characters`], ['Corrections', metadata.corrections], ['Self-started turns', metadata.selfInitiated], ['Invitations', metadata.invitations], ['Recording', p.metadataEnabled ? 'Enabled' : 'Disabled']].map(([k,v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl>`;
  }
  function chartSVG(result, field) {
    const rows = result.rows, width = 560, height = 250, left = 42, right = 16, top = 20, bottom = 34;
    const plotW = width - left - right, plotH = height - top - bottom;
    const values = rows.map(r => r[field]).filter(v => Number.isFinite(v));
    let low = field === 'cusum' ? 0 : Math.min(-2, Math.floor(Math.min(...values))), high = Math.max(field === 'cusum' ? result.settings.h * 1.35 : 3, Math.max(...values) * 1.12);
    if (high <= low) high = low + 1;
    const x = day => left + (day - 1) / (rows.length - 1) * plotW, y = value => top + (high - value) / (high - low) * plotH;
    const fmt = value => Number(value.toFixed(1));
    let markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Synthetic ${field === 'cusum' ? 'CUSUM' : 'standardized change score'} over 60 days"><title>ChildGPT synthetic ${field}; no participant or clinical data</title><rect width="${width}" height="${height}" fill="#fdfefb"/><rect x="${left}" y="${top}" width="${x(result.settings.baselineDays) - left}" height="${plotH}" fill="#f0f3e9"/>`;
    for (let i = 0; i <= 4; i++) { const value = low + (high - low) * i / 4, yy = y(value); markup += `<path d="M${left} ${yy}H${width-right}" stroke="#e8edde" stroke-width="1"/><text x="${left-8}" y="${yy+3}" text-anchor="end" fill="#92a184" font-size="9" font-family="Arial,sans-serif">${fmt(value)}</text>`; }
    for (const day of [1,15,30,45,60]) markup += `<text x="${x(day)}" y="${height-13}" text-anchor="middle" fill="#92a184" font-size="9" font-family="Arial,sans-serif">${day}</text>`;
    markup += `<text x="${width-15}" y="${height-1}" text-anchor="end" fill="#a6b197" font-size="8" font-family="Arial,sans-serif">day</text><text x="${left+7}" y="${top+12}" fill="#a3af96" font-size="8" font-family="Arial,sans-serif">baseline</text>`;
    if (result.changeDay) markup += `<path d="M${x(result.changeDay)} ${top}V${height-bottom}" stroke="#cba885" stroke-dasharray="4 4"/><text x="${x(result.changeDay)+5}" y="${top+12}" fill="#c09c7a" font-size="8" font-family="Arial,sans-serif">change</text>`;
    if (field === 'cusum') markup += `<path d="M${left} ${y(result.settings.h)}H${width-right}" stroke="#a192b9" stroke-dasharray="4 4"/><text x="${width-right-2}" y="${y(result.settings.h)-5}" text-anchor="end" fill="#9d8aaf" font-size="8" font-family="Arial,sans-serif">h = ${result.settings.h}</text>`;
    let drawing = '', open = false;
    for (const row of rows) { if (!Number.isFinite(row[field])) { open = false; continue; } drawing += `${open ? 'L' : 'M'}${x(row.day).toFixed(2)} ${y(row[field]).toFixed(2)} `; open = true; }
    markup += `<path d="${drawing}" fill="none" stroke="${field === 'cusum' ? '#5d8060' : '#93ac81'}" stroke-width="2" stroke-linejoin="round"/>`;
    if (result.firstAlarmDay) { const row = rows.find(r => r.day === result.firstAlarmDay); markup += `<circle cx="${x(row.day)}" cy="${y(row[field])}" r="4" fill="#b27d66" stroke="#fff" stroke-width="1.5"/>`; }
    return markup + '</svg>';
  }
  const metric = (value, label, note = '') => `<div><strong>${escape(value)}</strong><span>${escape(label)}</span>${note ? `<small>${escape(note)}</small>` : ''}</div>`;
  function runSimulation() {
    try {
      const options = { seed: Number($('seed-input').value), scenario: $('scenario-select').value, days: 60, changeDay: 31, shift: 1.2 };
      simulation = { ...C.detect(C.simulate(options), { k: Number($('k-input').value), h: Number($('h-input').value), baselineDays: 20 }), generation: options };
      $('simulation-metrics').innerHTML = metric(simulation.changeDay ? `Day ${simulation.changeDay}` : 'None', 'Injected change') + metric(simulation.firstAlarmDay ? `Day ${simulation.firstAlarmDay}` : 'No signal', 'First detected change') + metric(simulation.detectionDelay == null ? '—' : `${simulation.detectionDelay} days`, 'Detection delay', simulation.preChangeFalseAlarm ? 'First signal was a false alarm' : 'Conditional on a post-change signal') + metric(simulation.preChangeFalseAlarm ? 'Yes' : 'No', 'Pre-change / stable false alarm', 'This single synthetic sequence');
      $('score-chart').innerHTML = chartSVG(simulation, 'z'); $('cusum-chart').innerHTML = chartSVG(simulation, 'cusum');
    } catch (e) { toast(e.message); }
  }
  function runFunctional() {
    functional = C.functionalEvaluation();
    $('functional-results').className = '';
    $('functional-results').innerHTML = `<div class="functional-grid">${functional.groups.map(g => `<div class="check-result ${g.passed < g.total ? 'fail' : ''}"><strong>${g.passed} / ${g.total}</strong><span>${escape(g.group)}</span><small>Measured deterministic checks</small></div>`).join('')}</div><p class="subtle" style="margin-top:16px">${functional.passed}/${functional.total} passed. ${escape(functional.limitation)}</p><details><summary>Inspect every test case</summary>${functional.tests.map(t => `<div class="test-detail"><b>${t.pass ? 'PASS' : 'FAIL'}</b>${escape(t.name)} — ${escape(t.detail)}</div>`).join('')}</details>`;
    toast(`${functional.passed}/${functional.total} controller checks passed. No live LLM was tested.`);
  }
  function runMonte() {
    try {
      monte = C.monteCarlo({ runs: 200, seed: 1000, shift: 1.2, k: Number($('k-input').value), h: Number($('h-input').value), baselineDays: 20 });
      const hs = [...new Set([3, 4, 5, 6, 8, 10, monte.h])].sort((a, b) => a - b); sweep = C.sensitivity({ hs, k: monte.k });
      $('monte-results').className = '';
      $('monte-results').innerHTML = `<div class="small-metrics">${metric(pct(monte.stableSequenceFalseAlarmRate,1), 'Stable-sequence false alarms', `${monte.stableFalseAlarmCount} / 200 sequences`)}${metric(pct(monte.detectedAfterChangeRate,1), 'Post-change first detections', `${monte.detectedAfterChangeCount} / 200 changed sequences`)}${metric(monte.meanDetectionDelay == null ? '—' : `${monte.meanDetectionDelay} days`, 'Mean detection delay', 'Detected-after-change subset only')}${metric(monte.noAlarmCount, 'Changed sequences with no alarm', `${monte.changedPreAlarmCount} additional pre-change alarms`)}${metric(pct(monte.temporaryAlarmRate,1), 'Alarms after a 3-day dip', `${monte.temporaryAlarmCount} / 200 · a known limitation`)}</div><h3 style="margin-top:18px">Threshold trade-off (k=${monte.k})</h3><div class="sweep-wrap"><table class="sweep"><thead><tr><th>h</th><th>Stable false alarms</th><th>Detected after change</th><th>3-day-dip alarms</th><th>Mean delay</th></tr></thead><tbody>${sweep.map(r => `<tr${r.h === monte.h ? ' class="current"' : ''}><td>${r.h}</td><td>${pct(r.stableFalseAlarmRate,1)}</td><td>${pct(r.detectedAfterChangeRate,1)}</td><td>${pct(r.temporaryAlarmRate,1)}</td><td>${r.meanDetectionDelay ?? '—'} d</td></tr>`).join('')}</tbody></table></div><p class="subtle">${escape(monte.temporaryDefinition)} The sweep shows the trade-off; picking the best h from these same seeds would be tuning on the test set.</p><p class="subtle">${escape(monte.falseAlarmDefinition)} ${escape(monte.delayDefinition)} Thresholds are illustrative; the synthetic generator is not a calibrated model of older-adult behaviour. Seed 1000, k=${monte.k}, h=${monte.h}.</p>`;
      toast('600 synthetic sequences and the threshold sweep completed. Counts include false alarms and missed detections.');
    } catch (e) { toast(e.message); }
  }
  function exportEvaluation() {
    jsonDownload('childgpt-evaluation.json', { project: 'ChildGPT GP8001 Group 6', version: C.VERSION, exportedAt: new Date().toISOString(), evidenceType: 'Actual deterministic controller execution and synthetic simulations; no participants; no live provider evaluation', functional, simulation, monteCarlo: monte, thresholdSweep: sweep });
  }
  function exportCSV() {
    if (!simulation) return toast('Run a simulation first.');
    const keys = ['day','invitations','responses','responseRate','responseDelayMinutes','explanationCharacters','corrections','selfInitiated','changed','z','cusum','calibration','alarm'];
    download('childgpt-synthetic-trace.csv', keys.join(',') + '\n' + simulation.rows.map(row => keys.map(k => row[k] == null ? '' : row[k]).join(',')).join('\n'), 'text/csv;charset=utf-8');
  }
  function saveNormalSession() {
    if (!normalSession) normalSession = { remote, state: engine.export(), providerTrace };
  }
  function leaveDemo() {
    if (busy || demoRunning || !normalSession) return;
    ({ remote, providerTrace } = normalSession); engine = new C.Engine(normalSession.state);
    normalSession = null; activeDemo = null; render();
  }
  function demoStatus(text) { if (activeDemo) { activeDemo.status = text; $('demo-status').textContent = text; } }
  async function retryReply(internal = false) {
    if (busy || !remote || (activeDemo && !internal)) return;
    setBusy(true);
    try {
      const result = await request('/api/reply/retry', 'POST', { interactionId: engine.profile().lastTrace?.interactionId });
      engine = new C.Engine(result.state); providerTrace = result.provider; render(); return result;
    } catch (error) { toast(error.message); }
    finally { setBusy(false); }
  }
  async function waitForRetry(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end && !stopDemo) {
      demoStatus(`模型服务限流，${Math.ceil((end - Date.now()) / 1000)} 秒后重试当前回复；已学内容不会重复写入。`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  function demoEvidence() {
    return { schema: 'childgpt.frontend-demo.v1', kind: activeDemo.kind, createdAt: activeDemo.createdAt,
      evidenceType: 'Actual frontend session; per-reply provider provenance; synthetic conversation only',
      status: activeDemo.status, completed: activeDemo.completed, steps: activeDemo.steps, state: engine.export() };
  }
  function checkDemo(kind) {
    const p = engine.profile(), actions = activeDemo.steps.map(step => step.trace?.action);
    if (kind === 'conversation') return p.memories.length === 0 && actions.every(a => a === 'help');
    return actions[0] === 'ask_to_learn' && actions[2] === 'controlled_recall' &&
      p.memories.length === 1 && p.memories[0].content.includes('先系红绳') && p.memories[0].content.includes('再敲三下铜铃') && p.memories[0].correctionHistory.length === 1;
  }
  async function runDemo(kind) {
    if (busy || demoRunning || initializing) return;
    const connection = normalSession?.remote || remote;
    if (!connection?.apiEnabled) return toast('现场演示需要模型连接。可先查看保存的实测记录，或在 Connect & privacy 连接服务。');
    demoRunning = true; stopDemo = false; setBusy(true);
    try {
      const result = await request('/api/demo-session', 'POST', { kind }, connection);
      saveNormalSession();
      remote = { ...connection, token: result.sessionToken };
      engine = new C.Engine(result.state); providerTrace = null;
      activeDemo = { kind, createdAt: new Date().toISOString(), status: '准备开始…', steps: [], completed: false };
      navigate('studio'); render();
      for (const [i, step] of demoSteps[kind].entries()) {
        if (stopDemo) break;
        demoStatus(`${i + 1}/${demoSteps[kind].length} · ${step.label}`);
        setBusy(false); let turn = await perform(step.input, true);
        if (!turn) throw new Error('请求未完成，演示暂停。已完成的步骤仍可查看。');
        for (let attempt = 0; turn.provider?.wording !== 'api-generated-response' && attempt < 2 && !stopDemo; attempt++) {
          if (turn.provider?.error?.code === 'rate-limited') await waitForRetry(turn.provider.error.retryAfterMs || 60000);
          else if (turn.provider?.error?.code !== 'invalid-output') break;
          if (!stopDemo) turn = await retryReply(true) || turn;
        }
        activeDemo.steps.push({ label: step.label, input: step.input, message: turn.message, trace: turn.trace, provider: turn.provider,
          memoryAfter: JSON.parse(JSON.stringify(engine.profile().memories)) });
        if (turn.provider?.wording !== 'api-generated-response') throw new Error(`演示暂停：${failureLabel(turn.provider?.error)}。这一步保留了本地回复，未计为模型演示成功。`);
      }
      if (stopDemo) demoStatus('已停止。已完成的对话和记忆保留在这里。');
      else {
        if (!checkDemo(kind)) throw new Error('模型已回复，但学习行为未通过演示检查；请查看右侧记忆与算法记录。');
        activeDemo.completed = true;
        demoStatus(`已完成 · ${activeDemo.steps.length}/${demoSteps[kind].length} 条回复均由 ${remote.service} / ${remote.model} 生成。${kind === 'learning' ? '漏记为受控演示；真实记忆已纠正为红绳，回忆不增加掌握度。' : '普通聊天没有写成知识记忆。'}`);
      }
    } catch (error) { demoStatus(error.message); toast(error.message); }
    finally { demoRunning = false; setBusy(false); render(); }
  }
  async function showRecording(kind) {
    if (busy || demoRunning || initializing) return;
    setBusy(true);
    try {
      const embedded = document.getElementById(`recording-${kind}`);
      let data;
      if (embedded) data = JSON.parse(embedded.textContent);
      else {
        const response = await fetch(`results/demos/${kind}.json`);
        if (!response.ok) throw new Error('还没有这组实测记录。请连接模型后运行现场演示。');
        data = await response.json();
      }
      if (data.schema !== 'childgpt.frontend-demo.v1' || data.kind !== kind) throw new Error('无法读取这组演示记录。');
      const restoredEngine = new C.Engine(data.state);
      saveNormalSession(); remote = null; engine = restoredEngine;
      activeDemo = { ...data, recorded: true, status: `实测回放 · ${data.status}` };
      providerTrace = engine.profile().lastTrace?.provider || null; navigate('studio'); render();
    } catch (error) { toast(error.message); }
    finally { setBusy(false); }
  }
  async function connect(event) {
    event.preventDefault();
    let base = $('backend-url').value.trim().replace(/\/$/u, '');
    if (!base && location.protocol !== 'file:' && !location.hostname.endsWith('github.io')) base = location.origin;
    try {
      const u = new URL(base);
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost','127.0.0.1'].includes(u.hostname))) throw new Error('Use HTTPS for a remote backend, or HTTP on localhost.');
      if (u.username || u.password || u.search || u.hash) throw new Error('Backend URL must not contain credentials, query parameters or fragments.');
      base = u.href.replace(/\/$/u, '');
      $('connection-status').textContent = 'Connecting…';
      const config = await request('/api/config', 'GET', undefined, { base });
      const result = await request('/api/session', 'POST', { accessToken: $('backend-token').value }, { base });
      activeDemo = null; normalSession = null; connectionFailure = '';
      remote = { base, token: result.sessionToken, apiEnabled: config.apiEnabled, model: config.model, service: config.service }; engine = new C.Engine(result.state); providerTrace = null;
      try { sessionStorage.setItem('childgpt.backend', JSON.stringify(remote)); } catch {}
      storage.set('childgpt.backend-url', base); $('backend-token').value = '';
      $('connection-status').textContent = config.apiEnabled ? 'Connected. The model understands your messages and writes natural replies guided by the learning policy. Backend memory is separate from the local demo.' : 'Connected to server demo. LLM fields are still empty; replies remain deterministic.';
      render(); toast('Backend connected. A separate isolated session is active.');
    } catch (e) { $('connection-status').textContent = e.message; toast(e.message); }
  }
  function disconnect() {
    remote = null; providerTrace = null; activeDemo = null; normalSession = null; connectionFailure = '';
    try { sessionStorage.removeItem('childgpt.backend'); } catch {}
    try { engine = new C.Engine(remember ? JSON.parse(storage.get('childgpt.state') || 'null') : null); } catch { engine = new C.Engine(); }
    $('connection-status').textContent = 'Local demo active. The disconnected server session expires automatically within seven days.'; render();
  }
  document.querySelectorAll('[data-page]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.page)));
  document.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', () => selectMode(el.dataset.action)));
  window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
    $('conversation-form').addEventListener('submit', async event => { event.preventDefault(); const input = mode === 'chat' ? { mode, text: $('text-input').value.trim() } : { mode, concept: $('concept-input').value.trim(), topic: $('topic-input').value, ...(['teach','correct'].includes(mode) ? { content: $('content-input').value.trim() } : {}) }; if (mode === 'chat' && !input.text) return toast('Enter a message first.'); const result = await perform(input); if (result && input.mode === 'chat' && $('text-input').value.trim() === input.text) $('text-input').value = ''; });
    $('debug-controls').addEventListener('toggle', () => { document.body.classList.toggle('show-action-tags', $('debug-controls').open); if (!$('debug-controls').open) selectMode('chat'); });
  $('next-question').addEventListener('click', () => perform({ mode: 'next', topic: $('topic-input').value }));
  $('skip-invitation').addEventListener('click', () => perform({ mode: 'skip' }));
  $('guided-demo').addEventListener('click', () => runDemo('learning'));
  $('conversation-demo').addEventListener('click', () => runDemo('conversation'));
  document.querySelectorAll('[data-recording]').forEach(button => button.addEventListener('click', () => showRecording(button.dataset.recording)));
  $('demo-return').addEventListener('click', leaveDemo);
  $('demo-stop').addEventListener('click', () => { stopDemo = true; demoStatus('正在停止；当前请求结束后保留已完成步骤。'); });
  $('demo-export').addEventListener('click', () => activeDemo && jsonDownload(`${activeDemo.kind}.json`, demoEvidence()));
  $('retry-reply').addEventListener('click', () => retryReply());
  $('profile-select').addEventListener('change', async event => { if (busy || demoRunning || activeDemo || initializing) return; try { if (remote) { const r = await request('/api/profile','POST',{profile:event.target.value}); engine = new C.Engine(r.state); } else engine.switchProfile(event.target.value); providerTrace = null; persist(); render(); } catch(e) { toast(e.message); render(); } });
  $('memory-list').addEventListener('click', event => { const b = event.target.closest('[data-memory]'); if (!b) return; const memory = engine.profile().memories[Number(b.dataset.memory)]; if (!memory) return; $('concept-input').value = memory.concept; perform({ mode: b.dataset.memoryAction === 'confirm' ? 'confirm' : 'recall', concept: memory.concept, forceError: b.dataset.memoryAction === 'error' }); });
  $('export-trace').addEventListener('click', () => engine.profile().lastTrace ? jsonDownload('childgpt-algorithm-trace.json', { trace: engine.profile().lastTrace, provider: providerTrace }) : toast('Interact with the learner first.'));
  $('export-metadata').addEventListener('click', () => jsonDownload('childgpt-metadata-only.json', { profile: engine.profile().id, summary: C.summarizeMetadata(engine.profile().metadata), events: engine.profile().metadata }));
  $('run-tests').addEventListener('click', runFunctional); $('run-simulation').addEventListener('click', runSimulation); $('run-monte').addEventListener('click', runMonte);
  $('export-results').addEventListener('click', exportEvaluation); $('export-csv').addEventListener('click', exportCSV); $('export-svg').addEventListener('click', () => simulation ? download('childgpt-cusum.svg', chartSVG(simulation,'cusum'), 'image/svg+xml') : toast('Run a simulation first.'));
  $('connect-form').addEventListener('submit', connect); $('disconnect').addEventListener('click', disconnect);
  $('remember-toggle').addEventListener('change', e => { remember = e.target.checked; storage.set('childgpt.remember', remember ? 'yes' : 'no'); if (remember) persist(); else storage.remove('childgpt.state'); toast(remember ? 'Local demo persistence enabled on this browser.' : 'Saved local demo data removed; current in-memory session remains available.'); });
  $('metadata-toggle').addEventListener('change', e => perform({ mode: 'settings', metadataEnabled: e.target.checked }));
  $('invitation-toggle').addEventListener('change', e => perform({ mode: 'settings', invitationsEnabled: e.target.checked }));
  $('invite-button').addEventListener('click', async () => { if (!engine.profile().invitationsEnabled) return toast('Enable optional invitations first.'); const result = await perform({ mode: 'invite' }); if (result?.skipped) toast('No extra invitation sent. One may already be waiting, or the cooldown is active.'); else navigate('studio'); });
  $('export-memory').addEventListener('click', () => jsonDownload('childgpt-profile-private.json', { warning: 'Contains this profile’s taught content and history. Do not publish real personal data.', profile: engine.profile() }));
  $('delete-profile').addEventListener('click', async () => { if (!confirm('Delete this profile’s memory, conversation and metadata? The other profile is unchanged.')) return; try { if (remote) { const r = await request('/api/profile', 'POST', { profile: engine.state.activeProfile, reset: true }); engine = new C.Engine(r.state); } else engine.resetProfile(); providerTrace = null; persist(); render(); toast('Current profile deleted.'); } catch(e) { toast(e.message); } });
  setInterval(() => { if (!busy && !demoRunning && !activeDemo && !initializing && engine.profile().invitationsEnabled && !engine.profile().pendingInvitation) perform({ mode: 'invite' }); }, 60000);
  $('backend-url').value = storage.get('childgpt.backend-url') || '';
  $('check-count').textContent = C.functionalEvaluation().total; selectMode('chat'); render(); runSimulation(); navigate(location.hash.slice(1) || 'studio');
  (async () => {
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem('childgpt.backend') || 'null'); } catch {}
    try {
      if (saved?.base && saved?.token) {
        try {
          const result = await request('/api/state', 'GET', undefined, saved);
          remote = { ...saved, apiEnabled: result.apiEnabled, model: result.model, service: result.service };
          engine = new C.Engine(result.state); providerTrace = engine.profile().lastTrace?.provider || null;
          $('connection-status').textContent = 'Previous backend session restored in this browser tab.';
          return;
        } catch (error) {
          // A transient outage must not silently replace an existing learner with a blank one.
          if (error.status !== 401) throw error;
          try { sessionStorage.removeItem('childgpt.backend'); } catch {}
        }
      }
      const localKey = document.querySelector('meta[name="childgpt-local-key"]')?.content;
      if (!localKey) return;
      const result = await request('/api/local-session', 'POST', { localKey }, { base: location.origin });
      remote = { base: location.origin, token: result.sessionToken, apiEnabled: result.apiEnabled, model: result.model, service: result.service };
      engine = new C.Engine(result.state);
      try { sessionStorage.setItem('childgpt.backend', JSON.stringify(remote)); } catch {}
      $('connection-status').textContent = 'Local model connection is ready. Provider credentials stay on the server.';
    } catch (error) {
      connectionFailure = `模型连接失败：${error.message} 当前仅可使用本地规则回复。刷新页面可重试。`;
      toast(connectionFailure);
    } finally {
      initializing = false; render();
      const demo = new URLSearchParams(location.search).get('demo');
      if (Object.hasOwn(demoNames, demo)) await showRecording(demo);
    }
  })();
})();
