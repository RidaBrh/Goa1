// Interface GOA1.

import { Store } from './store.js';
import { todayKey, addDays, addMonths, formatLong, formatFull, formatShort, dayShort, diffDays } from './dates.js';
import { versionAt, statusAt, dayView, stats, freqLabel, periodLabel, STATUS_LABEL, FREQ, specialAt } from './engine.js';

export const APP_VERSION = '1.0.0';

const $main = document.getElementById('main');
const $title = document.getElementById('title');
const $sheet = document.getElementById('sheet');
const $sheetBody = document.getElementById('sheet-body');
const $toast = document.getElementById('toast');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (r) => (r === null ? '—' : Math.round(r * 100) + ' %');

let store;
const ui = { tab: 'today', date: todayKey(), range: '4s', detail: null, showArchived: false };

// ---------- Démarrage ----------

try {
  store = new Store();
} catch (e) {
  $main.innerHTML = `<div class="empty"><p class="err">Les données n'ont pas pu être lues : ${esc(e.message)}</p>
    <p>Rien n'a été effacé. Si tu as un fichier de sauvegarde, tu peux le réimporter.</p>
    <input type="file" accept="application/json,.json" id="rescue"></div>`;
  document.getElementById('rescue').onchange = async (ev) => {
    const text = await ev.target.files[0].text();
    localStorage.setItem('goa1.data', text);
    location.reload();
  };
  throw e;
}

store.onChange(render);
navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// Au retour sur l'app un autre jour, on revient sur la date du jour.
let lastToday = todayKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && todayKey() !== lastToday) {
    lastToday = todayKey();
    ui.date = lastToday;
    render();
  }
});

// ---------- Rendu ----------

function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  const views = { today: viewToday, bilan: viewBilan, objectifs: viewObjectifs, plus: viewPlus };
  $main.innerHTML = views[ui.tab]();
}

function domainName(id) {
  return store.domain(id)?.name || 'Sans domaine';
}

function visibleOn(o, d) {
  return d >= o.startDate && statusAt(o, d) !== 'archived';
}

// ----- Aujourd'hui -----

