// Side panel and top bar. Re-rendered from each 'state' event.

const $ = (sel) => document.querySelector(sel);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => (n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${(n || 0).toFixed(2)}`);
const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

const openOutputs = new Set();
let state = null;

async function api(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export function initUI() {
  document.querySelectorAll('.tabs button').forEach((btn) =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.id !== `tab-${btn.dataset.tab}`; });
    }),
  );

  $('#composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#composer-error');
    err.hidden = true;
    try {
      await api('/api/tasks', { text: $('#task-text').value, agentId: $('#task-agent').value || undefined, model: $('#task-model').value || undefined });
      $('#task-text').value = '';
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
  $('#task-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#composer').requestSubmit();
  });

  $('#task-list').addEventListener('toggle', (e) => {
    const id = e.target.dataset?.task;
    if (id) e.target.open ? openOutputs.add(id) : openOutputs.delete(id);
  }, true);

  document.body.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id, rating } = btn.dataset;
    try {
      if (action === 'rate') {
        const task = state?.tasks.find((t) => t.id === id);
        await api(`/api/tasks/${id}/feedback`, { rating: task?.feedback === Number(rating) ? 0 : Number(rating) });
      } else if (action === 'train') {
        const input = document.querySelector(`#note-${id}`);
        await api(`/api/agents/${id}/train`, { note: input?.value || '' });
        if (input) input.value = '';
      } else if (action === 'refresh-models') {
        await api('/api/models/refresh');
      }
    } catch (ex) {
      alert(ex.message);
    }
  });
}

export function renderState(s) {
  state = s;
  renderTop(s);
  renderAgentSelect(s);
  renderTasks(s);
  renderLab(s);
  renderModels(s);
  renderFeed(s);
}

function providerBadge(p, model) {
  return `<span class="badge ${p === 'sim' ? 'sim' : p}">${esc(model || p)}</span>`;
}

function renderTop(s) {
  const COLORS = { ollama: 'var(--ollama)', mistral: 'var(--mistral)', claude: 'var(--claude)' };
  $('#model-pills').innerHTML = Object.entries(s.models)
    .map(([p, m]) => `<span class="pill" title="${esc(m.available ? m.model : m.reason)}"><span class="dot ${m.available ? 'on' : ''}" style="${m.available ? `background:${COLORS[p]};color:${COLORS[p]}` : ''}"></span>${esc(m.label)}</span>`)
    .join('');
  const anyOnline = Object.values(s.models).some((m) => m.available);
  $('#spend').innerHTML =
    `${anyOnline ? '' : '<span style="color:var(--mistral)">simulation mode</span> · '}` +
    `spent <b>${money(s.totals.spent)}</b> · saved vs all-Claude <b>${money(s.totals.saved)}</b> · ${s.totals.tasks} tasks`;
}

function renderAgentSelect(s) {
  const sel = $('#task-agent');
  if (sel.options.length > 1) return;
  for (const a of s.agents) sel.add(new Option(a.name, a.id));
}

function renderTasks(s) {
  const names = Object.fromEntries(s.agents.map((a) => [a.id, a]));
  $('#task-list').innerHTML = s.tasks.length
    ? s.tasks
        .map((t) => {
          const a = names[t.agentId];
          const r = t.routing;
          const route = r
            ? `<div class="route">score ${r.score} → ${esc(r.desired)}${r.reasons.length ? ` · ${esc(r.reasons.join(' · '))}` : ''}</div>`
            : '';
          const fails = t.attempts?.length
            ? `<div class="route">fallbacks: ${t.attempts.map((x) => `${esc(x.provider)} failed`).join(', ')}</div>`
            : '';
          const out = t.output
            ? `<details data-task="${t.id}" ${openOutputs.has(t.id) || t.status === 'running' ? 'open' : ''}><summary>Output</summary><pre class="output">${esc(t.output)}</pre></details>`
            : '';
          const foot =
            t.status === 'done'
              ? `<div class="card-foot">${t.usage ? `${t.usage.in + t.usage.out} tok · ${money(t.cost)}` : ''}${t.simulated ? ' · simulated' : ''}<span class="spacer"></span>
                 <button class="ghost ${t.feedback > 0 ? 'on' : ''}" data-action="rate" data-id="${t.id}" data-rating="1" title="Good: teaches the agent">👍</button>
                 <button class="ghost ${t.feedback < 0 ? 'on' : ''}" data-action="rate" data-id="${t.id}" data-rating="-1" title="Bad: router escalates next time">👎</button></div>`
              : t.status === 'error'
                ? `<div class="error">${esc(t.error)}</div>`
                : '';
          return `<div class="card">
            <div class="card-head"><span class="agent" style="color:${a?.color}">${esc(a?.name || t.agentId)}</span>
              <span class="status ${t.status}">${t.status}</span>${t.provider ? providerBadge(t.provider, t.model) : ''}<span class="spacer"></span><span>${ago(t.createdAt)}</span></div>
            <div class="card-text">${esc(t.text)}</div>${route}${fails}${out}${foot}</div>`;
        })
        .join('')
    : '<p class="muted">No tasks yet. Send one above and watch the agent get to work.</p>';
}

