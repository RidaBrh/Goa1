// Stockage des données GOA1 sur l'appareil (localStorage), avec copie de secours et migrations.

import { todayKey, isValidKey } from './dates.js';

const KEY = 'goa1.data';
const KEY_PREV = 'goa1.data.prev';
export const SCHEMA = 1;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => new Date().toISOString();

export function emptyState() {
  return { schema: SCHEMA, domains: [], objectives: [], entries: {}, specials: [], meta: { createdAt: now(), lastExport: null } };
}

// Migrations successives : MIGRATIONS[n] transforme un état du schéma n vers n+1.
const MIGRATIONS = {};

export function migrate(data) {
  let s = data;
  while (s.schema < SCHEMA) {
    const step = MIGRATIONS[s.schema];
    if (!step) throw new Error(`Migration manquante depuis le schéma ${s.schema}`);
    s = step(s);
  }
  return s;
}

export function validate(s) {
  if (!s || typeof s !== 'object') throw new Error('Fichier illisible');
  if (typeof s.schema !== 'number' || s.schema > SCHEMA) throw new Error("Version de données non reconnue par cette version de l'app");
  for (const k of ['domains', 'objectives', 'specials']) if (!Array.isArray(s[k])) throw new Error(`Champ manquant : ${k}`);
  if (!s.entries || typeof s.entries !== 'object') throw new Error('Champ manquant : entries');
  for (const o of s.objectives) {
    if (!o.id || !isValidKey(o.startDate) || !Array.isArray(o.versions) || !o.versions.length || !Array.isArray(o.statusLog)) {
      throw new Error(`Objectif invalide : ${o.name || o.id}`);
    }
  }
  return s;
}

export class Store {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.listeners = [];
    this.state = this.load();
  }

  load() {
    const raw = this.storage.getItem(KEY);
    if (!raw) return emptyState();
    try {
      return validate(migrate(JSON.parse(raw)));
    } catch (e) {
      const prev = this.storage.getItem(KEY_PREV);
      if (prev) return validate(migrate(JSON.parse(prev)));
      throw e;
    }
  }

  save() {
    const cur = this.storage.getItem(KEY);
    if (cur) this.storage.setItem(KEY_PREV, cur);
    this.storage.setItem(KEY, JSON.stringify(this.state));
    this.listeners.forEach((f) => f());
  }

  onChange(f) {
    this.listeners.push(f);
  }

  // Domaines
  addDomain(name) {
    const d = { id: uid(), name: name.trim(), createdAt: now() };
    this.state.domains.push(d);
    this.save();
    return d;
  }

  renameDomain(id, name) {
    this.domain(id).name = name.trim();
    this.save();
  }

  deleteDomain(id) {
    if (this.state.objectives.some((o) => o.domainId === id)) throw new Error('Ce domaine contient encore des objectifs');
    this.state.domains = this.state.domains.filter((d) => d.id !== id);
    this.save();
  }

  domain(id) {
    return this.state.domains.find((d) => d.id === id);
  }

  // Objectifs
  objective(id) {
    return this.state.objectives.find((o) => o.id === id);
  }

  addObjective({ name, description = '', domainId, startDate, config }) {
    const o = {
      id: uid(),
      name: name.trim(),
      description: description.trim(),
      domainId,
      startDate,
      createdAt: now(),
      versions: [{ ...cleanConfig(config), from: startDate, at: now() }],
      statusLog: [{ from: startDate, status: 'active', at: now() }],
    };
    this.state.objectives.push(o);
    this.save();
    return o;
  }

  updateObjectiveInfo(id, { name, description, domainId }) {
    const o = this.objective(id);
    o.name = name.trim();
    o.description = (description || '').trim();
    o.domainId = domainId;
    this.save();
  }

  // Modifie la date de début : seulement tant qu'aucun changement de paramètres n'a eu lieu.
  changeStartDate(id, startDate) {
    const o = this.objective(id);
    if (o.versions.length > 1 || o.statusLog.length > 1) throw new Error('Date de début figée : des changements ont déjà été enregistrés');
    o.startDate = startDate;
    o.versions[0].from = startDate;
    o.statusLog[0].from = startDate;
    this.save();
  }

  // Nouveaux paramètres applicables à partir de `from`. Les versions antérieures sont conservées.
  changeConfig(id, config, from = todayKey()) {
    const o = this.objective(id);
    const last = o.versions[o.versions.length - 1];
    if (from < last.from) throw new Error(`La date d'application doit être au plus tôt le ${last.from}`);
    const v = { ...cleanConfig(config), from, at: now() };
    if (from === last.from) o.versions[o.versions.length - 1] = v;
    else o.versions.push(v);
    this.save();
  }

  setStatus(id, status, from = todayKey()) {
    const o = this.objective(id);
    const log = o.statusLog;
    const last = log[log.length - 1];
    if (last.status === status) return;
    const at = from < o.startDate ? o.startDate : from;
    if (at < last.from) throw new Error(`La date doit être au plus tôt le ${last.from}`);
    if (at === last.from) log[log.length - 1] = { from: at, status, at: now() };
    else log.push({ from: at, status, at: now() });
    this.save();
  }

  deleteObjective(id) {
    this.state.objectives = this.state.objectives.filter((o) => o.id !== id);
    delete this.state.entries[id];
    this.state.specials.forEach((p) => (p.objectiveIds = p.objectiveIds.filter((x) => x !== id)));
    this.save();
  }

  // Réalisations : nombre de réalisations d'un objectif un jour donné.
  setCount(objId, date, count) {
    const o = this.objective(objId);
    const byDay = (this.state.entries[objId] ||= {});
    const prev = byDay[date];
    if (count <= 0) {
      if (prev) byDay[date] = { c: 0, created: prev.created, at: now() };
    } else {
      byDay[date] = { c: count, created: prev?.created || now(), at: now() };
    }
    if (o && count === 0 && !prev) return;
    this.save();
  }

  // Périodes particulières
  addSpecial({ start, end, reason, objectiveIds }) {
    const p = { id: uid(), start, end, reason: (reason || '').trim(), mode: 'suspension', objectiveIds: [...objectiveIds], createdAt: now() };
    this.state.specials.push(p);
    this.save();
    return p;
  }

  updateSpecial(id, { start, end, reason, objectiveIds }) {
    const p = this.state.specials.find((x) => x.id === id);
    Object.assign(p, { start, end, reason: (reason || '').trim(), objectiveIds: [...objectiveIds], updatedAt: now() });
    this.save();
  }

  deleteSpecial(id) {
    this.state.specials = this.state.specials.filter((p) => p.id !== id);
    this.save();
  }

  // Sauvegarde
  exportJSON() {
    this.state.meta.lastExport = now();
    this.save();
    return JSON.stringify(this.state, null, 1);
  }

  importJSON(text) {
    const s = validate(migrate(JSON.parse(text)));
    this.state = s;
    this.save();
  }
}

function cleanConfig(c) {
  const freq = c.freq;
  const out = { freq, maxPerDay: Math.max(1, parseInt(c.maxPerDay, 10) || 1) };
  if (freq === 'weekdays') out.days = [...new Set(c.days)].map(Number).sort();
  if (freq === 'weekly' || freq === 'monthly') out.threshold = Math.max(1, parseInt(c.threshold, 10) || 1);
  if (freq === 'weekdays' && !out.days.length) throw new Error('Choisis au moins un jour');
  return out;
}
