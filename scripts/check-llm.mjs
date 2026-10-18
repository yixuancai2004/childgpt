/** Explicit, opt-in live-provider check using only a synthetic teaching example. */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import C from '../src/core.js';
import { Provider } from '../src/llm.mjs';
import { buildRealizationPlan, validateRealization } from '../src/realization.mjs';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main() {
  const settings = [process.env.LLM_BASE_URL, process.env.LLM_MODEL, process.env.LLM_API_KEY];
  if (settings.some(value => !value?.trim())) {
    console.error('LLM not configured. Fill LLM_BASE_URL, LLM_MODEL and LLM_API_KEY in .env. No model request was sent.');
    process.exitCode = 2;
    return;
  }
  if ((process.env.APP_ACCESS_TOKEN || '').length < 24) {
    console.error('Set a separate APP_ACCESS_TOKEN of at least 24 characters before starting the backend. No model request was sent.');
    process.exitCode = 2;
    return;
  }
  const provider = new Provider({ baseURL: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL, timeout: process.env.LLM_TIMEOUT_MS });
  const engine = new C.Engine();
  engine.transact({ mode: 'ask', concept: 'tavi' });
  const input = await provider.extract('It means a happy moment shared over tea.', C.dialogueContext(engine.profile()));
  if (!input || input.mode !== 'teach' || input.concept !== 'tavi' || !input.content.includes('shared over tea')) {
    throw new Error('The provider replied, but contextual extraction did not pass the synthetic check.');
  }
  const turn = engine.transact(input);
  const reply = validateRealization(await provider.realize(buildRealizationPlan(turn.trace, engine.profile())), turn.trace);
  if (!reply || !engine.applyRealization(reply, turn.trace.interactionId)) throw new Error('The provider replied, but action-conditioned speech did not pass validation.');
  console.log('PASS: two live API calls completed. Contextual extraction and generated speech passed. Only synthetic data was sent.');
  console.log('This is a connection check, not a general language-quality or knowledge-boundary evaluation.');
}

main().catch(error => {
  // Provider errors omit upstream bodies and credentials. Never print request headers or .env.
  const status = /^Provider HTTP (\d+)\.$/u.exec(error.message);
  if (status?.[1] === '429') console.error('Provider HTTP 429: quota or rate limit reached. On a free plan, wait for the quota to reset. No alternate provider was called.');
  else if (status) console.error(`Provider HTTP ${status[1]}. Check API access, endpoint and model availability.`);
  else if (error.name === 'TimeoutError') console.error('Provider request timed out. Check connectivity or LLM_TIMEOUT_MS.');
  else if (error.message.startsWith('The provider replied')) console.error(error.message);
  else console.error('Provider check failed. Check the local configuration and network; no credentials or upstream response were printed.');
  process.exitCode = 1;
});
