// The office simulation: agent movement and behavior, task execution, training,
// and cost accounting. Emits 'tick' (agent positions, frequent) and 'state'
// (everything, on change).
import { EventEmitter } from 'node:events';
import { STATIONS, AGENTS, WALK_SPEED, TICK_MS, BROADCAST_MS } from './config.js';
import { route, effortFor, TIERS, THRESHOLDS } from './router.js';
import { PROVIDERS, checkAvailability, generate, costOf } from './providers.js';
import { load, save } from './store.js';

const stationById = Object.fromEntries(STATIONS.map((s) => [s.id, s]));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const r2 = (n) => Math.round(n * 100) / 100;
const faceToward = (from, to) => Math.atan2(to.x - from.x, to.z - from.z); // model front is +z

// Total XP needed to reach level n: 0, 50, 150, 300, ...
const xpForLevel = (n) => 25 * n * (n - 1);
const levelFor = (xp) => Math.floor((1 + Math.sqrt(1 + (4 * xp) / 25)) / 2);

function deskSpot(st) {
  return { x: st.pos[0], z: st.pos[1] + 1.8, face: Math.PI };
}
function observeSpot(st, side) {
  const spot = { x: st.pos[0] + (side ? -1.9 : 1.9), z: st.pos[1] + 2.7 };
  spot.face = faceToward(spot, { x: st.pos[0], z: st.pos[1] + 1 });
  return spot;
}
function labSpot(index) {
  const lab = stationById.lab;
  const a = (index * 2 * Math.PI) / AGENTS.length + Math.PI / 6;
  const spot = { x: lab.pos[0] + 2.3 * Math.sin(a), z: lab.pos[1] + 2.3 * Math.cos(a) };
  spot.face = faceToward(spot, { x: lab.pos[0], z: lab.pos[1] });
  return spot;
}

export class Office extends EventEmitter {
  constructor() {
    super();
    const saved = load();
    this.tasks = saved.tasks || [];
    this.stats = saved.stats || {}; // stats[agentId][provider] = { good, bad }
    this.totals = saved.totals || { spent: 0, saved: 0, tasks: 0, byProvider: {} };
    this.log = saved.log || [];
    this.models = {};

    this.agents = AGENTS.map((def, index) => {
      const p = saved.agents?.[def.id] || {};
      const home = deskSpot(stationById[def.desk]);
      return {
        ...def,
        index,
        x: home.x,
        z: home.z,
        rot: home.face,
        state: 'idle',
        activity: 'At desk',
        target: null,
        plan: null,
        until: Date.now() + rand(3000, 8000),
        queue: [],
        currentTaskId: null,
        observing: null,
        xp: p.xp || 0,
        playbook: p.playbook || '',
        notes: p.notes || [],
        examples: p.examples || [],
        pendingTrain: !!p.pendingTrain,
        distilling: false,
      };
    });

    // Tasks that were in flight when the server stopped go back in the queue.
    for (const t of this.tasks) {
      if (t.status === 'queued' || t.status === 'running') {
        t.status = 'queued';
        t.output = '';
        this.agent(t.agentId)?.queue.push(t.id);
      }
    }
  }

  async start() {
    await this.refreshModels();
    setInterval(() => this.tick(), TICK_MS);
    setInterval(() => this.emit('tick', this.agents.map((a) => this.agentSnapshot(a))), BROADCAST_MS);
    setInterval(() => this.refreshModels(), 30_000);
  }

  agent(id) {
    return this.agents.find((a) => a.id === id);
  }

  async refreshModels() {
    const status = await checkAvailability();
    const before = JSON.stringify(this.models);
    this.models = status;
    if (JSON.stringify(status) !== before) this.changed();
    return status;
  }

  available() {
    return Object.fromEntries(TIERS.map((p) => [p, !!this.models[p]?.available]));
  }

  note(text) {
    this.log.unshift({ t: Date.now(), text });
    this.log.length = Math.min(this.log.length, 40);
    this.changed();
  }

  addXp(a, n, why) {
    const before = levelFor(a.xp);
    a.xp += n;
    const after = levelFor(a.xp);
    if (after > before) this.note(`${a.name} reached level ${after} (${why})`);
    this.changed();
  }

  // ---- tasks ---------------------------------------------------------------

