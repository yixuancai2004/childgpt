import test from 'node:test';
import assert from 'node:assert/strict';
import C from '../src/core.js';
import { buildRealizationPlan, validateRealization } from '../src/realization.mjs';

const say = (e, text) => e.transact({ mode: 'chat', text });
const INSTRUCTIONS = /what you would like me to learn|tavi means|meaning I should remember|想让我学习|教学任务|提供.*概念/iu;

test('offline social replies address greetings, identity, play and quiet without demanding lessons', () => {
  const e = new C.Engine();
  for (const [text, cue, expression] of [
    ['你好', 'greeting', /[嗨在来]/u],
    ['你叫什么名字？', 'identity', /Milo/u],
    ['我们玩个游戏吧', 'play', /玩/u],
    ['我今天有点难过', 'comfort', /听/u],
    ['不要总是问我问题', 'quiet', /不问/u],
    ['你说话太机械了', 'style', /随便聊聊/u],
    ['晚安', 'goodbye', /聊/u]
  ]) {
    const r = say(e, text);
    assert.equal(r.trace.action, 'help');
    assert.equal(r.trace.conversation.cue, cue);
    assert.equal(r.trace.conversation.language, 'Chinese');
    assert.match(r.message, expression);
    assert.doesNotMatch(r.message, INSTRUCTIONS);
    assert.equal(e.profile().memories.length, 0);
  }
});

test('generic fallback is short, language-matched and never the task instruction from the report', () => {
  for (const [text, language] of [['我没说清楚，那个呢？', 'Chinese'], ['Wait, what about that bit?', 'English']]) {
    const r = say(new C.Engine(), text);
    assert.equal(r.trace.conversation.language, language);
    assert.ok(r.message.length < 100);
    assert.doesNotMatch(r.message, INSTRUCTIONS);
  }
});

test('a model cannot turn a greeting, identity question or game invitation into a memory write', () => {
  for (const text of ['你好', '你叫什么名字？', '我们玩个游戏吧', '不要总是问我问题']) {
    assert.deepEqual(C.validateIntent({ mode: 'ask', concept: text }, text), { mode: 'chat', text });
  }
  assert.equal(C.parseMessage('月铃礼是什么意思？').mode, 'ask');
  assert.equal(C.parseMessage('月铃礼就是先系蓝绳').mode, 'teach');
});

test('social turns cannot strengthen the previous lesson through an unrelated yes', () => {
  const e = new C.Engine();
  say(e, 'tavi means a tea moment');
  say(e, '你好');
  assert.equal(C.dialogueContext(e.profile()).target, null);
  assert.equal(say(e, '对。').trace.action, 'help');
  assert.equal(e.profile().memories[0].learningCount, 1);
});

test('teaching and correction allow a natural declarative reply, without a forced confirmation question', () => {
  const e = new C.Engine();
  for (const text of ['澄芽就是一起喝茶的时光', '不对，是晚上一起喝茶的时光']) {
    const { trace } = say(e, text), plan = buildRealizationPlan(trace, e.profile());
    assert.equal(plan.requiresQuestion, false);
    assert.ok(validateRealization({ action: trace.action, text: '哦，原来是一起喝茶的时光呀。' }, trace));
    assert.doesNotMatch(e.profile().history.at(-1).text, /[?？]/u);
  }
});

test('social conversation context follows a story, excludes lessons and the provisional current reply', () => {
  let e = new C.Engine();
  let r = say(e, '今天看到一只小狗');
  e.applyRealization('它在做什么呀？', r.trace.interactionId);
  say(e, '秘密词就是蓝绳和铜铃');
  r = say(e, '它又跑回来啦');
  const plan = buildRealizationPlan(r.trace, e.profile());
  assert.deepEqual(plan.recentConversation, [
    { role: 'user', text: '今天看到一只小狗' },
    { role: 'assistant', text: '它在做什么呀？' }
  ]);
  assert.equal(plan.latestMessage, '它又跑回来啦');
  assert.deepEqual(plan.permittedFacts, []);
  assert.ok(!JSON.stringify(plan).includes('蓝绳'));
  e = new C.Engine(e.export());
  e.switchProfile('learner-b');
  r = say(e, '它又跑回来啦');
  assert.deepEqual(buildRealizationPlan(r.trace, e.profile()).recentConversation, []);
});

test('impaired and forgotten recalls never receive social history even if it contains the missing fact', () => {
  const e = new C.Engine(), start = Date.now();
  e.transact({ mode: 'teach', concept: '月铃礼', content: '先系蓝绳；再敲铜铃' }, start);
  e.transact({ mode: 'chat', text: '刚才说的铜铃，我还想聊聊' }, start, { interpreted: true });
  for (const input of [
    { mode: 'recall', concept: '月铃礼', forceError: true },
    { mode: 'ask', concept: '月铃礼' }
  ]) {
    const { trace } = e.transact(input, input.forceError ? start : start + 3 * 86400000);
    const plan = buildRealizationPlan(trace, e.profile());
    assert.deepEqual(plan.recentConversation, []);
    assert.equal(plan.latestMessage, null);
    assert.ok(!JSON.stringify(plan).includes('铜铃'));
  }
});

test('social context is bounded and contains only the active profile', () => {
  const e = new C.Engine();
  for (let i = 0; i < 8; i++) say(e, `story fragment ${i} ${'x'.repeat(1000)}`);
  const { trace } = say(e, 'what happened next?');
  const context = buildRealizationPlan(trace, e.profile()).recentConversation;
  assert.equal(context.length, 6);
  assert.ok(context.every(m => m.text.length <= 600));
});

test('legacy instruction-sheet replies are not recycled as conversational examples', () => {
  const e = new C.Engine();
  const old = say(e, 'hello');
  e.applyRealization('Could you explain what you would like me to learn or remember? You can say “tavi means tea”.', old.trace.interactionId);
  const { trace } = say(e, '你好');
  assert.deepEqual(buildRealizationPlan(trace, e.profile()).recentConversation, []);
});