function viewToday() {
  const today = todayKey();
  const d = ui.date;
  $title.textContent = d === today ? "Assessment du jour" : 'Rattrapage';

  const objs = store.state.objectives;
  if (!objs.length) {
    return `<div class="empty"><p>Aucun objectif pour l'instant.</p>
      <button class="btn primary" data-action="goto" data-tab="objectifs">Créer mes objectifs</button></div>`;
  }

  const groups = { day: [], week: [], month: [], off: [] };
  for (const o of objs) {
    if (!visibleOn(o, d)) continue;
    const v = dayView(store.state, o, d);
    if (!v) continue;
    const item = { o, v };
    if (v.excluded) groups.off.push(item);
    else if (v.version.freq === 'weekly') groups.week.push(item);
    else if (v.version.freq === 'monthly') groups.month.push(item);
    else groups.day.push(item);
  }

  const dayDone = groups.day.filter((x) => x.v.today >= 1).length;
  const weekOk = groups.week.filter((x) => x.v.done >= x.v.expected).length;
  const monthOk = groups.month.filter((x) => x.v.done >= x.v.expected).length;

  let html = `<div class="datebar">
    <button class="icon-btn" data-action="day" data-n="-1" aria-label="Jour précédent">‹</button>
    <label class="d"><b>${esc(formatLong(d))}</b>
      <small>${d === today ? "Aujourd'hui" : `il y a ${diffDays(d, today)} j · <u>revenir à aujourd'hui</u>`}</small>
      <input type="date" id="pick" max="${today}" value="${d}">
    </label>
    <button class="icon-btn" data-action="day" data-n="1" ${d >= today ? 'disabled' : ''} aria-label="Jour suivant">›</button>
  </div>
  <div class="summary">
    <div><b>${dayDone}/${groups.day.length}</b><small>du jour</small></div>
    <div><b>${weekOk}/${groups.week.length}</b><small>semaine</small></div>
    <div><b>${monthOk}/${groups.month.length}</b><small>mois</small></div>
  </div>`;

  if (groups.day.length) html += `<h2>Du jour</h2><div class="card">${groups.day.map(rowToday).join('')}</div>`;
  if (groups.week.length) html += `<h2>Cette semaine</h2><div class="card">${groups.week.map(rowToday).join('')}</div>`;
  if (groups.month.length) html += `<h2>Ce mois</h2><div class="card">${groups.month.map(rowToday).join('')}</div>`;
  if (groups.off.length) {
    html += `<h2>Suspendus ce jour</h2><div class="card">${groups.off
      .map(({ o, v }) => `<div class="row dim"><div class="main"><div class="name">${esc(o.name)}</div>
        <div class="sub">${v.excluded === 'période' ? esc(specialAt(store.state, o, d)?.reason || 'Période particulière') : 'Objectif suspendu'}</div></div></div>`)
      .join('')}</div>`;
  }
  if (!groups.day.length && !groups.week.length && !groups.month.length && !groups.off.length) {
    html += `<div class="empty"><p>Rien de prévu ce jour-là.</p></div>`;
  }
  return html;
}

function rowToday({ o, v }) {
  const max = v.version.maxPerDay || 1;
  const periodic = v.version.freq === 'weekly' || v.version.freq === 'monthly';
  const sub = [`<span class="tag">${esc(domainName(o.domainId))}</span>`];
  if (periodic) sub.push(`${v.done}/${v.expected} ${v.version.freq === 'weekly' ? 'cette semaine' : 'ce mois'}`);
  const bar = periodic ? `<div class="bar"><i class="${v.done >= v.expected ? 'full' : ''}" style="width:${Math.min(100, (v.done / v.expected) * 100)}%"></i></div>` : '';

  const control =
    max > 1
      ? `<div class="stepper"><button data-action="count" data-id="${o.id}" data-n="-1" aria-label="Moins">−</button>
          <span class="n">${v.today}</span>
          <button data-action="count" data-id="${o.id}" data-n="1" aria-label="Plus">+</button></div>`
      : `<span class="check ${v.today ? 'on' : ''}">✓</span>`;

  const inner = `<div class="main"><div class="name">${esc(o.name)}</div><div class="sub">${sub.join(' ')}</div>${bar}</div>${control}`;
  return max > 1
    ? `<div class="row">${inner}</div>`
    : `<button class="row" data-action="toggle" data-id="${o.id}" aria-pressed="${!!v.today}">${inner}</button>`;
}

// ----- Bilan -----

const RANGES = { '4s': '4 semaines', '3m': '3 mois', '12m': '12 mois', all: 'Tout' };

function rangeFrom(today) {
  if (ui.range === '4s') return addDays(today, -27);
  if (ui.range === '3m') return addMonths(today, -2);
  if (ui.range === '12m') return addMonths(today, -11);
  return '0000-01-01';
}

function viewBilan() {
  if (ui.detail) return viewDetail();
  $title.textContent = 'Bilan';
  const today = todayKey();
  const from = rangeFrom(today);
  const objs = store.state.objectives.filter((o) => ui.showArchived || statusAt(o, today) !== 'archived');

  let html = `<div class="seg">${Object.entries(RANGES)
    .map(([k, l]) => `<button data-action="range" data-r="${k}" class="${ui.range === k ? 'on' : ''}">${l}</button>`)
    .join('')}</div>
    <div class="legend">
      <span><i class="st-atteint"></i>Atteint</span><span><i class="st-partiel"></i>Partiel</span>
      <span><i class="st-non_atteint"></i>Non atteint</span><span><i class="st-suspendu"></i>Suspendu</span>
      <span><i class="st-incomplet"></i>Non compté</span><span><i class="st-en_cours"></i>En cours</span>
    </div>`;

  if (!objs.length) return html + `<div class="empty"><p>Pas encore de données.</p></div>`;

  for (const dom of [...store.state.domains, { id: null, name: 'Sans domaine' }]) {
    const list = objs.filter((o) => (o.domainId ?? null) === dom.id || (dom.id === null && !store.domain(o.domainId)));
    if (!list.length) continue;
    html += `<h2>${esc(dom.name)}</h2><div class="card">`;
    for (const o of list) {
      const st = stats(store.state, o, from, today, today);
      const last = st.periods.slice(-21);
      const v = versionAt(o, today) || o.versions[o.versions.length - 1];
      html += `<button class="row" data-action="detail" data-id="${o.id}">
        <div class="main"><div class="name">${esc(o.name)} ${statusAt(o, today) === 'archived' ? '<span class="tag grey">archivé</span>' : ''}</div>
          <div class="sub">${esc(freqLabel(v))} · ${st.atteint} atteint${st.atteint > 1 ? 's' : ''}, ${st.partiel} partiel${st.partiel > 1 ? 's' : ''}, ${st.non_atteint} non atteint${st.non_atteint > 1 ? 's' : ''}</div>
          <div class="strip">${last.map((p) => `<i class="st-${p.status}" title="${esc(periodLabel(p))} : ${STATUS_LABEL[p.status]}"></i>`).join('')}</div>
        </div>
        <div class="rate">${pct(st.rate)}<small>${st.counted} pér.</small></div>
      </button>`;
    }
    html += `</div>`;
  }
  html += `<p class="note">Taux = moyenne des périodes terminées (réalisations / seuil, plafonné à 100 %). Les périodes suspendues ou incomplètes ne comptent pas.</p>
    <button class="btn link" data-action="toggle-archived">${ui.showArchived ? 'Masquer' : 'Afficher'} les objectifs archivés</button>`;
  return html;
}

function viewDetail() {
  const o = store.objective(ui.detail);
  if (!o) { ui.detail = null; return viewBilan(); }
  $title.textContent = 'Historique';
  const today = todayKey();
  const from = rangeFrom(today);
  const st = stats(store.state, o, from, today, today);

  let html = `<button class="btn link back" data-action="back">‹ Bilan</button>
    <div class="card"><div class="detail-head">
      <h3>${esc(o.name)}</h3>
      <p>${esc(domainName(o.domainId))}${o.description ? ' · ' + esc(o.description) : ''}</p>
      <p><b style="color:var(--text);font-size:22px">${pct(st.rate)}</b> sur ${RANGES[ui.range].toLowerCase()} · ${st.counted} période${st.counted > 1 ? 's' : ''} comptée${st.counted > 1 ? 's' : ''}</p>
    </div></div>
    <h2>Périodes</h2><div class="card">`;

  const list = [...st.periods].reverse();
  if (!list.length) html += `<div class="row"><div class="main sub">Aucune période sur cet intervalle.</div></div>`;
  for (const p of list) {
    html += `<button class="row" data-action="fix" data-date="${p.end > today ? today : p.end}">
      <span class="dot st-${p.status}"></span>
      <div class="main"><div class="name">${esc(periodLabel(p))}</div>
        <div class="sub"><span class="c-${p.status}">${STATUS_LABEL[p.status]}</span>${p.amenagee ? ' · période aménagée' : ''}</div></div>
      <div class="rate" style="font-size:15px">${p.done}/${p.expected}<small>${p.status === 'suspendu' ? '' : Math.round(p.rate * 100) + ' %'}</small></div>
    </button>`;
  }
  html += `</div><p class="note">Touche une période pour corriger la saisie de ces jours-là.</p>`;

  html += `<h2>Historique des paramètres</h2><div class="card"><div class="history" style="padding-top:12px">
    ${o.versions.map((v) => `<div>Depuis le ${formatFull(v.from)} : ${esc(FREQ[v.freq])}, ${esc(freqLabel(v))}${v.maxPerDay > 1 ? `, ${v.maxPerDay} max/jour` : ''}</div>`).join('')}
    ${o.statusLog.map((s) => `<div>Depuis le ${formatFull(s.from)} : ${{ active: 'actif', suspended: 'suspendu', archived: 'archivé' }[s.status]}</div>`).join('')}
  </div></div>`;
  return html;
}

// ----- Objectifs -----

function viewObjectifs() {
  $title.textContent = 'Objectifs';
  const today = todayKey();
  const { domains, objectives } = store.state;
  let html = `<div class="btns" style="margin-top:0">
    <button class="btn primary" data-action="new-obj" ${domains.length ? '' : 'disabled'}>+ Objectif</button>
    <button class="btn" data-action="new-domain">+ Domaine</button></div>`;

  if (!domains.length) {
    return html + `<div class="empty"><p>Commence par créer un domaine (ex. Pratique religieuse), puis tes objectifs.</p></div>`;
  }

  const archived = [];
  for (const dom of domains) {
    const list = objectives.filter((o) => o.domainId === dom.id);
    const active = list.filter((o) => statusAt(o, today) !== 'archived');
    archived.push(...list.filter((o) => statusAt(o, today) === 'archived'));
    html += `<h2>${esc(dom.name)} <button class="btn link" data-action="edit-domain" data-id="${dom.id}">Modifier</button></h2><div class="card">`;
    if (!active.length) html += `<div class="row"><div class="main sub">Aucun objectif actif</div></div>`;
    html += active.map(rowObjective).join('');
    html += `</div>`;
  }
  if (archived.length) html += `<h2>Archivés</h2><div class="card">${archived.map(rowObjective).join('')}</div>`;
  return html;
}

function rowObjective(o) {
  const today = todayKey();
  const v = versionAt(o, today) || o.versions[o.versions.length - 1];
  const st = statusAt(o, today);
  const badge = o.startDate > today ? `<span class="tag grey">à partir du ${formatShort(o.startDate)}</span>` : st === 'suspended' ? '<span class="tag grey">suspendu</span>' : '';
  return `<button class="row" data-action="edit-obj" data-id="${o.id}">
    <div class="main"><div class="name">${esc(o.name)} ${badge}</div><div class="sub">${esc(FREQ[v.freq])} · ${esc(freqLabel(v))}</div></div>
    <span style="color:var(--muted)">›</span></button>`;
}

// ----- Plus -----

function viewPlus() {
  $title.textContent = 'Plus';
  const sp = [...store.state.specials].sort((a, b) => (a.start < b.start ? 1 : -1));
  const last = store.state.meta.lastExport;
  let html = `<h2>Périodes particulières <button class="btn link" data-action="new-special" ${store.state.objectives.length ? '' : 'disabled'}>+ Nouvelle</button></h2>
    <div class="card">`;
  if (!sp.length) html += `<div class="row"><div class="main sub">Aucune période. Utile pour suspendre volontairement des objectifs (vacances, déplacement…), sans que ces jours comptent comme des échecs.</div></div>`;
  for (const p of sp) {
    html += `<button class="row" data-action="edit-special" data-id="${p.id}"><div class="main">
      <div class="name">${esc(p.reason || 'Période particulière')}</div>
      <div class="sub">Du ${formatFull(p.start)} au ${formatFull(p.end)} · suspension · ${p.objectiveIds.length} objectif${p.objectiveIds.length > 1 ? 's' : ''}</div>
    </div><span style="color:var(--muted)">›</span></button>`;
  }
  html += `</div>
    <h2>Sauvegarde</h2>
    <div class="card"><div style="padding:14px">
      <div class="sub" style="color:var(--muted);font-size:14px">Tes données sont uniquement sur cet appareil. Exporte régulièrement un fichier de sauvegarde et garde-le en lieu sûr (Drive, mail…).</div>
      <div style="margin-top:8px;font-size:14px">Dernière sauvegarde : <b>${last ? formatFull(last.slice(0, 10)) : 'jamais'}</b></div>
      <div class="btns">
        <button class="btn primary" data-action="export">Exporter</button>
        <label class="btn">Importer<input type="file" accept="application/json,.json" id="import" hidden></label>
      </div>
    </div></div>
    <p class="note">GOA1 version ${APP_VERSION}</p>`;
  return html;
}

// ---------- Formulaires ----------

function openSheet(html, bind) {
  $sheetBody.innerHTML = html;
  $sheet.hidden = false;
  bind?.($sheetBody);
}

function closeSheet() {
  $sheet.hidden = true;
  $sheetBody.innerHTML = '';
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($toast.hidden = true), 2600);
}

function guard(form, fn) {
  try {
    fn();
    return true;
  } catch (e) {
    let err = form.querySelector('.err');
    if (!err) { err = document.createElement('p'); err.className = 'err'; form.prepend(err); }
    err.textContent = e.message;
    return false;
  }
}

function domainForm(dom) {
  openSheet(
    `<form><h3>${dom ? 'Modifier le domaine' : 'Nouveau domaine'}</h3>
      <label class="f">Nom<input name="name" required maxlength="60" value="${esc(dom?.name)}" placeholder="Ex. Pratique religieuse"></label>
      <div class="btns"><button class="btn primary" type="submit">Enregistrer</button>
      <button class="btn" type="button" data-action="close-sheet">Annuler</button>
      ${dom ? '<button class="btn danger" type="button" data-del>Supprimer</button>' : ''}</div></form>`,
    (root) => {
      const form = root.querySelector('form');
      form.name.focus();
      form.onsubmit = (e) => {
        e.preventDefault();
        if (guard(form, () => (dom ? store.renameDomain(dom.id, form.name.value) : store.addDomain(form.name.value)))) closeSheet();
      };
      root.querySelector('[data-del]')?.addEventListener('click', () => {
        if (guard(form, () => store.deleteDomain(dom.id))) closeSheet();
      });
    }
  );
}

function objectiveForm(o) {
  const today = todayKey();
  const v = o ? versionAt(o, today) || o.versions[o.versions.length - 1] : { freq: 'daily', maxPerDay: 1, threshold: 1, days: [] };
  const lastFrom = o ? o.versions[o.versions.length - 1].from : today;
  const startLocked = o && (o.versions.length > 1 || o.statusLog.length > 1);
  const st = o ? statusAt(o, today) : 'active';

  openSheet(
    `<form><h3>${o ? "Modifier l'objectif" : 'Nouvel objectif'}</h3>
      <label class="f">Nom<input name="name" required maxlength="80" value="${esc(o?.name)}" placeholder="Ex. Prier Al Fajr à l'heure"></label>
      <label class="f">Description (facultatif)<textarea name="description" maxlength="300">${esc(o?.description)}</textarea></label>
      <label class="f">Domaine<select name="domainId">${store.state.domains
        .map((d) => `<option value="${d.id}" ${o?.domainId === d.id ? 'selected' : ''}>${esc(d.name)}</option>`)
        .join('')}</select></label>
      <label class="f">Fréquence<select name="freq">${Object.entries(FREQ)
        .map(([k, l]) => `<option value="${k}" ${v.freq === k ? 'selected' : ''}>${l}</option>`)
        .join('')}</select></label>
      <div class="f" data-show="weekdays"><label class="f" style="margin:0">Jours</label><div class="chips">
        ${[1, 2, 3, 4, 5, 6, 7].map((n) => `<label><input type="checkbox" name="days" value="${n}" ${v.days?.includes(n) ? 'checked' : ''}><span>${dayShort(n)}</span></label>`).join('')}
      </div><div class="hint" style="margin-bottom:14px">L'objectif n'apparaît que ces jours-là ; chaque jour compte séparément.</div></div>
      <label class="f" data-show="weekly monthly">Seuil : réalisations attendues par <span data-unit>${v.freq === 'monthly' ? 'mois' : 'semaine'}</span>
        <input name="threshold" type="number" min="1" max="31" value="${v.threshold || 1}" inputmode="numeric"></label>
      <label class="f">Réalisations maximum par jour<input name="maxPerDay" type="number" min="1" max="20" value="${v.maxPerDay || 1}" inputmode="numeric">
        <div class="hint">1 = un appui pour cocher. Au-delà, des boutons + / −.</div></label>
      <label class="f">Date de début<input name="startDate" type="date" value="${o?.startDate || today}" ${startLocked ? 'disabled' : ''} required>
        ${startLocked ? '<div class="hint">Figée : des changements ont déjà été enregistrés.</div>' : ''}</label>
      ${o ? `<label class="f" data-changed hidden>Nouveaux paramètres applicables à partir du
        <input name="from" type="date" value="${today < lastFrom ? lastFrom : today}" min="${lastFrom}">
        <div class="hint">Les anciens paramètres restent appliqués aux périodes passées.</div></label>` : ''}
      <div class="btns"><button class="btn primary" type="submit">Enregistrer</button>
        <button class="btn" type="button" data-action="close-sheet">Annuler</button></div>
      ${o ? `<h2>Statut</h2><div class="btns" style="margin-top:0">
        ${st === 'active' ? '<button class="btn" type="button" data-status="suspended">Suspendre</button>' : '<button class="btn" type="button" data-status="active">Réactiver</button>'}
        ${st !== 'archived' ? '<button class="btn" type="button" data-status="archived">Archiver</button>' : ''}
        <button class="btn danger" type="button" data-del>Supprimer</button></div>
        <div class="hint">Suspendre ou archiver prend effet aujourd'hui ; l'historique est conservé. Supprimer efface aussi l'historique.</div>` : ''}
    </form>`,
    (root) => {
      const form = root.querySelector('form');
      const cfg = () => ({
        freq: form.freq.value,
        days: [...form.querySelectorAll('[name=days]:checked')].map((x) => Number(x.value)),
        threshold: form.threshold.value,
        maxPerDay: form.maxPerDay.value,
      });
      const sameCfg = (a, b) =>
        a.freq === b.freq && String(a.maxPerDay || 1) === String(b.maxPerDay || 1) &&
        (a.freq !== 'weekdays' || [...a.days].sort().join() === [...(b.days || [])].sort().join()) &&
        (!['weekly', 'monthly'].includes(a.freq) || String(a.threshold) === String(b.threshold));
      const sync = () => {
        const f = form.freq.value;
        root.querySelectorAll('[data-show]').forEach((el) => (el.hidden = !el.dataset.show.split(' ').includes(f)));
        root.querySelector('[data-unit]').textContent = f === 'monthly' ? 'mois' : 'semaine';
        const ch = root.querySelector('[data-changed]');
        if (ch) ch.hidden = sameCfg(cfg(), v);
      };
      form.addEventListener('input', sync);
      form.addEventListener('change', sync);
      sync();

      form.onsubmit = (e) => {
        e.preventDefault();
        const ok = guard(form, () => {
          const c = cfg();
          if (c.freq === 'weekdays' && !c.days.length) throw new Error('Choisis au moins un jour');
          if (!o) {
            store.addObjective({ name: form.name.value, description: form.description.value, domainId: form.domainId.value, startDate: form.startDate.value, config: c });
            return;
          }
          store.updateObjectiveInfo(o.id, { name: form.name.value, description: form.description.value, domainId: form.domainId.value });
          if (!startLocked && form.startDate.value !== o.startDate) store.changeStartDate(o.id, form.startDate.value);
          if (!sameCfg(c, v)) store.changeConfig(o.id, c, form.from.value);
        });
        if (ok) { closeSheet(); toast('Enregistré'); }
      };
      root.querySelectorAll('[data-status]').forEach((b) =>
        b.addEventListener('click', () => {
          if (guard(form, () => store.setStatus(o.id, b.dataset.status, today))) { closeSheet(); toast('Statut mis à jour'); }
        })
      );
      root.querySelector('[data-del]')?.addEventListener('click', () => {
        if (confirm(`Supprimer « ${o.name} » et tout son historique ? Pour garder l'historique, utilise plutôt Archiver.`)) {
          store.deleteObjective(o.id);
          closeSheet();
          toast('Objectif supprimé');
        }
      });
    }
  );
}

