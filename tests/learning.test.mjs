import test from 'node:test';
import assert from 'node:assert/strict';
import C from '../src/core.js';
import { buildRealizationPlan } from '../src/realization.mjs';

const START = Date.parse('2026-10-01T10:00:00Z'), DAY = 86400000;
const FACT = '先系蓝绳；再敲三下铜铃；最后把灯挂在门边';
function child() {
  const e = new C.Engine();
  e.transact({ mode: 'teach', concept: '月铃礼', content: FACT }, START);
  return e;
}
const memory = e => e.profile().memories[0];

test('wall-clock decay changes retrievability, preserving the original fact and provenance', () => {
  const e = child(), before = structuredClone(memory(e));
  assert.equal(C.retention(memory(e), START).effectiveMastery, .35);
  assert.equal(C.retention(memory(e), START + 3 * DAY).effectiveMastery, .175);
  assert.equal(C.retention(memory(e), START + 6 * DAY).effectiveMastery, .0875);
  const r = e.transact({ mode: 'ask', concept: '月铃礼' }, START + 3 * DAY);
  assert.equal(r.trace.action, 'ask_to_learn');
  assert.deepEqual(r.trace.allowedKnowledge, []);
  assert.equal(r.trace.masteryBefore, .175);
  assert.equal(r.trace.masteryAfter, .175);
  assert.equal(r.trace.sourceInteraction, before.sourceInteraction);
  assert.deepEqual({ ...memory(e), lastReviewedTurn: before.lastReviewedTurn }, before);
  assert.match(r.message, /提醒我/);
});

test('direct questions, manual recall, autonomous review and invitations share one recall decision', () => {
  for (const days of [0, 3]) {
    const snapshot = child().export();
    const traces = ['ask', 'recall', 'next', 'invite'].map(mode => {
      const e = new C.Engine(snapshot);
      e.transact({ mode: 'settings', invitationsEnabled: true }, START);
      return e.transact({ mode, ...(['ask', 'recall'].includes(mode) ? { concept: '月铃礼' } : {}) }, START + days * DAY).trace;
    });
    for (const trace of traces.slice(1)) {
      assert.deepEqual(trace.recall, traces[0].recall);
      assert.equal(trace.action, traces[0].action);
      assert.deepEqual(trace.allowedKnowledge, traces[0].allowedKnowledge);
    }
  }
});

test('repetition strengthens current retrieval and slows future decay without resetting from stale strength', () => {
  const e = child();
  const r = e.transact({ mode: 'teach', concept: '月铃礼', content: FACT }, START + 3 * DAY);
  assert.equal(r.trace.masteryBefore, .175);
  assert.equal(memory(e).mastery, .35); // A fresh reminder restores at least the initial level.
  assert.equal(memory(e).stabilityDays, 4.5);
  assert.equal(memory(e).learningCount, 2);
  assert.equal(memory(e).lastReinforcedAt, new Date(START + 3 * DAY).toISOString());
  assert.ok(C.retention(memory(e), START + 6 * DAY).effectiveMastery > .175);
});

test('confirmation and correction reinforce the memory and preserve revision provenance', () => {
  const e = child();
  e.transact({ mode: 'confirm', concept: '月铃礼' }, START);
  assert.equal(memory(e).mastery, .5);
  assert.equal(memory(e).stabilityDays, 4.5);
  e.transact({ mode: 'correct', concept: '月铃礼', content: '先系红绳；再敲三下铜铃；最后把灯挂在门边' }, START + 4.5 * DAY);
  assert.equal(memory(e).mastery, .45);
  assert.equal(memory(e).stabilityDays, 6.75);
  assert.equal(memory(e).learningCount, 3);
  assert.equal(memory(e).correctionHistory[0].previous, FACT);
  assert.equal(memory(e).sourceInteraction, e.profile().lastTrace.interactionId);
});

