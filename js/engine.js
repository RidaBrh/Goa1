// Logique de calcul GOA1 : périodes, réalisations, taux d'atteinte.
// Fonctions pures : elles lisent l'état, ne le modifient jamais.

import { addDays, weekday, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDay, formatShort, formatMonth, formatLong, dayShort } from './dates.js';

export const FREQ = {
  daily: 'Quotidienne',
  weekdays: 'Jours de la semaine',
  weekly: 'Hebdomadaire',
  monthly: 'Mensuelle',
};

// Paramètres applicables à une date (traçabilité : on ne réécrit jamais une version passée).
export function versionAt(obj, date) {
  let v = null;
  for (const ver of obj.versions) if (ver.from <= date) v = ver;
  return v;
}

export function statusAt(obj, date) {
  let s = 'active';
  for (const e of obj.statusLog) if (e.from <= date) s = e.status;
  return s;
}

export function specialAt(state, obj, date) {
  return state.specials.find((p) => p.start <= date && date <= p.end && p.objectiveIds.includes(obj.id)) || null;
}

// Raison pour laquelle un jour ne compte pas pour cet objectif, ou null.
export function exclusionAt(state, obj, date) {
  if (date < obj.startDate) return 'avant';
  const st = statusAt(obj, date);
  if (st === 'suspended') return 'suspendu';
  if (st === 'archived') return 'archivé';
  if (specialAt(state, obj, date)) return 'période';
  return null;
}

export function bounds(freq, date) {
  if (freq === 'weekly') return [startOfWeek(date), endOfWeek(date)];
  if (freq === 'monthly') return [startOfMonth(date), endOfMonth(date)];
  return [date, date];
}

export function scheduledOn(version, date) {
  if (!version) return false;
  if (version.freq === 'weekdays') return version.days.includes(weekday(date));
  return true;
}

export function countOn(state, objId, date) {
  return state.entries[objId]?.[date]?.c || 0;
}

export function expectedOf(version) {
  return version.freq === 'daily' || version.freq === 'weekdays' ? 1 : version.threshold;
}

export function rateOf(done, expected) {
  return expected > 0 ? Math.min(done / expected, 1) : 0;
}

// Liste toutes les périodes de l'objectif jusqu'à `until`.
// Statuts : en_cours, atteint, partiel, non_atteint, suspendu, incomplet.
// Seules les périodes terminées et complètes entrent dans le taux (counted = true).
export function periods(state, obj, until, today) {
  const groups = new Map();
  for (const d of eachDay(obj.startDate, until)) {
    const v = versionAt(obj, d);
    if (!scheduledOn(v, d)) continue;
    const [s, e] = bounds(v.freq, d);
    const key = v.from + '|' + s;
    if (!groups.has(key)) groups.set(key, { version: v, start: s, end: e, days: [] });
    groups.get(key).days.push(d);
  }

  const out = [];
  for (const g of groups.values()) {
    const fullDays = [...eachDay(g.start, g.end)].filter((d) => scheduledOn(g.version, d));
    const excluded = g.days.filter((d) => exclusionAt(state, obj, d));
    const special = g.days.some((d) => specialAt(state, obj, d));
    const done = g.days.reduce((n, d) => n + countOn(state, obj.id, d), 0);
    const expected = expectedOf(g.version);
    const covered = g.days.length === fullDays.length;
    const closed = g.end < today;

    let status;
    if (excluded.length === g.days.length) status = 'suspendu';
    else if (!closed) status = 'en_cours';
    else if (!covered || excluded.length > 0) status = 'incomplet';
    else if (done >= expected) status = 'atteint';
    else if (done > 0) status = 'partiel';
    else status = 'non_atteint';

    out.push({
      start: g.start,
      end: g.end,
      freq: g.version.freq,
      done,
      expected,
      rate: rateOf(done, expected),
      status,
      counted: ['atteint', 'partiel', 'non_atteint'].includes(status),
      amenagee: special,
    });
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : 1));
}

// Taux d'atteinte d'un objectif sur [from, to] : moyenne des taux des périodes comptées.
export function stats(state, obj, from, to, today) {
  const until = to < today ? to : addDays(today, 0);
  if (until < obj.startDate) return { rate: null, periods: [], counted: 0, atteint: 0, partiel: 0, non_atteint: 0 };
  const list = periods(state, obj, until, today).filter((p) => p.end >= from && p.start <= to);
  const counted = list.filter((p) => p.counted);
  const rate = counted.length ? counted.reduce((s, p) => s + p.rate, 0) / counted.length : null;
  return {
    rate,
    periods: list,
    counted: counted.length,
    atteint: counted.filter((p) => p.status === 'atteint').length,
    partiel: counted.filter((p) => p.status === 'partiel').length,
    non_atteint: counted.filter((p) => p.status === 'non_atteint').length,
  };
}

// Vue d'une date : la période en cours de l'objectif et ce qui a été saisi ce jour-là.
export function dayView(state, obj, date) {
  const v = versionAt(obj, date);
  if (!v || !scheduledOn(v, date)) return null;
  const [s, e] = bounds(v.freq, date);
  let done = 0;
  for (const d of eachDay(s, e)) if (versionAt(obj, d) === v) done += countOn(state, obj.id, d);
  return {
    version: v,
    start: s,
    end: e,
    done,
    expected: expectedOf(v),
    today: countOn(state, obj.id, date),
    excluded: exclusionAt(state, obj, date),
  };
}

export function freqLabel(v) {
  if (v.freq === 'daily') return 'Chaque jour';
  if (v.freq === 'weekdays') return [...v.days].sort().map(dayShort).join(' · ');
  if (v.freq === 'weekly') return `${v.threshold} / semaine`;
  return `${v.threshold} / mois`;
}

export function periodLabel(p) {
  if (p.freq === 'monthly') return formatMonth(p.start);
  if (p.freq === 'weekly') return `Sem. du ${formatShort(p.start)}`;
  return formatLong(p.start);
}

export const STATUS_LABEL = {
  atteint: 'Atteint',
  partiel: 'Partiel',
  non_atteint: 'Non atteint',
  suspendu: 'Suspendu',
  incomplet: 'Incomplet, non compté',
  en_cours: 'En cours',
};