  submitTask({ text, agentId, model }) {
    text = String(text || '').trim();
    if (!text) throw new Error('Task text is required');
    if (text.length > 20000) throw new Error('Task text is too long (max 20000 characters)');
    if (model && !TIERS.includes(model)) throw new Error(`Unknown model "${model}"`);
    const a = (agentId && this.agent(agentId)) || this.autoAssign(text);
    const task = {
      id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      text,
      agentId: a.id,
      override: model || null,
      status: 'queued',
      createdAt: Date.now(),
      output: '',
      attempts: [],
      feedback: 0,
    };
    this.tasks.unshift(task);
    this.trimTasks();
    a.queue.push(task.id);
    this.note(`New task for ${a.name}: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);
    return task;
  }

  autoAssign(text) {
    const t = text.toLowerCase();
    const load = (a) => a.queue.length + (a.state === 'working' ? 1 : 0);
    const ranked = this.agents
      .map((a) => ({ a, hits: a.keywords.filter((k) => t.includes(k)).length }))
      .sort((x, y) => y.hits - x.hits || load(x.a) - load(y.a));
    return ranked[0].a;
  }

  trimTasks() {
    const keep = [];
    let finished = 0;
    for (const t of this.tasks) {
      if (t.status === 'queued' || t.status === 'running' || finished++ < 100) keep.push(t);
    }
    this.tasks = keep;
  }

  startTask(a) {
    const id = a.queue.shift();
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    const r = route(task.text, {
      level: levelFor(a.xp),
      stats: this.stats[a.id] || {},
      available: this.available(),
      override: task.override,
    });
    task.routing = { score: r.score, reasons: r.reasons, desired: r.desired };
    task.status = 'running';
    task.startedAt = Date.now();
    a.state = 'working';
    a.currentTaskId = task.id;
    a.activity = 'Working';
    this.changed();
    this.runTask(a, task, r).catch((e) => console.error('runTask crashed:', e));
  }

  systemPrompt(a) {
    let s = `You are ${a.name}, an AI agent in the KIRA office. Role: ${a.role}`;
    if (a.playbook) s += `\n\nYour playbook (learned in the Skills Lab):\n${a.playbook}`;
    if (a.notes.length) s += `\n\nTrainer notes:\n${a.notes.slice(-10).map((n) => `- ${n}`).join('\n')}`;
    return `${s}\n\nBe concise and practical.`;
  }

  async runTask(a, task, r) {
    const candidates = r.candidates.length ? r.candidates : ['sim'];
    let result = null;
    for (const p of candidates) {
      task.provider = p;
      task.model = p === 'sim' ? `simulated ${PROVIDERS[r.desired].label}` : PROVIDERS[p].model;
      task.output = '';
      this.changed();
      try {
        result = await generate(p, {
          system: this.systemPrompt(a),
          prompt: task.text,
          effort: effortFor(r.score),
          tier: r.desired,
          agentName: a.name,
          onText: (t) => { task.output += t; },
          signal: AbortSignal.timeout(5 * 60_000),
        });
        break;
      } catch (e) {
        task.attempts.push({ provider: p, error: e.message });
        this.note(`${a.name}: ${PROVIDERS[p]?.label || p} failed (${e.message.slice(0, 80)})`);
        this.refreshModels();
      }
    }

    if (result) {
      const p = task.provider;
      task.status = 'done';
      task.usage = result.usage;
      task.cost = costOf(p, result.usage);
      task.simulated = p === 'sim';
      this.totals.spent += task.cost;
      if (p !== 'claude' && p !== 'sim') this.totals.saved += Math.max(0, costOf('claude', result.usage) - task.cost);
      this.totals.tasks++;
      this.totals.byProvider[p] = (this.totals.byProvider[p] || 0) + 1;
      this.addXp(a, 5, 'finished a task');
      this.note(`${a.name} finished a task with ${task.model}`);
    } else {
      task.status = 'error';
      task.error = task.attempts.at(-1)?.error || 'No provider could run this task';
    }
    task.finishedAt = Date.now();

    a.state = 'idle';
    a.currentTaskId = null;
    a.activity = 'At desk';
    a.until = Date.now() + rand(4000, 8000);
    this.changed();
  }

  feedback(taskId, rating) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task || task.status !== 'done') throw new Error('Only finished tasks can be rated');
    rating = Math.sign(Number(rating)) || 0;
    if (task.feedback === rating) return task;
    const a = this.agent(task.agentId);
    const s = ((this.stats[a.id] ||= {})[task.provider] ||= { good: 0, bad: 0 });
    if (task.feedback > 0) s.good--;
    if (task.feedback < 0) s.bad--;
    if (rating > 0) s.good++;
    if (rating < 0) s.bad++;
    if (rating > 0 && task.feedback === 0) {
      a.examples.push({ task: task.text.slice(0, 500), output: task.output.slice(0, 1500) });
      a.examples = a.examples.slice(-5);
      a.pendingTrain = true;
      this.addXp(a, 15, 'great feedback');
    }
    task.feedback = rating;
    this.changed();
    return task;
  }

  // ---- training ------------------------------------------------------------

  train(agentId, note) {
    const a = this.agent(agentId);
    if (!a) throw new Error('Unknown agent');
    note = String(note || '').trim().slice(0, 500);
    if (note) {
      a.notes.push(note);
      a.notes = a.notes.slice(-20);
    }
    a.pendingTrain = true;
    if (!a.queue.length && (a.state === 'idle' || a.state === 'observing')) this.goLab(a);
    this.note(`${a.name} was sent to the Skills Lab${note ? ' with a new note' : ''}`);
  }

  // Training = distilling trainer notes and highly rated work into the agent's
  // playbook (prompt-level learning; used as part of its system prompt).
  async distill(a) {
    a.distilling = true;
    a.pendingTrain = false;
    const avail = this.available();
    const provider = TIERS.find((p) => avail[p]); // cheapest available
    const material =
      (a.notes.length ? `Trainer notes:\n${a.notes.map((n) => `- ${n}`).join('\n')}\n\n` : '') +
      a.examples.map((e, i) => `Example ${i + 1} the user rated highly\nTask: ${e.task}\nOutput: ${e.output}`).join('\n\n');
    try {
      if (!material) return;
      if (!provider) {
        a.playbook = [...a.notes.map((n) => `- ${n}`), ...a.examples.map((e) => `- Match the approach used for: "${e.task.slice(0, 80)}"`)]
          .slice(0, 8).join('\n');
      } else {
        const res = await generate(provider, {
          system: 'You write concise playbooks for AI agents.',
          prompt:
            `Agent role: ${a.role}\n\nCurrent playbook:\n${a.playbook || '(empty)'}\n\n${material}\n\n` +
            'Write the updated playbook: at most 8 short bullet points the agent should follow. Keep earlier guidance that still applies. Output only the bullets.',
          effort: 'low',
          onText: () => {},
          signal: AbortSignal.timeout(2 * 60_000),
        });
        a.playbook = res.text.trim().slice(0, 2000);
        const cost = costOf(provider, res.usage);
        this.totals.spent += cost;
      }
      this.addXp(a, 20, 'completed training');
      this.note(`${a.name} updated their playbook${provider ? ` using ${PROVIDERS[provider].label}` : ''}`);
    } catch (e) {
      this.note(`${a.name}'s training failed: ${e.message.slice(0, 80)}`);
    } finally {
      a.distilling = false;
      this.changed();
    }
  }