test('queries, model speech, greetings and skipped invitations cannot reinforce a memory', () => {
  const e = child(), before = structuredClone(memory(e));
  for (let i = 0; i < 12; i++) e.transact({ mode: 'ask', concept: '月铃礼' }, START + DAY);
  e.applyRealization('能再提醒我一下吗？', e.profile().lastTrace.interactionId);
  e.transact({ mode: 'chat', text: 'hello' }, START + DAY);
  e.transact({ mode: 'settings', invitationsEnabled: true }, START + DAY);
  e.transact({ mode: 'invite' }, START + DAY);
  e.transact({ mode: 'skip' }, START + DAY);
  assert.deepEqual({ ...memory(e), lastReviewedTurn: before.lastReviewedTurn }, before);
  assert.equal(C.developmentStatus(e.profile()).id, 'discovering');
});

test('pending and conflicting facts earn no learning credit', () => {
  const e = child(), before = structuredClone(memory(e));
  e.transact({ mode: 'teach', concept: '月铃礼', content: 'different version' }, START + DAY);
  assert.equal(memory(e).learningCount, before.learningCount);
  assert.equal(memory(e).lastReinforcedAt, before.lastReinforcedAt);
  e.transact({ mode: 'uncertain', concept: '星礼', content: 'uncertain fact' }, START + DAY);
  assert.equal(C.developmentStatus(e.profile()).known, 1);
  e.transact({ mode: 'confirm', concept: '星礼' }, START + DAY);
  assert.equal(e.profile().memories[1].learningCount, 1);
  assert.equal(e.profile().memories[1].stabilityDays, 3);
});

test('a repeated bare agreement cannot farm learning credit', () => {
  const e = child();
  assert.equal(e.transact({ mode: 'chat', text: '对。' }, START).trace.inputMode, 'confirm');
  assert.equal(e.transact({ mode: 'chat', text: '对。' }, START).trace.action, 'help');
  assert.equal(memory(e).learningCount, 2);
});

test('stages require learned breadth and explicit reinforcement, persist and stay profile-specific', () => {
  let e = new C.Engine();
  for (let i = 0; i < 6; i++) {
    e.transact({ mode: 'teach', concept: `word-${i}`, content: `shared tradition ${i}` }, START);
    e.transact({ mode: 'teach', concept: `word-${i}`, content: `shared tradition ${i}` }, START);
    if (i === 2) assert.equal(C.developmentStatus(e.profile()).id, 'practising');
  }
  assert.equal(C.developmentStatus(e.profile()).id, 'practising');
  for (let i = 0; i < 6; i++) e.transact({ mode: 'confirm', concept: `word-${i}` }, START);
  assert.equal(C.developmentStatus(e.profile()).id, 'connecting');
  assert.deepEqual(e.profile().development.milestones.map(m => m.stage), ['practising', 'connecting']);
  e = new C.Engine(e.export());
  const r = e.transact({ mode: 'ask', concept: 'word-0' }, START + 90 * DAY);
  assert.equal(r.trace.action, 'ask_to_learn');
  assert.equal(r.trace.development.id, 'connecting');
  e.switchProfile('learner-b');
  assert.equal(C.developmentStatus(e.profile()).id, 'discovering');
  assert.equal(e.profile().memories.length, 0);
  e.resetProfile('learner-a');
  assert.equal(C.developmentStatus(e.profile('learner-a')).id, 'discovering');
});

test('one heavily repeated concept cannot unlock later stages; strength and stability are capped', () => {
  const e = child();
  for (let i = 0; i < 40; i++) e.transact({ mode: 'confirm', concept: '月铃礼' }, START);
  assert.equal(memory(e).mastery, 1);
  assert.equal(memory(e).stabilityDays, 90);
  assert.equal(C.developmentStatus(e.profile()).id, 'discovering');
});

