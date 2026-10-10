import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreTask, route, tierFor } from '../server/router.js';

const all = { ollama: true, mistral: true, claude: true };

test('simple tasks go to the cheapest tier', () => {
  const r = route('Summarize this paragraph in one line', { level: 1, stats: {}, available: all });
  assert.equal(r.desired, 'ollama');
  assert.deepEqual(r.candidates, ['ollama', 'mistral', 'claude']);
});

test('hard, multi-step tasks go to Claude', () => {
  const r = route('Design a system architecture for our billing service, analyze the security trade-offs, then plan the migration', { level: 1, stats: {}, available: all });
  assert.equal(r.desired, 'claude');
});

test('unavailable tiers escalate first, then fall back down', () => {
  const r = route('Summarize this', { level: 1, stats: {}, available: { ollama: false, mistral: false, claude: true } });
  assert.deepEqual(r.candidates, ['claude']);
  const r2 = route('Design a system architecture and analyze trade-offs then plan it', { level: 1, stats: {}, available: { ollama: true, mistral: true, claude: false } });
  assert.deepEqual(r2.candidates, ['mistral', 'ollama']);
});

test('manual override wins', () => {
  const r = route('Summarize this', { level: 1, stats: {}, available: all, override: 'claude' });
  assert.equal(r.desired, 'claude');
});

test('repeated thumbs-down on a tier pushes tasks up', () => {
  const text = 'Write a short reply to this customer question about pricing';
  const base = scoreTask(text, { level: 1, stats: {} });
  const tier = tierFor(base.score);
  const bumped = scoreTask(text, { level: 1, stats: { [tier]: { good: 0, bad: 3 } } });
  assert.ok(bumped.score > base.score);
});

test('experienced agents score slightly lower', () => {
  const text = 'Write a short reply to this customer question about pricing';
  assert.ok(scoreTask(text, { level: 5 }).score < scoreTask(text, { level: 1 }).score);
});
