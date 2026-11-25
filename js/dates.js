// Dates manipulées sous forme de clés 'AAAA-MM-JJ' (jour local), calculs en UTC pour éviter les effets d'heure d'été.

const pad = (n) => String(n).padStart(2, '0');

export function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function toUTC(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(dt) {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addDays(key, n) {
  const dt = toUTC(key);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUTC(dt);
}

export function diffDays(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

// 1 = lundi … 7 = dimanche
export function weekday(key) {
  const d = toUTC(key).getUTCDay();
  return d === 0 ? 7 : d;
}

export function startOfWeek(key) {
  return addDays(key, 1 - weekday(key));
}

export function endOfWeek(key) {
  return addDays(startOfWeek(key), 6);
}

export function startOfMonth(key) {
  return key.slice(0, 8) + '01';
}

export function endOfMonth(key) {
  const dt = toUTC(startOfMonth(key));
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  dt.setUTCDate(0);
  return fromUTC(dt);
}

export function addMonths(key, n) {
  const dt = toUTC(startOfMonth(key));
  dt.setUTCMonth(dt.getUTCMonth() + n);
  return fromUTC(dt);
}

export function* eachDay(from, to) {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}

export function isValidKey(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && fromUTC(toUTC(key)) === key;
}

const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const JOURS_COURTS = ['L', 'Ma', 'Me', 'J', 'V', 'S', 'D'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export const dayName = (n) => JOURS[n - 1];
export const dayShort = (n) => JOURS_COURTS[n - 1];

export function formatLong(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${dayName(weekday(key))} ${d} ${MOIS[m - 1]}`;
}

export function formatShort(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${d}/${pad(m)}`;
}

export function formatFull(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${MOIS[m - 1]} ${y}`;
}

export function formatMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MOIS[m - 1]} ${y}`;
}
