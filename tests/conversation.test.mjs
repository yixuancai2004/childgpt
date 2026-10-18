import test from 'node:test';
import assert from 'node:assert/strict';
import C from '../src/core.js';

const say = (engine, text) => engine.transact({ mode: 'chat', text });

test('Chinese chat teaches, recalls, corrects and confirms without selecting modes', () => {
  const e = new C.Engine();
  const lesson = say(e, '我们这里说的 tavi，就是大家一起喝茶的开心时刻。');
  assert.equal(lesson.trace.concept, 'tavi');
  assert.equal(lesson.trace.action, 'teach');
  const recalled = say(e, '你还记得 tavi 吗？');
  assert.equal(recalled.trace.action, 'uncertain_recall');
  assert.equal(recalled.trace.recall.band, 'medium');
  assert.equal(say(e, '不对，是大家一起喝咖啡的开心时刻。').trace.action, 'correct');
  assert.equal(say(e, '对，就是这个意思。').trace.inputMode, 'confirm');
  assert.equal(e.profile().memories.length, 1);
  assert.equal(e.profile().memories[0].correctionHistory.length, 1);
  assert.equal(e.profile().memories[0].content, '大家一起喝咖啡的开心时刻。');
  assert.ok(Math.abs(e.profile().memories[0].mastery - 0.7) < 1e-9);
});

test('an answer may omit the concept named in the previous question', () => {
  const e = new C.Engine();
  assert.equal(say(e, 'tavi 是什么意思？').trace.action, 'ask_to_learn');
  assert.equal(say(e, '就是大家一起喝茶的开心时刻。').trace.concept, 'tavi');
  assert.equal(e.profile().memories[0].content, '大家一起喝茶的开心时刻。');
  assert.equal(say(e, 'Yes, that is right.').trace.inputMode, 'confirm');
});

test('English natural definitions and contextual corrections preserve exact fact spans', () => {
  const e = new C.Engine();
  say(e, 'tavi means a happy moment over tea');
  say(e, 'No, it means a happy moment over coffee');
  const r = say(e, 'What does tavi mean?');
  assert.deepEqual(r.trace.allowedKnowledge, ['a happy moment over coffee']);
});

test('a correction without a previous concept requests clarification instead of inventing one', () => {
  const e = new C.Engine();
  for (const text of ['No, it means coffee moment', '不对，是喝咖啡。', 'Maybe it means coffee']) {
    assert.equal(say(e, text).trace.action, 'help');
    assert.equal(e.profile().memories.length, 0);
  }
});

test('a partial recipe correction does not discard the other taught steps', () => {
  const e = new C.Engine();
  say(e, 'tea recipe means boil water; add tea; add sugar');
  assert.equal(say(e, 'No, it is add sugar last').trace.action, 'help');
  assert.equal(e.profile().memories[0].content, 'boil water; add tea; add sugar');
});

test('uncertain new information cannot be recalled as fact before confirmation', () => {
  const e = new C.Engine();
  say(e, 'tavi 是什么意思？');
  const tentative = say(e, '我不确定，可能是早晨喝咖啡。');
  assert.equal(tentative.trace.action, 'clarify');
  assert.deepEqual(tentative.trace.allowedKnowledge, []);
  assert.equal(e.profile().memories[0].mastery, 0);
  assert.equal(say(e, 'tavi 是什么意思？').trace.action, 'clarify');
  assert.deepEqual(e.profile().lastTrace.allowedKnowledge, []);
  const confirmed = say(e, '对。');
  assert.deepEqual(confirmed.trace.allowedKnowledge, ['早晨喝咖啡。']);
  assert.equal(confirmed.trace.sourceInteraction, tentative.trace.interactionId);
  assert.equal(confirmed.trace.masteryAfter, 0.35);
});

test('a vague yes cannot resolve conflicting or uncertain versions of an existing fact', () => {
  for (const update of ['tavi means a coffee moment', 'Maybe it means a coffee moment']) {
    const e = new C.Engine();
    say(e, 'tavi means a tea moment');
    say(e, update);
    const original = structuredClone(e.profile().memories[0]);
    assert.equal(say(e, 'Yes, that is right.').trace.action, 'help');
    assert.deepEqual(e.profile().memories[0], original);
    say(e, 'No, it means a coffee moment');
    assert.equal(e.profile().memories[0].content, 'a coffee moment');
    assert.equal(e.profile().memories[0].pendingContent, null);
  }
});

test('yes after controlled corruption does not strengthen an unverified memory', () => {
  const e = new C.Engine();
  say(e, 'tea custom means choose a cup; share a story; say thank you');
  e.transact({ mode: 'recall', concept: 'tea custom', forceError: true });
  assert.equal(say(e, 'Yes.').trace.action, 'help');
  assert.equal(e.profile().memories[0].mastery, 0.35);
});

test('conversation references survive restoration and remain isolated between profiles', () => {
  let e = new C.Engine();
  say(e, 'tavi 是什么意思？');
  e = new C.Engine(e.export());
  say(e, '就是早晨喝茶。');
  e.switchProfile('learner-b');
  assert.equal(C.dialogueContext(e.profile()).target, null);
  assert.equal(say(e, '对，就是这个意思。').trace.action, 'help');
  assert.equal(e.profile().memories.length, 0);
  e.switchProfile('learner-a');
  assert.equal(say(e, '不对，是晚上喝茶。').trace.action, 'correct');
});

test('bounded context contains current-user evidence and is independent of mutable state', () => {
  const e = new C.Engine();
  for (let i = 0; i < 12; i++) say(e, `word-${i} means a shared synthetic meaning ${i}`);
  const context = C.dialogueContext(e.profile(), e.profile().memories.map(m => m.concept).join(' '));
  assert.ok(context.memories.length <= 8);
  assert.equal(context.recentMessages.length, 6);
  assert.equal(context.memories[0].id, context.target.memoryId);
  context.memories[0].content = 'tampered';
  assert.notEqual(e.profile().memories.at(-1).content, 'tampered');
});
