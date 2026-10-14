/* ChildGPT canonical controller. Shared, unchanged, by browser and Node.
 * No external services, pretrained answers, clinical inference or random hidden state.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChildGPT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '1.1.0';
  const TOPICS = ['Dialect & expressions', 'Family traditions', 'Local stories'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const key = text => String(text || '').normalize('NFKC').trim().toLowerCase().replace(/[?.!。？！]+$/u, '');
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = xs => xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, x) => a + (x - mean(xs)) ** 2, 0) / (xs.length - 1));
  const round = (x, n = 4) => Math.round(x * 10 ** n) / 10 ** n;
  const nowISO = () => new Date().toISOString();
  const WORDING = {
    teach: ['Thank you for teaching me.', 'I learned something from you today.', 'I will keep your explanation in my memory.'],
    correct: ['Thank you for correcting me.', 'That helps me understand it better.', 'I have updated what you taught me.'],
    recall: ['You taught me:', 'From our learning together:', 'Here is what I have in my memory:'],
    ask_to_learn: ['I have not learned this from you yet.', 'This is new to my memory.', 'You have not taught me this yet.'],
    uncertain_recall: ['I am still learning this.', 'Could you check what I remember?', 'I am not quite sure I have this right.'],
    controlled_recall: ['I may be missing a part. Could you help me?', 'Could you check this incomplete memory?', 'I am practising, and this may be incomplete.'],
    follow_up: ['May I ask one more thing?', 'I would enjoy hearing more.', 'Could we explore this a little further?'],
    conflict: ['I heard something different this time.', 'This differs from what is in my memory.', 'Could you confirm this change?'],
    clarify: ['I am a little confused.', 'Could you help me sort this out?', 'I want to make sure I remember this correctly.']
  };
  // Recall plan by mastery band: probabilities of correct, uncertain and corrupted recall. The remainder is corruption.
  const RECALL_PLAN = { medium: { correct: 0.4, uncertain: 0.3 }, high: { correct: 0.9, uncertain: 0.05 } };
  const STOPWORDS = new Set('that this with from have when what your about there their them they then than were will would could should into over also only very much some such like just been being after before while where which other these those because always often usually something someone people thing things time make made take used uses using says said family'.split(' '));
  function emptyProfile(id) {
    return { id, label: id === 'learner-a' ? 'Learner A' : 'Learner B', memories: [], history: [], metadata: [], lastTrace: null, pendingInvitation: null, lastInvitationAt: 0, invitationsEnabled: false, metadataEnabled: true, turn: 0, asked: [] };
  }
  function newState() {
    return { version: VERSION, activeProfile: 'learner-a', profiles: { 'learner-a': emptyProfile('learner-a'), 'learner-b': emptyProfile('learner-b') } };
  }
  function assertInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A structured input is required.');
    if (!['chat', 'teach', 'correct', 'ask', 'recall', 'next', 'confirm', 'invite', 'skip', 'settings'].includes(input.mode)) throw new Error('Unknown action.');
    if (input.forceError != null && typeof input.forceError !== 'boolean') throw new Error('forceError must be boolean.');
    for (const f of ['concept', 'content', 'text']) if (input[f] != null && (typeof input[f] !== 'string' || input[f].length > (f === 'concept' ? 120 : 3000))) throw new Error(`Invalid ${f}.`);
    if (input.topic && !TOPICS.includes(input.topic)) throw new Error('Unknown teaching domain.');
  }
  function parseMessage(text) {
    text = String(text || '').trim();
    // Explicit grammar is intentionally small. An optional LLM adapter can extract grounded spans.
    const teaching = text.match(/^(teach|correct|教|纠正)\s*[:：]\s*(.{1,120}?)\s*[=＝]\s*([\s\S]+)$/iu);
    if (teaching) return { mode: /^(correct|纠正)$/iu.test(teaching[1]) ? 'correct' : 'teach', concept: teaching[2].trim(), content: teaching[3].trim(), text };
    const question = text.match(/^(?:what does|what is|do you remember)\s+(.+?)(?:\s+mean)?[?.!]*$/iu);
    if (question) return { mode: 'ask', concept: question[1].trim(), text };
    const zh = text.match(/^(.+?)(?:是什么意思|是什么)[？?。]*$/u);
    if (zh) return { mode: 'ask', concept: zh[1], text };
    if (/^(next|ask me|ask me a question|下一个|问我)[.!?。？]*$/iu.test(text)) return { mode: 'next', text };
    return { mode: 'chat', text };
  }
  function policyScore(item, topic, turn) {
    // Recency is staleness, not a timestamp: higher means longer since last practice.
    const staleness = clamp((turn - item.lastReviewedTurn) / 10, 0, 1);
    return round(0.5 * (1 - item.mastery) + 0.3 * staleness + 0.2 * (item.topic === topic ? 1 : 0));
  }
  function policyAction(mastery) {
    return mastery < 0.3 ? 'ask_to_learn' : mastery < 0.7 ? 'uncertain_recall' : 'follow_up';
  }
  function safeCorruption(item) {
    // Omission only, in low-stakes designated teaching material. No fabricated medical/recipe steps.
    const chunks = item.content.split(/\s*;\s*/u).filter(Boolean);
    if (chunks.length >= 2) return { text: chunks.slice(0, -1).join('; '), operator: 'omit_last_segment', omitted: chunks[chunks.length - 1], detail: `omitted the last step: “${chunks[chunks.length - 1]}”` };
    const words = item.content.trim().split(/\s+/u);
    if (words.length >= 4) return { text: words.slice(0, -2).join(' '), operator: 'omit_last_two_words', omitted: words.slice(-2).join(' '), detail: `omitted the last two words: “${words.slice(-2).join(' ')}”` };
    return { text: item.content, operator: 'uncertainty_only', omitted: null, detail: 'content too short to corrupt; flagged as uncertain' };
  }
  function quotedTerms(text) {
    // Curiosity targets are terms the teacher marked with quotes, e.g. served with “kopi”. Straight single quotes are skipped (apostrophes).
    return [...new Set([...String(text).matchAll(/["“「『‘]([^"”」』’\n]{1,40})["”」』’]/gu)].map(m => m[1].trim()).filter(Boolean))].slice(0, 5);
  }
  function draw(...parts) {
    // Deterministic uniform draw (FNV-1a) so every "random" recall decision is replayable from the trace.
    let h = 0x811c9dc5;
    for (const ch of parts.join('|')) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    // murmur3 finalizer spreads similar inputs (consecutive turns) evenly across [0, 1).
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function band(mastery) { return mastery < 0.3 ? 'low' : mastery < 0.7 ? 'medium' : 'high'; }
  function recallOutcome(mastery, u) {
    const plan = RECALL_PLAN[band(mastery)];
    if (!plan) return 'ask';
    return u < plan.correct ? 'correct' : u < plan.correct + plan.uncertain ? 'uncertain' : 'corrupt';
  }
  function segments(content) { return content.split(/\s*(?:;|\n)\s*/u).filter(Boolean); }
  function corrupt(item, memories, u) {
    // Each operator only rearranges or drops what this user taught; nothing is invented.
    const parts = segments(item.content), words = item.content.trim().split(/\s+/u);
    const neighbour = memories.find(m => m.id !== item.id && item.related.includes(m.id) && !safetySensitive(m));
    const ops = [];
    if (parts.length >= 2) {
      const i = Math.floor(u * parts.length) % parts.length;
      ops.push({ operator: 'omit_step', text: parts.filter((_, j) => j !== i).join('; '), omitted: parts[i], detail: `omitted step ${i + 1}: “${parts[i]}”` });
      const s = Math.floor(u * (parts.length - 1)) % (parts.length - 1), swapped = [...parts];
      [swapped[s], swapped[s + 1]] = [swapped[s + 1], swapped[s]];
      ops.push({ operator: 'swap_steps', text: swapped.join('; '), omitted: null, detail: `swapped steps ${s + 1} and ${s + 2}` });
    }
    if (neighbour) ops.push({ operator: 'confuse_related', text: neighbour.content, omitted: null, detail: `used the meaning of related concept “${neighbour.concept}”` });
    if (words.length >= 4) {
      const keep = Math.max(2, Math.ceil(words.length * 0.6));
      ops.push({ operator: 'approximate', text: `${words.slice(0, keep).join(' ')}…`, omitted: words.slice(keep).join(' '), detail: `only the first ${keep} of ${words.length} words` });
    }
    if (!ops.length) return { operator: 'uncertainty_only', text: item.content, omitted: null, detail: 'content too short to corrupt; flagged as uncertain' };
    return ops[Math.floor(draw(item.id, u) * ops.length)];
  }
  function keywords(text) {
    return [...new Set((String(text).toLowerCase().match(/\p{L}[\p{L}'-]{3,}/gu) || []).filter(w => !STOPWORDS.has(w)))];
  }
  function linkRelated(item, memories) {
    // Keyword graph: same teaching domain AND a shared keyword, or one concept is mentioned in the other's content.
    const mine = new Set(keywords(`${item.concept} ${item.content}`));
    for (const other of memories) {
      if (other.id === item.id || other.topic !== item.topic || item.related.includes(other.id)) continue;
      const shared = keywords(`${other.concept} ${other.content}`).some(w => mine.has(w));
      const words = text => ` ${key(text).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
      const mentioned = words(item.content).includes(words(other.concept)) || words(other.content).includes(words(item.concept));
      if (shared || mentioned) { item.related.push(other.id); other.related.push(item.id); }
    }
  }
  function curiosity(p) {
    // Concepts the user mentioned while teaching but has not taught yet, newest first.
    const known = new Set(p.memories.map(m => key(m.concept)));
    for (const m of [...p.memories].reverse()) for (const word of m.mentions || []) if (!known.has(key(word)) && !p.asked.includes(key(word))) return { word, from: m };
    return null;
  }
  function safetySensitive(item) {
    return /\b(medicine|medication|dosage|dose|allerg|poison|emergency|suicide|insulin|bleach|raw chicken)\b|药|剂量|过敏|自杀|急救|中毒/iu.test(`${item.concept} ${item.content}`);
  }
  function historyText(input) {
    if (input.text) return input.text;
    if (input.mode === 'teach') return `Teach: ${input.concept} = ${input.content}`;
    if (input.mode === 'correct') return `Correct: ${input.concept} = ${input.content}`;
    if (input.mode === 'ask') return `What does ${input.concept} mean?`;
    if (input.mode === 'recall') return `Recall: ${input.concept || 'a memory'}`;
    return { next: 'Ask me a question.', confirm: `Yes, that is correct: ${input.concept || ''}`, invite: 'Invite me to teach.', skip: 'Skip this invitation.' }[input.mode] || '';
  }
  class Engine {
    constructor(state) {
      this.state = state ? clone(state) : newState();
      if (this.state.version !== VERSION || !this.state.profiles?.['learner-a'] || !this.state.profiles?.['learner-b']) this.state = newState();
    }
    profile(id = this.state.activeProfile) {
      if (!Object.hasOwn(this.state.profiles, id)) throw new Error('Unknown profile.');
      return this.state.profiles[id];
    }
    switchProfile(id) { this.profile(id); this.state.activeProfile = id; return clone(this.state); }
    export() { return clone(this.state); }
    resetProfile(id = this.state.activeProfile) { this.profile(id); this.state.profiles[id] = emptyProfile(id); }
    transact(raw, clock = Date.now()) {
      assertInput(raw);
      let input = { ...raw };
      if (input.mode === 'chat') input = { ...input, ...parseMessage(input.text) };
      const p = this.profile();
      if (input.mode === 'settings') {
        for (const f of ['invitationsEnabled', 'metadataEnabled']) if (typeof input[f] === 'boolean') p[f] = input[f];
        return { state: this.export(), trace: p.lastTrace, message: '' };
      }
      if (input.mode === 'invite' && (!p.invitationsEnabled || p.pendingInvitation || clock - p.lastInvitationAt < 60000)) return { state: this.export(), message: '', skipped: true };
      if (input.mode === 'skip') {
        if (p.pendingInvitation && p.metadataEnabled) p.metadata.push({ at: new Date(clock).toISOString(), kind: 'invitation_skipped', responseDelayMs: null, explanationCharacters: 0, correction: false, selfInitiated: false });
        p.pendingInvitation = null;
        return { state: this.export(), message: 'No problem. You can return whenever you choose.', skipped: true };
      }
      const concept = String(input.concept || '').trim();
      const content = String(input.content || '').trim();
      if (['teach', 'correct', 'ask'].includes(input.mode) && !concept) throw new Error('Please name the concept.');
      if (['teach', 'correct'].includes(input.mode) && !content) throw new Error('Please enter what you want to teach.');
      if (p.memories.length >= 200 && input.mode === 'teach' && !p.memories.some(m => key(m.concept) === key(concept))) throw new Error('Demo limit: 200 memories per learner. Delete a profile to start over.');
      p.turn += 1;
      const interactionId = `${p.id}-turn-${p.turn}`;
      let item = p.memories.find(m => key(m.concept) === key(concept));
      let before = item ? item.mastery : null;
      let action = input.mode, reason = '', permitted = '', corruption = null, askAbout = null, recall = null;
      let memoryId = item?.id || null;
      const topic = input.topic || item?.topic || TOPICS[0];
      const candidates = p.memories.map(m => ({ concept: m.concept, score: policyScore(m, topic, p.turn), mastery: m.mastery })).sort((a, b) => b.score - a.score);
      if (input.mode === 'teach' || input.mode === 'correct') {
        if (!item) {
          item = { id: `${p.id}-m${p.turn}`, concept, content, topic, related: [], mentions: quotedTerms(content).filter(w => key(w) !== key(concept)), mastery: 0.35, learnedAt: new Date(clock).toISOString(), lastReviewedTurn: p.turn, sourceInteraction: interactionId, correctionHistory: [], pendingContent: null };
          // Keyword graph: bidirectional links only within this profile.
          linkRelated(item, p.memories);
          p.memories.push(item); action = 'teach'; reason = 'New user-provided fact. Stored with provenance; initial mastery is 0.35.';
        } else if (input.mode === 'correct') {
          item.correctionHistory.push({ previous: item.content, updated: content, interactionId, at: new Date(clock).toISOString() });
          item.correctionHistory = item.correctionHistory.slice(-30);
          item.content = content; item.pendingContent = null; item.mastery = clamp(item.mastery + 0.2, 0, 1); item.sourceInteraction = interactionId; item.lastReviewedTurn = p.turn;
          item.mentions = quotedTerms(content).filter(w => key(w) !== key(item.concept)); linkRelated(item, p.memories);
          reason = 'Explicit correction. Preserve revision history, replace fact, raise mastery by 0.20.';
        } else if (item.content !== content) {
          item.pendingContent = content; action = 'conflict'; reason = 'Conflicting teaching is pending. An explicit correction is required before replacing existing memory.';
        } else {
          item.mastery = clamp(item.mastery + 0.1, 0, 1); item.lastReviewedTurn = p.turn;
          reason = 'Repeated teaching. Same content, mastery increased by 0.10.';
        }
        memoryId = item.id; permitted = item.content;
      } else if (input.mode === 'confirm') {
        if (!item) { action = 'ask_to_learn'; reason = 'No matching memory exists to confirm.'; }
        else {
          const kept = item.pendingContent != null; item.pendingContent = null;
          item.mastery = clamp(item.mastery + 0.15, 0, 1); item.lastReviewedTurn = p.turn; permitted = item.content; action = 'recall';
          reason = `Explicit confirmation raises mastery by 0.15. Recall alone never raises mastery.${kept ? ' The pending conflicting version was discarded.' : ''}`;
        }
      } else if (input.mode === 'ask' || input.mode === 'recall') {
        if (!item && input.mode === 'recall' && !concept) { item = p.memories[0]; before = item?.mastery ?? null; }
        if (!item) { action = 'ask_to_learn'; reason = 'Knowledge boundary: exact concept not found in this learner’s memory. Base-model facts are not permitted.'; }
        else {
          memoryId = item.id; permitted = item.content; action = 'recall'; item.lastReviewedTurn = p.turn;
          reason = 'Retrieve the exact stored fact. Do not add pretrained knowledge.';
          if (input.forceError && !safetySensitive(item) && item.mastery >= 0.3 && item.mastery < 0.7) {
            corruption = safeCorruption(item); permitted = corruption.text; action = corruption.operator === 'uncertainty_only' ? 'uncertain_recall' : 'controlled_recall';
            reason = 'Presenter-triggered controlled omission at medium mastery; original memory is unchanged.';
          } else if (input.forceError) reason += ' Controlled omission disabled at this mastery or for safety-sensitive content.';
        }
      } else if (input.mode === 'next' || input.mode === 'invite') {
        // A deterministic exploration turn makes the policy replayable without hidden randomness.
        const explore = !p.memories.length || p.turn % 5 === 0;
        const conflicted = p.memories.find(m => m.pendingContent != null);
        if (conflicted) {
          item = conflicted; before = item.mastery; memoryId = item.id; action = 'clarify'; permitted = item.content;
          reason = 'Clarification first: this memory has an unresolved conflicting version, so ask which is right instead of overwriting.';
        } else if (explore) {
          const wonder = curiosity(p);
          item = null; memoryId = null; action = 'ask_to_learn';
          if (wonder) { askAbout = wonder.word; p.asked.push(key(wonder.word)); p.asked = p.asked.slice(-200); reason = `Exploration turn: “${wonder.word}” was mentioned while teaching “${wonder.from.concept}” but has not been taught yet.`; }
          else reason = 'Exploration turn: ask the user for a new concept. No invented topic knowledge.';
        } else {
          item = p.memories.find(m => m.concept === candidates[0].concept); before = item.mastery; memoryId = item.id; permitted = item.content; item.lastReviewedTurn = p.turn;
          const u =round(draw(p.id, item.id, p.turn)), outcome = recallOutcome(item.mastery, u);
          recall = { band: band(item.mastery), draw: u, outcome };
          reason = `Highest priority = 0.5 × (1 − mastery) + 0.3 × staleness + 0.2 × topic relevance; score ${candidates[0].score}. ${band(item.mastery)} mastery → ${outcome} (draw ${u}).`;
          if (outcome === 'ask') action = 'ask_to_learn';
          else if (outcome === 'correct') action = item.mastery >= 0.7 ? 'follow_up' : 'recall';
          else if (outcome === 'uncertain' || safetySensitive(item)) { action = 'uncertain_recall'; if (outcome === 'corrupt') reason += ' Corruption skipped for safety-sensitive content.'; }
          else { corruption = corrupt(item, p.memories, u); permitted = corruption.text; action = corruption.operator === 'uncertainty_only' ? 'uncertain_recall' : 'controlled_recall'; reason += ` Operator: ${corruption.operator}; stored memory is unchanged.`; }
        }
      } else {
        action = 'help'; reason = 'Offline parser needs a structured teaching input. No unrestricted model answer is used.';
      }
      const trace = {
        interactionId, inputMode: input.mode, action, concept: item?.concept || askAbout || concept || 'a new expression', topic,
        memoryId, sourceInteraction: item?.sourceInteraction || null, masteryBefore: before,
        masteryAfter: item ? round(item.mastery) : null, allowedKnowledge: permitted ? [permitted] : [],
        knowledgeBoundary: 'per-user external memory only', reason, candidates: candidates.slice(0, 5), recall,
        relatedConcept: item ? p.memories.find(m => item.related.includes(m.id))?.concept || null : null,
        corruption, pendingContent: item?.pendingContent || null, generatedAt: new Date(clock).toISOString(), realization: 'deterministic-template'
      };
      const message = renderMessage(trace);
      if (input.mode === 'invite') {
        p.pendingInvitation = { at: clock, id: interactionId }; p.lastInvitationAt = clock;
        if (p.metadataEnabled) p.metadata.push({ at: new Date(clock).toISOString(), kind: 'invitation', responseDelayMs: null, explanationCharacters: 0, correction: false, selfInitiated: false });
      } else {
        const pending = p.pendingInvitation;
        if (p.metadataEnabled) p.metadata.push({ at: new Date(clock).toISOString(), kind: 'response', responseDelayMs: pending ? Math.max(0, clock - pending.at) : null, explanationCharacters: Array.from(content || input.text || historyText(input)).length, correction: input.mode === 'correct', selfInitiated: !pending });
        p.pendingInvitation = null;
        p.history.push({ role: 'user', text: historyText(input), at: new Date(clock).toISOString() });
      }
      p.history.push({ role: 'assistant', text: message, at: new Date(clock).toISOString(), action, traceId: interactionId });
      p.history = p.history.slice(-120); p.metadata = p.metadata.slice(-1000); p.lastTrace = trace;
      return { state: this.export(), trace: clone(trace), message };
    }
    applyWording(index) {
      const p = this.profile(), trace = p.lastTrace;
      if (!trace || !Number.isInteger(index) || !WORDING[trace.action]?.[index]) return false;
      trace.realization = 'api-selected-approved-wording';
      p.history[p.history.length - 1].text = renderMessage(trace, index);
      return true;
    }
  }
  function renderMessage(trace, variant = 0) {
    const intro = WORDING[trace.action]?.[variant] || WORDING[trace.action]?.[0] || '';
    const fact = trace.allowedKnowledge[0] || '';
    const name = trace.concept;
    switch (trace.action) {
      case 'teach': return `${intro}\n“${name}” → ${fact}\nIs there a story behind it?`;
      case 'correct': return `${intro}\n“${name}” now means: ${fact}`;
      case 'recall': return `${intro}\n“${name}” → ${fact}\nDid I remember it correctly?`;
      case 'ask_to_learn': return `${intro}\nWould you like to teach me about ${name}? You can also skip this.`;
      case 'uncertain_recall': return `${intro}\nFor “${name}”, I have: ${fact}\nCould you explain it once more?`;
      case 'controlled_recall': return `${intro}\n“${name}” → ${fact}\n${{ swap_steps: 'Did I get the order right?', confuse_related: 'Or am I mixing it up with something else you taught me?' }[trace.corruption?.operator] || 'What did I leave out?'}`;
      case 'follow_up': return `${intro}\nYou taught me “${name}”: ${fact}\n${trace.relatedConcept ? `How is it connected to “${trace.relatedConcept}”?` : 'When would you use it?'}`;
      case 'conflict': return `${intro}\nMy existing memory for “${name}” is: ${fact}\nUse Correct to replace it, or keep teaching something else.`;
      case 'clarify': return `${intro}\nFor “${name}”, you first taught me: ${fact}\nLater I heard: ${trace.pendingContent}\nWhich one is right? Use Correct to replace it, or Confirm to keep the first.`;
      default: return 'I am an AI learner, not a person. In this key-free demo, use Teach, Ask, Correct or Recall. You can also type “Teach: tavi = a happy moment shared over tea”. No need to continue unless you feel like it.';
    }
  }
  function summarizeMetadata(events) {
    const responses = events.filter(e => e.kind === 'response');
    const invites = events.filter(e => e.kind === 'invitation');
    const prompted = responses.filter(e => e.responseDelayMs !== null);
    return { invitations: invites.length, responses: responses.length, responseRate: invites.length ? round(prompted.length / invites.length) : null, meanResponseDelayMs: prompted.length ? round(mean(prompted.map(e => e.responseDelayMs)), 0) : null, meanExplanationCharacters: responses.length ? round(mean(responses.map(e => e.explanationCharacters)), 1) : null, corrections: responses.filter(e => e.correction).length, selfInitiated: responses.filter(e => e.selfInitiated).length };
  }
  function rng(seed = 42) {
    let t = seed >>> 0;
    return () => { t += 0x6D2B79F5; let z = t; z = Math.imul(z ^ z >>> 15, z | 1); z ^= z + Math.imul(z ^ z >>> 7, z | 61); return ((z ^ z >>> 14) >>> 0) / 4294967296; };
  }
  function normal(random) { return Math.sqrt(-2 * Math.log(Math.max(1e-12, random()))) * Math.cos(2 * Math.PI * random()); }
  function simulate(options = {}) {
    const { seed = 42, days = 60, changeDay = 31, shift = 1.2, scenario = 'sustained' } = options;
    if (!Number.isInteger(seed) || !Number.isInteger(days) || days < 22 || days > 365 || !Number.isInteger(changeDay) || changeDay < 2 || changeDay > days || !Number.isFinite(shift) || shift < 0 || shift > 4 || !['stable', 'sustained', 'temporary'].includes(scenario)) throw new Error('Invalid simulation parameters.');
    const random = rng(seed), rows = [];
    for (let day = 1; day <= days; day++) {
      const changed = scenario !== 'stable' && day >= changeDay && (scenario !== 'temporary' || day < changeDay + 3);
      const latent = normal(random) * 0.6 + (changed ? shift : 0);
      const probability = clamp(0.88 - 0.13 * latent, 0.05, 0.99);
      const invitations = 8;
      let responded = 0;
      for (let j = 0; j < invitations; j++) if (random() < probability) responded++;
      rows.push({ day, invitations, responses: responded, responseRate: responded / invitations, responseDelayMinutes: responded ? round(Math.exp(Math.log(2.5) + 0.32 * latent + 0.18 * normal(random))) : null, explanationCharacters: responded ? Math.max(5, Math.round(160 - 28 * latent + 18 * normal(random))) : null, corrections: responded ? Math.max(0, Math.round(1.5 - 0.2 * latent + 0.5 * normal(random))) : 0, selfInitiated: Math.max(0, Math.round(2 - 0.4 * latent + 0.7 * normal(random))), changed });
    }
    return rows;
  }
  function detect(rows, options = {}) {
    const { baselineDays = 20, k = 0.5, h = 5 } = options;
    if (!Array.isArray(rows) || !Number.isInteger(baselineDays) || baselineDays < 10 || baselineDays >= rows.length || !Number.isFinite(k) || k < 0 || k > 5 || !Number.isFinite(h) || h <= 0 || h > 100) throw new Error('Invalid detector parameters.');
    const baseline = rows.slice(0, baselineDays);
    const specs = [
      { id: 'responseRate', transform: x => x, sign: -1, weight: 0.3, floor: 0.08 },
      { id: 'responseDelayMinutes', transform: x => Math.log(Math.max(0.01, x)), sign: 1, weight: 0.25, floor: 0.15 },
      { id: 'explanationCharacters', transform: x => x, sign: -1, weight: 0.2, floor: 12 },
      { id: 'selfInitiated', transform: x => x, sign: -1, weight: 0.15, floor: 0.5 },
      { id: 'corrections', transform: x => x, sign: -1, weight: 0.1, floor: 0.5 }
    ].map(s => { const values = baseline.filter(r => r[s.id] != null && Number.isFinite(r[s.id])).map(r => s.transform(r[s.id])); if (values.length < 8) throw new Error('Not enough valid baseline data.'); return { ...s, mu: mean(values), sigma: Math.max(s.floor, sd(values)) }; });
    const aggregate = row => { let value = 0, weights = 0; for (const s of specs) if (row[s.id] != null && Number.isFinite(row[s.id])) { value += s.weight * s.sign * (s.transform(row[s.id]) - s.mu) / s.sigma; weights += s.weight; } return weights ? value / weights : null; };
    const baseAggregate = baseline.map(aggregate).filter(x => x != null);
    const baseMu = mean(baseAggregate), baseSigma = Math.max(0.3, sd(baseAggregate));
    let sum = 0, firstAlarmDay = null, latched = false;
    const output = rows.map((row, i) => {
      const raw = aggregate(row), z = raw == null ? null : (raw - baseMu) / baseSigma;
      if (i >= baselineDays && z != null) sum = Math.max(0, sum + z - k);
      const crossed = i >= baselineDays && sum > h && !latched;
      if (crossed) { latched = true; firstAlarmDay = row.day; }
      return { ...row, z: z == null ? null : round(z), cusum: i < baselineDays ? 0 : round(sum), calibration: i < baselineDays, alarm: crossed };
    });
    const changeDay = rows.find(r => r.changed)?.day || null;
    return { rows: output, firstAlarmDay, changeDay, detectionDelay: firstAlarmDay != null && changeDay != null && firstAlarmDay >= changeDay ? firstAlarmDay - changeDay : null, preChangeFalseAlarm: firstAlarmDay != null && (changeDay == null || firstAlarmDay < changeDay), settings: { baselineDays, k, h }, baseline: specs.map(s => ({ field: s.id, mean: round(s.mu), std: round(s.sigma), sign: s.sign, weight: s.weight })), interpretation: 'Synthetic behavioural change only. Not a mental-health diagnosis or a validated clinical score.' };
  }
  function monteCarlo(options = {}) {
    const { runs = 200, seed = 1000, shift = 1.2, k = 0.5, h = 5, baselineDays = 20 } = options;
    if (!Number.isInteger(runs) || runs < 1 || runs > 2000) throw new Error('Invalid replicate count.');
    if (!Number.isInteger(baselineDays) || baselineDays < 10 || baselineDays >= 31) throw new Error('Calibration must finish before the day-31 simulated change.');
    const stable = [], changed = [];
    for (let i = 0; i < runs; i++) {
      const a = detect(simulate({ seed: seed + i, scenario: 'stable', shift }), { k, h, baselineDays });
      const b = detect(simulate({ seed: seed + 100000 + i, scenario: 'sustained', shift }), { k, h, baselineDays });
      stable.push(a); changed.push(b);
    }
    const temporary = [];
    for (let i = 0; i < runs; i++) temporary.push(detect(simulate({ seed: seed + 200000 + i, scenario: 'temporary', shift }), { k, h, baselineDays }));
    const delays = changed.filter(r => r.detectionDelay != null).map(r => r.detectionDelay).sort((a, b) => a - b);
    const sumStable = stable.filter(r => r.firstAlarmDay !== null).length;
    const preAlarm = changed.filter(r => r.preChangeFalseAlarm).length;
    const detected = delays.length;
    const middle = delays.length >> 1, median = !delays.length ? null : delays.length % 2 ? delays[middle] : (delays[middle - 1] + delays[middle]) / 2;
    const temporaryAlarms = temporary.filter(r => r.detectionDelay != null).length;
    return { runsPerCondition: runs, monitoredDays: 60 - baselineDays, seed, shift, k, h, baselineDays, stableFalseAlarmCount: sumStable, stableSequenceFalseAlarmRate: sumStable / runs, changedPreAlarmCount: preAlarm, changedPreAlarmRate: preAlarm / runs, detectedAfterChangeCount: detected, detectedAfterChangeRate: detected / runs, noAlarmCount: changed.filter(r => r.firstAlarmDay == null).length, meanDetectionDelay: delays.length ? round(mean(delays), 2) : null, medianDetectionDelay: median, temporaryAlarmCount: temporaryAlarms, temporaryAlarmRate: temporaryAlarms / runs, temporaryDefinition: 'Separate 3-day temporary dips (days 31–33), then a return to baseline. Counts sequences whose first alarm came on or after day 31. A sustained-change detector is expected to flag some of these; this is a limitation, not a success.', delayDefinition: 'First alarm day minus change day (day 31); only post-change first detections. Pre-change alarms and misses reported separately.', falseAlarmDefinition: 'Fraction of stable 60-day sequences with at least one alarm after the first 20 calibration days (or selected baselineDays). Not a per-day false-positive rate.', dataType: 'synthetic; no participants; fixed, untuned illustrative thresholds' };
  }
  function sensitivity(options = {}) {
    // Threshold sweep for the trade-off chart. The default h=5 was fixed beforehand; this table must not be used to pick a "best" h on the same seeds.
    const { hs = [3, 4, 5, 6, 8, 10], runs = 200, seed = 1000, k = 0.5 } = options;
    return hs.map(h => { const m = monteCarlo({ runs, seed, k, h }); return { h, stableFalseAlarmRate: m.stableSequenceFalseAlarmRate, detectedAfterChangeRate: m.detectedAfterChangeRate, temporaryAlarmRate: m.temporaryAlarmRate, meanDetectionDelay: m.meanDetectionDelay }; });
  }
  function functionalEvaluation() {
    const results = [];
    const test = (name, fn, group) => { try { const detail = fn(); results.push({ name, group, pass: true, detail }); } catch (e) { results.push({ name, group, pass: false, detail: e.message }); } };
    const check = (x, message) => { if (!x) throw new Error(message); };
    const make = () => new Engine();
    for (let i = 0; i < 20; i++) {
      test(`Untaught boundary ${i + 1}`, () => { const e = make(); const r = e.transact({ mode: 'ask', concept: ['shiok', 'kampung', 'tavi', 'melo'][i % 4] + (i > 3 ? i : '') }); check(r.trace.action === 'ask_to_learn' && r.trace.allowedKnowledge.length === 0, 'Untaught fact was surfaced.'); return 'No permitted fact; ask-to-learn selected.'; }, 'Knowledge boundary');
    }
    for (let i = 0; i < 20; i++) {
      test(`Taught recall ${i + 1}`, () => { const e = make(), content = `synthetic meaning ${i}: a copper kite`; e.transact({ mode: 'teach', concept: `word-${i}`, content }); const r = e.transact({ mode: 'ask', concept: `word-${i}` }); check(r.trace.allowedKnowledge[0] === content && r.message.includes(content), 'Recall mismatch.'); return 'Exact user-taught content, not a pretrained meaning.'; }, 'Taught recall');
    }
    for (let i = 0; i < 10; i++) {
      test(`Correction ${i + 1}`, () => { const e = make(); e.transact({ mode: 'teach', concept: 'tavi', content: 'first meaning' }); e.transact({ mode: 'correct', concept: 'tavi', content: `revised meaning ${i}` }); const r = e.transact({ mode: 'ask', concept: 'tavi' }); check(r.trace.allowedKnowledge[0] === `revised meaning ${i}` && e.profile().memories[0].correctionHistory.length === 1, 'Correction failed.'); return 'Memory and provenance updated; prior version retained.'; }, 'Correction update');
      test(`User isolation ${i + 1}`, () => { const e = make(); e.transact({ mode: 'teach', concept: 'tavi', content: `private synthetic fact ${i}` }); e.switchProfile('learner-b'); const r = e.transact({ mode: 'ask', concept: 'tavi' }); check(r.trace.allowedKnowledge.length === 0 && e.profile().memories.length === 0, 'Cross-profile leakage.'); return 'Learner B cannot retrieve learner A’s memory.'; }, 'Memory isolation');
      test(`Controlled omission ${i + 1}`, () => { const e = make(); e.transact({ mode: 'teach', concept: 'tea custom', content: 'choose a cup; share a story; say thank you' }); const r = e.transact({ mode: 'recall', concept: 'tea custom', forceError: true }); check(r.trace.corruption?.operator === 'omit_last_segment' && r.trace.allowedKnowledge[0] === 'choose a cup; share a story' && e.profile().memories[0].content.endsWith('say thank you'), 'Corruption operator mismatch.'); return 'Exactly one segment omitted; database remains intact.'; }, 'Controlled recall');
    }
    const allowed = { low: ['ask_to_learn'], medium: ['recall', 'uncertain_recall', 'controlled_recall'], high: ['follow_up', 'uncertain_recall', 'controlled_recall'] };
    for (const m of [0, 0.1, 0.29, 0.3, 0.5, 0.69, 0.7, 0.8, 0.9, 1]) {
      test(`Mastery policy ${m}`, () => { const e = make(); e.transact({ mode: 'teach', concept: 'tavi', content: 'a happy moment; shared over tea' }); e.profile().memories[0].mastery = m; const r = e.transact({ mode: 'next' }); check(r.trace.recall?.band === band(m) && allowed[band(m)].includes(r.trace.action), 'Policy boundary mismatch.'); check(r.trace.masteryBefore === m, 'Selected memory has incorrect pre-action mastery trace.'); check(r.trace.recall.outcome === recallOutcome(m, r.trace.recall.draw), 'Recall outcome does not replay from its draw.'); return `mastery=${m} → ${r.trace.recall.outcome} → ${r.trace.action}`; }, 'Policy consistency');
    }
    const N = 4000, freq = (m, kind) => Array.from({ length: N }, (_, i) => recallOutcome(m, draw('calibration', i))).filter(o => o === kind).length / N;
    test('Low mastery never recalls', () => { check(freq(0.2, 'ask') === 1, 'Low mastery attempted recall.'); return 'mastery < 0.3 → ask to learn in 100% of draws'; }, 'Error calibration');
    test('Medium mastery error rate ≈ 30%', () => { const f = freq(0.5, 'corrupt'); check(Math.abs(f - 0.3) < 0.03, `Observed ${f}.`); return `corrupt in ${(f * 100).toFixed(1)}% of ${N} draws (planned 30%)`; }, 'Error calibration');
    test('High mastery error rate ≈ 5%', () => { const f = freq(0.85, 'corrupt'); check(Math.abs(f - 0.05) < 0.015, `Observed ${f}.`); return `corrupt in ${(f * 100).toFixed(1)}% of ${N} draws (planned 5%)`; }, 'Error calibration');
    const target = { id: 'x1', concept: 'kaya toast', content: 'toast the bread; spread kaya; add butter', related: ['x2'] };
    const peer = { id: 'x2', concept: 'kopi', content: 'coffee brewed with a cloth sock', related: ['x1'] };
    const taught = new Set(`${target.content} ${peer.content}`.split(/[\s;…]+/u).filter(Boolean));
    for (let i = 0; i < 10; i++) {
      const u = 0.05 + i * 0.1;
      test(`Corruption operator ${i + 1}`, () => {
        const before = JSON.stringify(target), c = corrupt(target, [target, peer], u), parts = segments(target.content), out = segments(c.text);
        check(c.text.split(/[\s;…]+/u).filter(Boolean).every(w => taught.has(w)), 'Corruption introduced untaught words.');
        check(JSON.stringify(target) === before, 'Stored memory was modified.');
        if (c.operator === 'omit_step') check(out.length === parts.length - 1 && out.every(s => parts.includes(s)), 'omit_step mismatch.');
        else if (c.operator === 'swap_steps') check(out.length === parts.length && [...out].sort().join() === [...parts].sort().join() && out.join() !== parts.join(), 'swap_steps mismatch.');
        else if (c.operator === 'confuse_related') check(c.text === peer.content, 'confuse_related mismatch.');
        else if (c.operator === 'approximate') check(target.content.startsWith(c.text.slice(0, -1)), 'approximate mismatch.');
        else throw new Error(`Unexpected operator ${c.operator}.`);
        return `${c.operator}: ${c.detail}`;
      }, 'Corruption operators');
    }
    test('Pending conflict triggers a clarification question', () => { const e = make(); e.transact({ mode: 'teach', concept: 'tavi', content: 'tea moment' }); e.transact({ mode: 'teach', concept: 'tavi', content: 'coffee moment' }); const r = e.transact({ mode: 'next' }); check(r.trace.action === 'clarify' && r.message.includes('coffee moment') && e.profile().memories[0].content === 'tea moment', 'No clarification.'); e.transact({ mode: 'confirm', concept: 'tavi' }); check(e.profile().memories[0].pendingContent === null, 'Confirm did not resolve the conflict.'); return 'Asks which version is right; Confirm keeps the first.'; }, 'Clarification & curiosity');
    test('Quoted mention becomes a curiosity question', () => { const e = make(); e.transact({ mode: 'teach', concept: 'kaya toast', content: 'toast with “kaya”, served with “kopi”' }); for (let t = 0; t < 3; t++) e.transact({ mode: 'ask', concept: 'kaya toast' }); const r = e.transact({ mode: 'next' }); check(r.trace.action === 'ask_to_learn' && r.trace.concept === 'kaya' && r.trace.allowedKnowledge.length === 0, 'Mention not explored.'); return 'Exploration turn asks about “kaya”, mentioned but never taught.'; }, 'Clarification & curiosity');
    test('Keyword graph links only related concepts', () => { const e = make(); e.transact({ mode: 'teach', concept: 'kopi', content: 'strong coffee with condensed milk' }); e.transact({ mode: 'teach', concept: 'kopi o', content: 'black coffee with sugar' }); e.transact({ mode: 'teach', concept: 'shiok', content: 'very satisfying' }); const [a, b, c] = e.profile().memories; check(a.related.includes(b.id) && !a.related.includes(c.id) && c.related.length === 0, 'Graph edges mismatch.'); return 'kopi ↔ kopi o share “coffee”; shiok stays unlinked.'; }, 'Clarification & curiosity');
    const groups = [...new Set(results.map(r => r.group))].map(group => { const rows = results.filter(r => r.group === group); return { group, passed: rows.filter(r => r.pass).length, total: rows.length }; });
    return { version: VERSION, mode: 'deterministic controller; no live LLM requests', passed: results.filter(r => r.pass).length, total: results.length, groups, tests: results, limitation: 'Passing these finite scripted tests is not proof of open-ended language understanding, live-provider safety, clinical benefit, or production-grade access control.' };
  }
  return { VERSION, TOPICS, WORDING, RECALL_PLAN, Engine, newState, parseMessage, policyScore, policyAction, recallOutcome, draw, corrupt, keywords, quotedTerms, safeCorruption, renderMessage, summarizeMetadata, simulate, detect, monteCarlo, sensitivity, functionalEvaluation, rng, mean, sd };
});
