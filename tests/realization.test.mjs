import test from 'node:test';
import assert from 'node:assert/strict';
import C from '../src/core.js';
import { Provider } from '../src/llm.mjs';
import { buildRealizationPlan, validateRealization } from '../src/realization.mjs';

test('generated phrasing changes only the current reply and survives state restoration', () => {
  const engine = new C.Engine();
  const { trace } = engine.transact({ mode: 'teach', concept: '澄芽', content: '一起喝茶聊天的时刻' });
  const before = structuredClone(engine.profile().memories);
  const speech = '哦，原来你们把一起喝茶、聊聊天的时光叫作澄芽呀，我理解对了吗？';
  assert.equal(validateRealization({ action: 'teach', text: speech }, trace), speech);
  assert.equal(engine.applyRealization(speech, trace.interactionId), true);
  assert.deepEqual(engine.profile().memories, before);
  const restored = new C.Engine(engine.export());
  assert.equal(restored.profile().history.at(-1).text, speech);
  assert.equal(restored.profile().lastTrace.realization, 'api-generated-response');
  engine.transact({ mode: 'ask', concept: '澄芽' });
  assert.equal(engine.applyRealization(speech, trace.interactionId), false, 'A delayed reply must not overwrite the next turn');
});

test('impaired recall request contains neither original memory nor omitted text nor conversation history', async () => {
  const engine = new C.Engine();
  engine.transact({ mode: 'teach', concept: '月铃礼', content: '先系蓝绳; 再敲三下铜铃' });
  engine.transact({ mode: 'recall', concept: '月铃礼', forceError: true });
  const trace = engine.profile().lastTrace, plan = buildRealizationPlan(trace, engine.profile());
  assert.equal(plan.language, 'Chinese');
  assert.equal(plan.latestMessage, null);
  assert.deepEqual(plan.permittedFacts, ['先系蓝绳']);
  let wire;
  const provider = new Provider({ baseURL: 'https://provider.invalid/v1', apiKey: 'DUMMY', model: 'synthetic' }, async (_url, options) => {
    wire = options.body;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ action: 'controlled_recall', text: '我只想起先系蓝绳，后面还要做什么呀？' }) } }] }) };
  });
  const response = await provider.realize(plan);
  assert.ok(validateRealization(response, trace));
  assert.ok(!wire.includes('铜铃'));
  assert.ok(!wire.includes('history'));
  assert.equal(engine.profile().memories[0].content, '先系蓝绳; 再敲三下铜铃');
});

test('recall validator rejects repairing omissions or restoring a deliberately swapped order', () => {
  const trace = { action: 'controlled_recall', allowedKnowledge: ['系蓝绳'], corruption: { operator: 'omit_step', omitted: '敲铜铃' } };
  assert.equal(validateRealization({ action: trace.action, text: '系蓝绳，然后敲铜铃，对吗？' }, trace), null);
  assert.ok(validateRealization({ action: trace.action, text: '我记得要系蓝绳，后面是什么来着？' }, trace));
  const swapped = { ...trace, allowedKnowledge: ['敲铜铃; 系蓝绳'], corruption: { operator: 'swap_steps' } };
  assert.equal(validateRealization({ action: swapped.action, text: '系蓝绳; 敲铜铃，对吗？' }, swapped), null);
  assert.ok(validateRealization({ action: swapped.action, text: '敲铜铃; 系蓝绳，是这个顺序吗？' }, swapped));
});

test('unknown and pending concepts do not acquire confirmed facts in the speech plan', () => {
  const engine = new C.Engine();
  engine.transact({ mode: 'teach', concept: 'private', content: 'an unrelated private lesson' });
  let { trace } = engine.transact({ mode: 'ask', concept: '月铃礼' });
  let plan = buildRealizationPlan(trace, engine.profile());
  assert.deepEqual(plan.permittedFacts, []);
  assert.ok(!JSON.stringify(plan).includes('private lesson'));
  ({ trace } = engine.transact({ mode: 'uncertain', concept: '月铃礼', content: '系蓝绳' }));
  plan = buildRealizationPlan(trace, engine.profile());
  assert.equal(plan.action, 'clarify');
  assert.equal(plan.pendingCandidate, '系蓝绳');
  assert.deepEqual(plan.permittedFacts, []);
  engine.switchProfile('learner-b');
  ({ trace } = engine.transact({ mode: 'ask', concept: '月铃礼' }));
  assert.ok(!JSON.stringify(buildRealizationPlan(trace, engine.profile())).includes('系蓝绳'));
});

test('speech cannot return a different action, memory patch, empty reply, or omit a required question', () => {
  const trace = { action: 'ask_to_learn', allowedKnowledge: [] };
  for (const candidate of [null, [], { action: 'recall', text: 'It means tea.' }, { action: trace.action, text: '' },
    { action: trace.action, text: 'Tell me more?', memory: { content: 'invented' } },
    { action: trace.action, text: 'I already know.' }, { action: trace.action, text: 'x'.repeat(2001) }]) {
    assert.equal(validateRealization(candidate, trace), null);
  }
  assert.ok(validateRealization({ action: trace.action, text: '这个词我还没学过，你愿意教教我吗？' }, trace));
});

test('a model-classified conversational remark cannot be reinterpreted as a memory write', () => {
  const engine = new C.Engine();
  const candidate = C.validateIntent({ mode: 'chat', content: 'invented' }, 'tavi means tea is just an example sentence');
  assert.deepEqual(candidate, { mode: 'chat', text: 'tavi means tea is just an example sentence' });
  const turn = engine.transact(candidate, Date.now(), { interpreted: true });
  assert.equal(turn.trace.action, 'help');
  assert.equal(engine.profile().memories.length, 0);
});

test('Groq Qwen speech schema fixes the controller action while leaving text generative', async () => {
  let request;
  const p = new Provider({ baseURL: 'https://api.groq.com/openai/v1', apiKey: 'DUMMY', model: 'qwen/qwen3.8-27b' }, async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ action: 'recall', text: '这是你们一起喝茶的时光。' }) } }] }) };
  });
  await p.realize({ action: 'recall', permittedFacts: ['一起喝茶的时光'] });
  assert.equal(request.response_format.type, 'json_schema');
  assert.equal(request.response_format.json_schema.strict, true);
  assert.deepEqual(request.response_format.json_schema.schema.properties.action.enum, ['recall']);
  assert.deepEqual(request.response_format.json_schema.schema.required, ['action', 'text']);
  assert.equal(request.response_format.json_schema.schema.additionalProperties, false);
  assert.equal(request.temperature, 0.6);
});