function specialForm(p) {
  const today = todayKey();
  const { domains, objectives } = store.state;
  const chosen = new Set(p?.objectiveIds || []);
  const list = objectives.filter((o) => statusAt(o, today) !== 'archived' || chosen.has(o.id));
  openSheet(
    `<form><h3>${p ? 'Modifier la période' : 'Nouvelle période particulière'}</h3>
      <label class="f">Du<input name="start" type="date" required value="${p?.start || today}"></label>
      <label class="f">Au<input name="end" type="date" required value="${p?.end || addDays(today, 13)}"></label>
      <label class="f">Motif (facultatif)<input name="reason" list="motifs" maxlength="60" value="${esc(p?.reason)}" placeholder="Vacances, déplacement…">
        <datalist id="motifs"><option>Vacances</option><option>Déplacement</option><option>Période chargée</option><option>Maladie</option></datalist></label>
      <div class="f">Mode : <b style="color:var(--text)">Suspension</b> des objectifs cochés sur toute la période</div>
      <div class="f" style="margin-bottom:6px">Objectifs concernés <button class="btn link" type="button" data-all>Tout cocher</button></div>
      <div class="checklist">${domains
        .map((d) => {
          const items = list.filter((o) => o.domainId === d.id);
          if (!items.length) return '';
          return `<div class="grp">${esc(d.name)}</div>` + items.map((o) => `<label><input type="checkbox" name="obj" value="${o.id}" ${chosen.has(o.id) ? 'checked' : ''}>${esc(o.name)}</label>`).join('');
        })
        .join('')}</div>
      <div class="btns"><button class="btn primary" type="submit">Enregistrer</button>
        <button class="btn" type="button" data-action="close-sheet">Annuler</button>
        ${p ? '<button class="btn danger" type="button" data-del>Supprimer</button>' : ''}</div>
    </form>`,
    (root) => {
      const form = root.querySelector('form');
      root.querySelector('[data-all]').onclick = () => form.querySelectorAll('[name=obj]').forEach((c) => (c.checked = true));
      form.onsubmit = (e) => {
        e.preventDefault();
        const ok = guard(form, () => {
          const data = {
            start: form.start.value,
            end: form.end.value,
            reason: form.reason.value,
            objectiveIds: [...form.querySelectorAll('[name=obj]:checked')].map((c) => c.value),
          };
          if (data.end < data.start) throw new Error('La date de fin doit être après la date de début');
          if (!data.objectiveIds.length) throw new Error('Coche au moins un objectif');
          p ? store.updateSpecial(p.id, data) : store.addSpecial(data);
        });
        if (ok) { closeSheet(); toast('Période enregistrée'); }
      };
      root.querySelector('[data-del]')?.addEventListener('click', () => {
        if (confirm('Supprimer cette période ? Les jours concernés seront à nouveau comptés normalement.')) {
          store.deleteSpecial(p.id);
          closeSheet();
        }
      });
    }
  );
}

