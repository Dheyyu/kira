// Cost-aware model routing. Scores how demanding a task is (0..1) and picks the
// cheapest provider tier that should handle it, then orders fallbacks.

export const TIERS = ['ollama', 'mistral', 'claude']; // cheapest -> most capable
export const THRESHOLDS = { mistral: 0.35, claude: 0.7 }; // score >= threshold escalates

const HARD = [
  'architect', 'architecture', 'design a', 'system design', 'refactor', 'debug', 'optimize', 'strategy',
  'analyze', 'analysis', 'trade-off', 'tradeoff', 'prove', 'security', 'algorithm', 'migrate', 'plan',
  'multi-step', 'in depth', 'in-depth', 'comprehensive', 'detailed', 'evaluate', 'reason', 'why does',
];
const EASY = [
  'summarize', 'summary', 'rename', 'list', 'translate', 'format', 'classify', 'fix typo', 'spell',
  'rewrite', 'shorten', 'tldr', 'one line', 'one-line', 'quick', 'simple', 'title', 'subject line', 'tag',
];

const clamp = (v) => Math.max(0, Math.min(1, v));
const countHits = (text, words) => words.filter((w) => text.includes(w));

export function scoreTask(text, { level = 1, stats = {} } = {}) {
  const t = text.toLowerCase();
  const words = t.split(/\s+/).filter(Boolean).length;
  const reasons = [];
  let score = 0.3;

  if (words > 150) { score += 0.2; reasons.push('long brief'); }
  else if (words > 60) { score += 0.1; reasons.push('medium brief'); }
  else if (words < 15) { score -= 0.1; reasons.push('short'); }

  const hard = countHits(t, HARD);
  if (hard.length) { score += Math.min(0.4, hard.length * 0.15); reasons.push(`hard: ${hard.slice(0, 3).join(', ')}`); }

  const easy = countHits(t, EASY);
  if (easy.length) { score -= Math.min(0.3, easy.length * 0.12); reasons.push(`easy: ${easy.slice(0, 3).join(', ')}`); }

  if (/```|\bfunction\b|=>|class \w+|def \w+/.test(text)) { score += 0.1; reasons.push('contains code'); }
  if (/\n\s*\d+[.)]\s|\bthen\b|\band also\b/.test(t)) { score += 0.1; reasons.push('multi-step'); }

  // Experienced agents (with a trained playbook) can get by on cheaper models.
  const exp = Math.min(0.1, (level - 1) * 0.02);
  if (exp > 0) { score -= exp; reasons.push(`agent Lv${level}`); }

  // Learned from feedback: if the tier this would land on keeps getting thumbs-down
  // for this agent, push the task up a tier.
  const tier = tierFor(clamp(score));
  const s = stats[tier];
  if (tier !== 'claude' && s && s.good + s.bad >= 3 && s.bad / (s.good + s.bad) > 0.4) {
    score += 0.2;
    reasons.push(`${tier} underperforming here`);
  }

  return { score: Math.round(clamp(score) * 100) / 100, reasons };
}

export function tierFor(score) {
  if (score >= THRESHOLDS.claude) return 'claude';
  if (score >= THRESHOLDS.mistral) return 'mistral';
  return 'ollama';
}

// Returns { score, reasons, desired, candidates } where candidates is the ordered list
// of available providers to try. Escalates to a stronger tier before downgrading.
export function route(text, { level, stats, available, override }) {
  const { score, reasons } = scoreTask(text, { level, stats });
  const desired = override && TIERS.includes(override) ? override : tierFor(score);
  const i = TIERS.indexOf(desired);
  const order = [desired, ...TIERS.slice(i + 1), ...TIERS.slice(0, i).reverse()];
  const candidates = order.filter((p) => available[p]);
  if (override) reasons.unshift(`manual: ${override}`);
  return { score, reasons, desired, candidates };
}

export function effortFor(score) {
  return score >= 0.85 ? 'high' : score >= 0.6 ? 'medium' : 'low';
}