function renderLab(s) {
  // Keep any half-typed notes across re-renders.
  const drafts = {};
  let focused = document.activeElement?.id;
  document.querySelectorAll('#tab-lab input').forEach((i) => { drafts[i.id] = i.value; });

  $('#tab-lab').innerHTML =
    `<p class="muted">Agents train here: they turn your trainer notes and 👍-rated work into a playbook that becomes part of their instructions. Higher levels also let the router pick cheaper models for them.</p>` +
    s.agents
      .map((a) => {
        const pct = Math.round(((a.xp - a.xpLevel) / (a.xpNext - a.xpLevel)) * 100);
        const status = a.distilling ? 'training now…' : a.pendingTrain ? 'training queued' : a.state;
        return `<div class="card">
          <div class="card-head"><span class="agent" style="color:${a.color}">${esc(a.name)}</span><span>Lv ${a.level}</span><span class="spacer"></span><span>${esc(status)}</span></div>
          <div class="xp"><div style="width:${pct}%"></div></div>
          <div class="muted">${a.xp} / ${a.xpNext} XP · ${a.examples} rated example${a.examples === 1 ? '' : 's'}</div>
          <div class="muted" style="margin-top:6px">Playbook</div>
          <div class="playbook">${a.playbook ? esc(a.playbook) : '<span class="muted">Empty. Add notes or 👍 good work, then train.</span>'}</div>
          ${a.notes.length ? `<ul class="notes">${a.notes.slice(-5).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
          <div class="lab-form"><input id="note-${a.id}" placeholder="Trainer note, e.g. “Always end emails with a clear ask”"><button class="primary" data-action="train" data-id="${a.id}">Train</button></div>
        </div>`;
      })
      .join('');

  for (const [id, v] of Object.entries(drafts)) { const el = document.getElementById(id); if (el) el.value = v; }
  if (focused?.startsWith('note-')) document.getElementById(focused)?.focus();
}

function renderModels(s) {
  const counts = s.totals.byProvider || {};
  $('#tab-models').innerHTML =
    `<p class="muted">Each task gets a difficulty score from 0 to 1. Below ${s.thresholds.mistral} it goes to Ollama (local, free), up to ${s.thresholds.claude} to Mistral (cheap), and above that to Claude. If a model is offline or fails, the task moves up to a stronger model, or down when nothing stronger is available. Thumbs-down ratings push similar tasks up a tier.</p>` +
    Object.entries(s.models)
      .map(([p, m]) => `<div class="card">
        <div class="card-head">${providerBadge(p, m.label)}<span>${esc(m.model)}</span><span class="spacer"></span><span style="color:${m.available ? 'var(--ollama)' : 'var(--muted)'}">${m.available ? 'online' : 'offline'}</span></div>
        ${m.available ? '' : `<div class="muted" style="margin-top:6px">${esc(m.reason)}</div>`}
        <div class="muted" style="margin-top:6px">$${m.price.in} in / $${m.price.out} out per 1M tokens · ${counts[p] || 0} tasks run</div>
      </div>`)
      .join('') +
    (counts.sim ? `<p class="muted">${counts.sim} tasks ran in simulation mode.</p>` : '') +
    `<p><button class="ghost" data-action="refresh-models">Re-check models</button></p>`;
}

function renderFeed(s) {
  $('#tab-feed').innerHTML = s.log.length
    ? s.log.map((l) => `<div class="feed-item"><time>${new Date(l.t).toLocaleTimeString()}</time>${esc(l.text)}</div>`).join('')
    : '<p class="muted">Quiet so far.</p>';
}