// ---------- Actions ----------

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('#tabs button');
  if (tabBtn) {
    ui.tab = tabBtn.dataset.tab;
    ui.detail = null;
    if (ui.tab === 'today') ui.date = todayKey();
    window.scrollTo(0, 0);
    return render();
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const id = el.dataset.id;
  const today = todayKey();

  switch (el.dataset.action) {
    case 'goto':
      ui.tab = el.dataset.tab;
      return render();
    case 'day': {
      const d = addDays(ui.date, Number(el.dataset.n));
      ui.date = d > today ? today : d;
      return render();
    }
    case 'toggle': {
      const c = store.state.entries[id]?.[ui.date]?.c || 0;
      return store.setCount(id, ui.date, c ? 0 : 1);
    }
    case 'count': {
      const o = store.objective(id);
      const max = versionAt(o, ui.date)?.maxPerDay || 1;
      const c = store.state.entries[id]?.[ui.date]?.c || 0;
      return store.setCount(id, ui.date, Math.max(0, Math.min(max, c + Number(el.dataset.n))));
    }
    case 'range':
      ui.range = el.dataset.r;
      return render();
    case 'detail':
      ui.detail = id;
      window.scrollTo(0, 0);
      return render();
    case 'back':
      ui.detail = null;
      return render();
    case 'fix':
      ui.tab = 'today';
      ui.date = el.dataset.date;
      ui.detail = null;
      window.scrollTo(0, 0);
      return render();
    case 'toggle-archived':
      ui.showArchived = !ui.showArchived;
      return render();
    case 'new-domain':
      return domainForm(null);
    case 'edit-domain':
      return domainForm(store.domain(id));
    case 'new-obj':
      return objectiveForm(null);
    case 'edit-obj':
      return objectiveForm(store.objective(id));
    case 'new-special':
      return specialForm(null);
    case 'edit-special':
      return specialForm(store.state.specials.find((p) => p.id === id));
    case 'close-sheet':
      return closeSheet();
    case 'export':
      return doExport();
  }
});

document.addEventListener('click', (e) => {
  // Toucher la date ouvre le calendrier ; toucher « revenir à aujourd'hui » y revient.
  if (e.target.closest('.datebar u')) { ui.date = todayKey(); e.preventDefault(); return render(); }
  const d = e.target.closest('.datebar .d');
  if (d) { e.preventDefault(); const pick = document.getElementById('pick'); pick.showPicker ? pick.showPicker() : pick.click(); }
});

document.addEventListener('change', async (e) => {
  if (e.target.id === 'pick' && e.target.value) {
    const t = todayKey();
    ui.date = e.target.value > t ? t : e.target.value;
    render();
  }
  if (e.target.id === 'import' && e.target.files[0]) {
    const text = await e.target.files[0].text();
    if (!confirm('Importer ce fichier remplace toutes les données actuelles de GOA1. Continuer ?')) return;
    try {
      store.importJSON(text);
      toast('Données importées');
    } catch (err) {
      alert('Import impossible : ' + err.message);
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$sheet.hidden) closeSheet();
});

function doExport() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `goa1-sauvegarde-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Sauvegarde téléchargée');
}

render();
