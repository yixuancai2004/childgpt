/* Browser UI. Works as a static GitHub Pages project, as a standalone file, or with server.mjs. */
(function () {
  'use strict';
  const C = window.ChildGPT, $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const storage = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { toast('Browser storage is unavailable; the demo remains in memory.'); } }, remove(k) { try { localStorage.removeItem(k); } catch {} } };
  let remember = storage.get('childgpt.remember') === 'yes';
  let engine;
  try { engine = new C.Engine(remember ? JSON.parse(storage.get('childgpt.state') || 'null') : null); } catch { engine = new C.Engine(); }
  let mode = 'teach', busy = false, demoRunning = false, remote = null, functional = null, simulation = null, monte = null, sweep = null, providerTrace = null, toastTimer;
  const names = { studio: 'Learning studio', algorithms: 'Algorithm trace', evaluation: 'Evaluation lab', settings: 'Connect & privacy' };
  const pct = (value, places = 0) => value == null ? '—' : `${(value * 100).toFixed(places)}%`;
  function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500); }
  function download(name, content, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const jsonDownload = (name, data) => download(name, JSON.stringify(data, null, 2));
  function persist() { if (!remote && remember) storage.set('childgpt.state', JSON.stringify(engine.export())); }
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
    for (const id of ['send-button', 'next-question', 'guided-demo', 'profile-select', 'delete-profile', 'invite-button']) $(id).disabled = value || demoRunning;
    $('send-button').textContent = value ? 'Thinking…' : ({ teach: 'Teach Milo ↗', correct: 'Update memory ↗', ask: 'Ask Milo ↗', recall: 'Recall together ↗', chat: 'Send message ↗' }[mode]);
  }
  function selectMode(next) {
    mode = next;
    document.querySelectorAll('[data-action]').forEach(el => el.classList.toggle('selected', el.dataset.action === mode));
    $('structured-fields').hidden = mode === 'chat'; $('free-text-field').hidden = mode !== 'chat';
    $('content-field').hidden = !['teach', 'correct'].includes(mode);
    $('composer-note').textContent = mode === 'chat' ? 'Offline grammar: “Teach: concept = explanation”, “Correct: concept = explanation”, “What is concept?” or “Ask me”. Connected API mode also extracts exact spans from free text.' : 'No built-in factual answers. Memory starts empty. Synthetic examples only.';
    setBusy(busy);
  }
  async function request(route, method = 'GET', data, connection = remote) {
    const headers = { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(connection?.token ? { Authorization: `Bearer ${connection.token}` } : {}) };
    const res = await fetch(`${connection?.base || ''}${route}`, { method, headers, ...(data ? { body: JSON.stringify(data) } : {}), credentials: 'omit', signal: AbortSignal.timeout(45000) });
    let value; try { value = await res.json(); } catch { throw new Error('Backend returned a non-JSON response. Check the backend URL.'); }
    if (!res.ok) throw new Error(value.error || `Backend HTTP ${res.status}`);
    return value;
  }
  async function perform(input, internal = false) {
    if (busy || (demoRunning && !internal)) return;
    setBusy(true);
    try {
      let result;
      if (remote) { result = await request('/api/turn', 'POST', { input, profile: engine.state.activeProfile }); engine = new C.Engine(result.state); providerTrace = result.provider || null; }
      else { result = engine.transact(input); providerTrace = null; }
      persist(); render();
      if (result.skipped && result.message) toast(result.message);
      if (result.provider?.wording?.includes('fallback') || result.provider?.extraction?.includes('fallback')) toast('Provider unavailable or output rejected. Deterministic fallback is active.');
      return result;
    } catch (e) { toast(e.message || 'Unable to complete this action.'); }
    finally { setBusy(false); }
  }
  function render() {
    const p = engine.profile();
    $('profile-select').value = p.id; $('memory-count').textContent = p.memories.length; $('memory-pill').textContent = `${p.memories.length} item${p.memories.length === 1 ? '' : 's'}`;
    $('mastery-value').textContent = p.memories.length ? pct(C.mean(p.memories.map(m => m.mastery))) : '—';
    $('mode-badge').textContent = remote ? (remote.apiEnabled ? '● CONNECTED API' : '● SERVER DEMO · NO API') : '● KEY-FREE DEMO';
    $('remember-toggle').checked = remember; $('metadata-toggle').checked = p.metadataEnabled; $('invitation-toggle').checked = p.invitationsEnabled;
    $('invitation-bar').hidden = !p.pendingInvitation;
    const history = $('chat-history');
    if (!p.history.length) history.innerHTML = '<div class="welcome"><div class="welcome-avatar">✳</div><h3>I don’t know your stories yet.</h3><p>I’m Milo, an AI learner. Teach me a word, a tradition, or a memory that matters to you.<br>It’s always okay to skip.</p><div class="example">Try an invented word:<br><strong>“tavi” = a happy moment shared over tea</strong></div></div>';
    else history.innerHTML = p.history.map(m => `<div class="message ${m.role === 'user' ? 'user' : 'assistant'}"><span class="message-label">${m.role === 'user' ? escape(p.label) + ' · you' : 'Milo · AI learner'}</span><div class="bubble">${escape(m.text)}</div>${m.action ? `<span class="action-tag">${escape(m.action.replaceAll('_', ' '))}</span>` : ''}</div>`).join('');
    history.scrollTop = history.scrollHeight;
    $('memory-list').innerHTML = p.memories.length ? p.memories.slice(-6).map(m => {
      const index = p.memories.indexOf(m);
      return `<div class="memory-item"><div class="memory-title"><span>${escape(m.concept)}</span><small>${pct(m.mastery)} mastery</small></div><p>${escape(m.content)}</p><div class="progress-track" aria-label="Mastery ${pct(m.mastery)}"><div class="progress-fill" style="width:${Math.round(m.mastery * 100)}%"></div></div><div class="memory-provenance">${escape(m.topic)} · ${escape(m.sourceInteraction)}<br>${m.correctionHistory.length} corrections · ${m.related.length} related concepts${m.pendingContent ? '<br>⚠ Conflicting teaching awaits explicit correction' : ''}</div><div class="memory-actions"><button class="text-button" data-memory="${index}" data-memory-action="recall">Recall</button><button class="text-button" data-memory="${index}" data-memory-action="error">Scripted omission</button><button class="text-button" data-memory="${index}" data-memory-action="confirm">Confirm</button></div></div>`;
    }).join('') + (p.memories.length > 6 ? '<p class="subtle">Showing the latest 6 memories. Export the profile for the full store.</p>' : '') : '<div class="empty-memory"><span>▤</span><p>A blank page, for now.<br>The first lesson begins with you.</p></div>';
    $('trace-summary').innerHTML = p.lastTrace ? `<span class="trace-action">${escape(p.lastTrace.action)}</span><br>${escape(p.lastTrace.reason)}<br><small>${p.lastTrace.allowedKnowledge.length} permitted fact · ${escape(p.lastTrace.realization)}</small>` : 'No hidden factual knowledge is available here. Teach a concept to see how the next decision is made.';
    renderAlgorithms();
  }
  function renderAlgorithms() {
    const p = engine.profile(), t = p.lastTrace;
    const pairs = t ? [['Action', t.action], ['Concept', t.concept], ['Knowledge boundary', t.knowledgeBoundary], ['Allowed fact', t.allowedKnowledge.join('\n') || 'None — ask to learn'], ['Source interaction', t.sourceInteraction || 'None'], ['Memory item', t.memoryId || 'None'], ['Mastery', `${t.masteryBefore ?? 'not stored'} → ${t.masteryAfter ?? 'not stored'}`], ['Decision rule', t.reason], ['Recall decision', t.recall ? `${t.recall.band} mastery · draw ${t.recall.draw} → ${t.recall.outcome}` : 'Not a policy-selected recall'], ['Controlled error', t.corruption ? `${t.corruption.operator}: ${t.corruption.detail}` : 'None'], ['Realization', t.realization], ['Provider status', providerTrace ? JSON.stringify(providerTrace) : 'No provider request'], ['Ranked candidates', t.candidates.map(c => `${c.concept}: ${c.score}`).join('; ') || 'No candidates']] : [];
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
  async function guidedDemo() {
    if (busy || demoRunning) return;
    if (engine.profile().memories.length && !confirm('Run the guided demo? This replaces the CURRENT synthetic profile. The other profile is unchanged.')) return;
    demoRunning = true; setBusy(true);
    try {
      if (remote) { const r = await request('/api/profile', 'POST', { profile: engine.state.activeProfile, reset: true }); engine = new C.Engine(r.state); } else engine.resetProfile();
      render(); navigate('studio');
      const steps = [{ mode: 'ask', concept: 'tavi' }, { mode: 'teach', concept: 'tavi', content: 'a happy moment shared over tea', topic: C.TOPICS[0] }, { mode: 'ask', concept: 'tavi' }, { mode: 'recall', concept: 'tavi', forceError: true }, { mode: 'correct', concept: 'tavi', content: 'a happy moment shared over warm tea' }, { mode: 'ask', concept: 'tavi' }];
      for (let i = 0; i < steps.length; i++) { setBusy(false); const result = await perform(steps[i], true); if (!result) break; toast(`Guided demo · step ${i+1}/${steps.length}: ${steps[i].mode}`); await new Promise(r => setTimeout(r, 420)); }
      $('concept-input').value = 'tavi'; $('content-input').value = 'a happy moment shared over warm tea';
      toast('Teaching → memory → scripted omission → correction → recall complete. Switch to Learner B to test isolation.');
    } catch (e) { toast(e.message); } finally { demoRunning = false; setBusy(false); persist(); }
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
      remote = { base, token: result.sessionToken, apiEnabled: config.apiEnabled }; engine = new C.Engine(result.state); providerTrace = null;
      try { sessionStorage.setItem('childgpt.backend', JSON.stringify(remote)); } catch {}
      storage.set('childgpt.backend-url', base); $('backend-token').value = '';
      $('connection-status').textContent = config.apiEnabled ? 'Connected. Model extraction and approved wording are enabled. Backend memory is separate from the local demo.' : 'Connected to server demo. LLM fields are still empty; replies remain deterministic.';
      render(); toast('Backend connected. A separate isolated session is active.');
    } catch (e) { $('connection-status').textContent = e.message; toast(e.message); }
  }
  function disconnect() {
    remote = null; providerTrace = null;
    try { sessionStorage.removeItem('childgpt.backend'); } catch {}
    try { engine = new C.Engine(remember ? JSON.parse(storage.get('childgpt.state') || 'null') : null); } catch { engine = new C.Engine(); }
    $('connection-status').textContent = 'Local demo active. The disconnected server session expires automatically within seven days.'; render();
  }
  document.querySelectorAll('[data-page]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.page)));
  document.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', () => selectMode(el.dataset.action)));
  window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
  $('conversation-form').addEventListener('submit', async event => { event.preventDefault(); const input = mode === 'chat' ? { mode, text: $('text-input').value.trim() } : { mode, concept: $('concept-input').value.trim(), topic: $('topic-input').value, ...(['teach','correct'].includes(mode) ? { content: $('content-input').value.trim() } : {}) }; if (mode === 'chat' && !input.text) return toast('Enter a message first.'); await perform(input); });
  $('next-question').addEventListener('click', () => perform({ mode: 'next', topic: $('topic-input').value }));
  $('skip-invitation').addEventListener('click', () => perform({ mode: 'skip' }));
  $('guided-demo').addEventListener('click', guidedDemo);
  $('profile-select').addEventListener('change', async event => { if (busy || demoRunning) return; try { if (remote) { const r = await request('/api/profile','POST',{profile:event.target.value}); engine = new C.Engine(r.state); } else engine.switchProfile(event.target.value); providerTrace = null; persist(); render(); } catch(e) { toast(e.message); render(); } });
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
  setInterval(() => { if (!busy && !demoRunning && engine.profile().invitationsEnabled && !engine.profile().pendingInvitation) perform({ mode: 'invite' }); }, 60000);
  $('backend-url').value = storage.get('childgpt.backend-url') || '';
  $('check-count').textContent = C.functionalEvaluation().total; selectMode('teach'); render(); runSimulation(); navigate(location.hash.slice(1) || 'studio');
  (async () => { let saved; try { saved = JSON.parse(sessionStorage.getItem('childgpt.backend') || 'null'); } catch {} if (!saved?.base || !saved?.token) return; try { const result = await request('/api/state','GET',undefined,saved); remote = { ...saved, apiEnabled: result.apiEnabled }; engine = new C.Engine(result.state); $('connection-status').textContent = 'Previous backend session restored in this browser tab.'; render(); } catch { try { sessionStorage.removeItem('childgpt.backend'); } catch {} toast('Previous backend session unavailable. Local demo remains active.'); } })();
})();
