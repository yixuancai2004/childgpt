import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import C from '../src/core.js';
for (const kind of ['conversation', 'learning']) test(`recorded ${kind} demo preserves actual frontend provenance and no session credentials`, async () => {
  const raw = await readFile(new URL(`../results/demos/${kind}.json`, import.meta.url), 'utf8');
  const demo = JSON.parse(raw);
  assert.equal(demo.schema, 'childgpt.frontend-demo.v1'); assert.equal(demo.kind, kind); assert.equal(demo.completed, true);
  assert.equal(demo.steps.length, kind === 'conversation' ? 3 : 5);
  assert.ok(!/sessionToken|localKey|accessToken|apiKey|gsk_/u.test(raw));
  const p = new C.Engine(demo.state).profile();
  assert.equal(p.history.length, demo.steps.length * 2);
  for (const [index, step] of demo.steps.entries()) {
    const reply = p.history[index * 2 + 1];
    assert.equal(reply.generation.source, 'llm');
    assert.equal(step.provider.wording, 'api-generated-response');
    assert.equal(reply.generation.model, step.provider.model);
    assert.equal(reply.text, step.message);
    assert.equal(reply.traceId, step.trace.interactionId);
  }
  if (kind === 'conversation') {
    assert.equal(demo.steps[1].input.text, 'I can tell you how to cook');
    assert.equal(p.memories.length, 0);
  } else {
    assert.equal(demo.steps[0].trace.action, 'ask_to_learn');
    assert.equal(demo.steps[2].input.forceError, true);
    assert.equal(demo.steps[2].trace.action, 'controlled_recall');
    assert.ok(demo.steps[2].memoryAfter[0].content.includes('再敲三下铜铃'));
    assert.ok(!demo.steps[2].message.includes('再敲三下铜铃'));
    assert.ok(p.memories[0].content.includes('先系红绳'));
    assert.ok(p.memories[0].content.includes('再敲三下铜铃'));
    assert.equal(p.memories[0].correctionHistory.length, 1);
    assert.equal(p.memories[0].learningCount, 2);
    assert.equal(p.memories[0].mastery, .55);
  }
});