  // ---- movement & behavior -------------------------------------------------

  goTo(a, spot, plan, activity) {
    a.target = spot;
    a.plan = plan;
    a.state = 'walking';
    a.activity = activity;
    a.observing = null;
    this.changed();
  }

  goDesk(a, activity = 'Walking back to desk') {
    this.goTo(a, deskSpot(stationById[a.desk]), { type: 'desk' }, activity);
  }

  goLab(a) {
    this.goTo(a, labSpot(a.index), { type: 'train' }, 'Heading to the Skills Lab');
  }

  arrive(a) {
    const plan = a.plan;
    a.rot = a.target.face;
    a.target = null;
    a.plan = null;
    const now = Date.now();
    if (plan.type === 'desk') {
      a.state = 'idle';
      a.activity = 'At desk';
      a.until = now + rand(6000, 12000);
    } else if (plan.type === 'observe') {
      const host = this.agents.find((o) => o.desk === plan.stationId);
      a.state = 'observing';
      a.observing = plan.stationId;
      a.until = now + rand(8000, 15000);
      a.activity = host?.state === 'working' ? `Watching ${host.name} work` : `Hanging out at ${stationById[plan.stationId].name}`;
    } else if (plan.type === 'train') {
      a.state = 'training';
      a.until = now + rand(10000, 14000);
      if (a.pendingTrain && !a.distilling) {
        a.activity = 'Training: turning feedback into a playbook';
        this.distill(a);
      } else {
        a.activity = 'Practicing in the Skills Lab';
      }
    }
    this.changed();
  }