test('follow-up questions become richer by stage without adding knowledge', () => {
  for (const stage of ['discovering', 'practising', 'connecting']) {
    const e = child();
    e.transact({ mode: 'teach', concept: '星铃礼', content: '敲铜铃' }, START);
    memory(e).related = [e.profile().memories[1].id];
    e.profile().memories.forEach(m => { m.mastery = 1; });
    e.profile().development.stage = stage;
    let r;
    for (let i = 0; i < 20; i++) { r = e.transact({ mode: 'next' }, START); if (r.trace.recall?.outcome === 'correct') break; }
    assert.equal(r.trace.action, stage === 'discovering' ? 'recall' : 'follow_up');
    assert.equal(Boolean(r.trace.relatedConcept), stage === 'connecting');
    const plan = buildRealizationPlan(r.trace, e.profile());
    assert.equal(plan.learningStage.id, stage);
    assert.deepEqual(plan.permittedFacts, r.trace.allowedKnowledge);
  }
});

test('forgotten recall sends no original fact or message to the speech model', () => {
  const e = child();
  const r = e.transact({ mode: 'ask', concept: '月铃礼', text: `你记得${FACT}吗？` }, START + 3 * DAY);
  const plan = buildRealizationPlan(r.trace, e.profile());
  assert.deepEqual(plan.permittedFacts, []);
  assert.equal(plan.latestMessage, null);
  assert.ok(!JSON.stringify(plan).includes(FACT));
  assert.match(plan.direction, /taught you this before/);
});

test('time-aware review prioritizes the more decayed of otherwise identical memories', () => {
  const e = child();
  e.transact({ mode: 'teach', concept: 'newer', content: FACT }, START + 3 * DAY);
  e.profile().memories.forEach(m => { m.lastReviewedTurn = e.profile().turn; });
  const r = e.transact({ mode: 'next' }, START + 3 * DAY);
  assert.equal(r.trace.concept, '月铃礼');
  assert.ok(r.trace.candidates[0].score > r.trace.candidates[1].score);
});

test('v1.0 and v1.1 snapshots migrate without losing facts, history or corrections', () => {
  for (const version of ['1.0.0', '1.1.0']) {
    const e = child();
    e.transact({ mode: 'correct', concept: '月铃礼', content: 'corrected fact' }, START + DAY);
    const old = e.export(), p = old.profiles['learner-a'], m = p.memories[0];
    old.version = version;
    delete p.development;
    for (const field of ['lastReinforcedAt', 'stabilityDays', 'learningCount']) delete m[field];
    const migrated = new C.Engine(old);
    assert.equal(migrated.state.version, C.VERSION);
    for (const field of ['content', 'mastery', 'sourceInteraction', 'correctionHistory']) assert.deepEqual(memory(migrated)[field], m[field]);
    assert.deepEqual(migrated.profile().history, p.history);
    assert.equal(memory(migrated).lastReinforcedAt, m.correctionHistory[0].at);
    assert.equal(memory(migrated).learningCount, 2);
    assert.deepEqual(new C.Engine(migrated.export()).export(), migrated.export());
  }
});

test('restoration preserves elapsed time, and backwards clocks cannot increase mastery or rewind reinforcement', () => {
  const e = new C.Engine(child().export());
  assert.equal(e.transact({ mode: 'recall', concept: '月铃礼' }, START + 3 * DAY).trace.masteryAfter, .175);
  assert.equal(C.retention(memory(e), START - DAY).effectiveMastery, .35);
  e.transact({ mode: 'confirm', concept: '月铃礼' }, START - DAY);
  assert.equal(memory(e).lastReinforcedAt, new Date(START).toISOString());
});

test('Chinese controlled omission preserves the stored full sequence', () => {
  const e = child();
  const r = e.transact({ mode: 'recall', concept: '月铃礼', forceError: true }, START);
  assert.equal(r.trace.action, 'controlled_recall');
  assert.equal(r.trace.corruption.omitted, '最后把灯挂在门边');
  assert.equal(memory(e).content, FACT);
});
