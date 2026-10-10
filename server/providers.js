// Model providers. Each streams text through onText and resolves to
// { text, usage: { in, out } }. When no real provider is reachable, `simulate`
// stands in so the office still runs.
import Anthropic from '@anthropic-ai/sdk';

const env = process.env;
const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export const PROVIDERS = {
  ollama: {
    label: 'Ollama',
    model: env.OLLAMA_MODEL || 'llama3.2',
    url: (env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    price: { in: 0, out: 0 }, // local
  },
  mistral: {
    label: 'Mistral',
    model: env.MISTRAL_MODEL || 'mistral-small-latest',
    price: { in: num(env.MISTRAL_PRICE_IN, 0.1), out: num(env.MISTRAL_PRICE_OUT, 0.3) }, // $ per 1M tokens
  },
  claude: {
    label: 'Claude',
    model: env.CLAUDE_MODEL || 'claude-opus-5-5',
    price: { in: num(env.CLAUDE_PRICE_IN, 4), out: num(env.CLAUDE_PRICE_OUT, 20) },
  },
};

export function costOf(provider, usage) {
  const p = PROVIDERS[provider]?.price;
  if (!p || !usage) return 0;
  return (usage.in * p.in + usage.out * p.out) / 1e6;
}

export async function checkAvailability() {
  const out = {};

  try {
    const res = await fetch(`${PROVIDERS.ollama.url}/api/tags`, { signal: AbortSignal.timeout(1500) });
    const { models = [] } = await res.json();
    const want = PROVIDERS.ollama.model;
    const has = models.some((m) => m.name === want || m.name.split(':')[0] === want);
    out.ollama = has
      ? { available: true }
      : { available: false, reason: `running, but model "${want}" not pulled (ollama pull ${want})` };
  } catch {
    out.ollama = { available: false, reason: `not reachable at ${PROVIDERS.ollama.url}` };
  }

  out.mistral = env.MISTRAL_API_KEY ? { available: true } : { available: false, reason: 'MISTRAL_API_KEY not set' };
  out.claude = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN
    ? { available: true }
    : { available: false, reason: 'ANTHROPIC_API_KEY not set' };

  return out;
}

async function* lines(body) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield line;
    }
  }
  if (buf.trim()) yield buf.trim();
}

async function ollama({ system, prompt, onText, signal }) {
  const p = PROVIDERS.ollama;
  const res = await fetch(`${p.url}/api/chat`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: p.model,
      stream: true,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  let text = '';
  let usage = { in: 0, out: 0 };
  for await (const line of lines(res.body)) {
    const j = JSON.parse(line);
    if (j.error) throw new Error(`Ollama: ${j.error}`);
    if (j.message?.content) { text += j.message.content; onText(j.message.content); }
    if (j.done) usage = { in: j.prompt_eval_count || 0, out: j.eval_count || 0 };
  }
  return { text, usage };
}

async function mistral({ system, prompt, onText, signal }) {
  const p = PROVIDERS.mistral;
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.MISTRAL_API_KEY}` },
    body: JSON.stringify({
      model: p.model,
      stream: true,
      max_tokens: 4000,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Mistral ${res.status}: ${await res.text()}`);
  let text = '';
  let usage = null;
  for await (const line of lines(res.body)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') break;
    const j = JSON.parse(data);
    const delta = j.choices?.[0]?.delta?.content;
    if (delta) { text += delta; onText(delta); }
    if (j.usage) usage = { in: j.usage.prompt_tokens || 0, out: j.usage.completion_tokens || 0 };
  }
  return { text, usage: usage || estimateUsage(system + prompt, text) };
}

let anthropic;
async function claude({ system, prompt, effort, onText, signal }) {
  anthropic ??= new Anthropic();
  const stream = anthropic.beta.messages.stream(
    {
      model: PROVIDERS.claude.model,
      max_tokens: 8000,
      // On a safety decline, the API re-runs the request on a suitable fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort },
      system,
      messages: [{ role: 'user', content: prompt }],
    },
    { signal },
  );
  let text = '';
  stream.on('text', (t) => { text += t; onText(t); });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') {
    throw new Error(`Claude declined${msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : ''}`);
  }
  return { text, usage: { in: msg.usage.input_tokens, out: msg.usage.output_tokens } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Stand-in used when no real provider is available, so the dashboard still works.
async function simulate({ system, prompt, onText, tier, agentName }) {
  const label = PROVIDERS[tier]?.label || tier;
  const text =
    `[Simulated ${label} response: connect a real model to get actual output]\n\n` +
    `${agentName} picked up: "${prompt.slice(0, 120)}${prompt.length > 120 ? '...' : ''}"\n\n` +
    `Plan:\n1. Break the request into parts\n2. Work through each part\n3. Check the result and report back\n\n` +
    `Result: placeholder output. Add OLLAMA, MISTRAL_API_KEY, or ANTHROPIC_API_KEY (see .env.example) for real work.`;
  for (const word of text.split(/(\s+)/)) {
    onText(word);
    await sleep(25 + Math.random() * 45);
  }
  return { text, usage: estimateUsage(system + prompt, text) };
}

function estimateUsage(input, output) {
  return { in: Math.ceil(input.length / 4), out: Math.ceil(output.length / 4) };
}

export async function generate(provider, opts) {
  switch (provider) {
    case 'ollama': return ollama(opts);
    case 'mistral': return mistral(opts);
    case 'claude': return claude(opts);
    default: return simulate(opts);
  }
}