  wander(a) {
    if (a.pendingTrain) return this.goLab(a);
    const others = this.agents.filter((o) => o !== a);
    const r = Math.random();
    if (r < 0.55) {
      const working = others.filter((o) => o.state === 'working');
      const host = working.length ? pick(working) : pick(others);
      const st = stationById[host.desk];
      this.goTo(a, observeSpot(st, a.index > host.index), { type: 'observe', stationId: st.id }, `Walking over to ${st.name}`);
    } else if (r < 0.75) {
      this.goLab(a);
    } else {
      a.until = Date.now() + rand(5000, 10000);
    }
  }

  finishVisit(a) {
    if (a.state === 'training') {
      if (!a.distilling) this.addXp(a, 5, 'practice');
    } else if (a.state === 'observing') {
      const host = this.agents.find((o) => o.desk === a.observing);
      if (host?.state === 'working') this.addXp(a, 3, 'learning by watching');
    }
    this.goDesk(a);
  }

  tick() {
    const now = Date.now();
    const step = (WALK_SPEED * TICK_MS) / 1000;
    for (const a of this.agents) {
      const hasWork = a.queue.length > 0;
      switch (a.state) {
        case 'walking': {
          if (hasWork && a.plan.type !== 'desk') {
            this.goDesk(a, 'Heading back: new task');
          }
          const dx = a.target.x - a.x;
          const dz = a.target.z - a.z;
          const d = Math.hypot(dx, dz);
          if (d <= step) {
            a.x = a.target.x;
            a.z = a.target.z;
            this.arrive(a);
          } else {
            a.x += (dx / d) * step;
            a.z += (dz / d) * step;
            a.rot = Math.atan2(dx, dz);
          }
          break;
        }
        case 'idle':
          if (hasWork) this.startTask(a);
          else if (now > a.until) this.wander(a);
          break;
        case 'observing':
        case 'training':
          if (hasWork) this.goDesk(a, 'Heading back: new task');
          else if (now > a.until) this.finishVisit(a);
          break;
      }
    }
  }

  // ---- snapshots -----------------------------------------------------------

  agentSnapshot(a) {
    const task = a.currentTaskId && this.tasks.find((t) => t.id === a.currentTaskId);
    const level = levelFor(a.xp);
    return {
      id: a.id,
      name: a.name,
      color: a.color,
      desk: a.desk,
      x: r2(a.x),
      z: r2(a.z),
      rot: r2(a.rot),
      state: a.state,
      activity: a.activity,
      observing: a.observing,
      level,
      xp: a.xp,
      xpLevel: xpForLevel(level),
      xpNext: xpForLevel(level + 1),
      queue: a.queue.length,
      current: task
        ? {
            id: task.id,
            text: task.text.slice(0, 200),
            provider: task.provider,
            model: task.model,
            tail: task.output.slice(-300),
          }
        : null,
    };
  }

  fullState() {
    return {
      stations: STATIONS,
      thresholds: THRESHOLDS,
      agents: this.agents.map((a) => ({
        ...this.agentSnapshot(a),
        role: a.role,
        playbook: a.playbook,
        notes: a.notes,
        examples: a.examples.length,
        pendingTrain: a.pendingTrain,
        distilling: a.distilling,
      })),
      tasks: this.tasks.slice(0, 60).map((t) => ({ ...t, output: t.output.slice(0, 20000) })),
      models: Object.fromEntries(
        TIERS.map((p) => [p, { label: PROVIDERS[p].label, model: PROVIDERS[p].model, price: PROVIDERS[p].price, ...this.models[p] }]),
      ),
      totals: this.totals,
      log: this.log,
    };
  }

  changed() {
    if (this._stateTimer) return;
    this._stateTimer = setTimeout(() => {
      this._stateTimer = null;
      this.emit('state', this.fullState());
    }, 150);
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.persist(), 1000);
  }

  persist() {
    try {
      save({
        agents: Object.fromEntries(
          this.agents.map((a) => [a.id, { xp: a.xp, playbook: a.playbook, notes: a.notes, examples: a.examples, pendingTrain: a.pendingTrain }]),
        ),
        tasks: this.tasks,
        stats: this.stats,
        totals: this.totals,
        log: this.log,
      });
    } catch (e) {
      console.error('Failed to save state:', e.message);
    }
  }
}
