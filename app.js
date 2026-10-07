// Pokémon-Sammlung – eigenständige Web-App (ohne Claude).
// Daten: privates GitHub-Repo (speicher.js). Erkennung: Gemini + Nachschlagewerk (erkennung.js).
import { Index, bestimme, nurBild, neuZuordnen, nummerMitKuerzel, haken, kanonisch, norm, ERSTAUFLAGE_SETS } from "./erkennung.js";
import { GitHubSpeicher, TestSpeicher, PFADE } from "./speicher.js";

// ---------- Grundlagen ----------
const $ = id => document.getElementById(id);
const zahl = new Intl.NumberFormat("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = v => v == null || isNaN(v) ? "–" : zahl.format(v) + " €";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const heute = () => new Date().toISOString().slice(0, 10);
const datumText = d => d ? new Date(d + "T12:00:00").toLocaleDateString("de-AT") : "";
const betrag = s => { const n = parseFloat(String(s || "").replace(/\s/g, "").replace(",", ".")); return isNaN(n) ? null : Math.round(n * 100) / 100; };
const cm = name => `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(name)}`;
const SETREIHE = ["base1", "base2", "base3", "base5", "gym1", "gym2", "neo1", "basep"];
const TEST = new URLSearchParams(location.search).has("test");
const VERSION = "1.26 (07.10.2026)";      // in den Einstellungen sichtbar – hilft beim Prüfen, ob die neue Fassung geladen ist

const lies = k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
const merke = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} };
const EINST = { repo: lies("repo") || "christoph8530-commits/pokemon-sammlung", token: lies("token"), gemini: lies("gemini") };

let B = null;                 // Grundsammlung (basis.json)
let IDX = null;               // Nachschlagewerk aller Karten
let FOTOS = {};               // eigene Fotos der Grundsammlung
let ZUG = [], VK = [];        // Zugänge und Verkäufe über die App
let speicher = null, schreibbar = false;
const FOTOURL = {};           // Handyfotos: Pfad -> Objekt-URL (werden mit Token geladen)

function toast(text) {
  const t = $("toast"); t.textContent = text; t.hidden = false;
  clearTimeout(toast.zeit); toast.zeit = setTimeout(() => { t.hidden = true; }, 2800);
}
function status(text, art) { $("status-text").textContent = text; $("status").className = "status " + (art || ""); }

// ---------- Daten zusammenführen ----------
function setInfo(set, nr) { return (B.setkarten[set] || []).find(k => k.nr === nr); }
function indexKarte(set, nr) { return IDX?.karte(setInfo(set, nr)?.id || `${set}-${nr}`); }

function inventar() {
  const map = new Map();
  for (const k of B.karten) map.set(k.key, { ...k, basis: k.anzahl, zugang: 0, verkauft: 0, neu: false, foto: null, zuletzt: "" });
  for (const z of ZUG) {
    let e = map.get(z.key);
    if (!e) {
      const sk = setInfo(z.set, z.nr);
      e = { key: z.key, id: sk?.id || z.id_karte || z.key, name: z.name || sk?.name || "Karte", set: z.set, nummer: z.nummer || sk?.nummer || "",
            variante: z.variante || "normal",
            nr: z.nr ?? 999, seltenheit: sk?.seltenheit || "", symbol: sk?.symbol || "", sprache: z.sprache, auflage: z.auflage,
            preis: z.preis ?? sk?.preis ?? null, holo: !!sk?.holo, basis: 0, zugang: 0, verkauft: 0, neu: true, foto: null, zuletzt: "" };
      map.set(z.key, e);
    }
    e.zugang += Number(z.anzahl) || 0;
    if (z.foto && !e.foto) e.foto = z.foto;
    if ((z.erstellt || "") > e.zuletzt) e.zuletzt = z.erstellt || "";
  }
  for (const v of VK) { const e = map.get(v.key); if (e) e.verkauft += Number(v.anzahl) || 0; }
  const alle = [...map.values()];
  alle.forEach(e => { e.anzahl = e.basis + e.zugang - e.verkauft; e.summe = (e.preis || 0) * Math.max(0, e.anzahl); });
  return alle.filter(e => e.anzahl > 0);
}
// Plätze, die eine Karte belegt – die Gym-Energien zählen für Gym Heroes und Gym Challenge
function plaetze(set, nr) {
  return (set === "gym1" || set === "gym2") && nr >= 127 && nr <= 132 ? [`gym1|${nr}`, `gym2|${nr}`] : [`${set}|${nr}`];
}
const gleicherPlatz = (a, b) => plaetze(a.set, a.nr).includes(`${b.set}|${b.nr}`);
function besitzMenge(inv) { return new Set(inv.flatMap(e => plaetze(e.set, e.nr))); }
function fehlende(inv) {
  const besitz = besitzMenge(inv);
  const out = [];
  for (const set of Object.keys(B.setkarten)) for (const k of B.setkarten[set])
    if (!besitz.has(set + "|" + k.nr)) out.push({ ...k, set, fehlt: true });
  return out;
}
function setName(set) {
  if (set === "anderes") return "Anderes Set";
  const s = IDX?.sets[set];
  return B.sets[set]?.name || s?.name_de || s?.name || set;
}

// ---------- Bilder ----------
// Kartenbild aus dem Verzeichnis – über die Karten-ID, weil neuere Sets dreistellige Nummern haben (me04-011, nicht me04-11)
function setBild(set, nr, id) { const k = (id && IDX?.karte(id)) || indexKarte(set, nr); return k?.bild ? k.bild + "/low.jpg" : null; }
function fotoUrl(pfad) {
  if (!pfad) return null;
  if (FOTOURL[pfad]) return FOTOURL[pfad] === "laedt" ? null : FOTOURL[pfad];
  FOTOURL[pfad] = "laedt";
  speicher?.fotoLesen(pfad).then(b => { FOTOURL[pfad] = b ? URL.createObjectURL(b) : null; spaeter(); }).catch(() => { FOTOURL[pfad] = null; });
  return null;
}
function bildVon(e) { return FOTOS[e.key] || fotoUrl(e.foto) || setBild(e.set, e.nr, e.id); }
function bildHtml(src, alt = "") { return src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">` : `<div class="leerbild"></div>`; }

let spaeterZeit;
function spaeter() { clearTimeout(spaeterZeit); spaeterZeit = setTimeout(alles, 120); }

function stufeKauf(p) { return (p || 0) < 2 ? "guenstig" : (p || 0) < 10 ? "mittel" : "teuer"; }
function richtpreis(e) {
  if (e.preis == null) return null;
  let b = e.preis;
  if (e.quelle === "Cardmarket" && e.tief != null && e.hoch != null) b = e.hoch > 2 * e.tief ? (e.tief + e.preis) / 2 : e.tief;
  else if (e.quelle === "TCGplayer") b = e.preis * 0.9;
  return b >= 5 ? Math.round(b * 2) / 2 : Math.max(0.1, Math.round(b * 10) / 10);
}
// Marktwert einer beliebigen Karte live von TCGdex (Median aus Trend, 7- und 30-Tage-Schnitt).
// Varianten: Reverse Holo = Glitzerpreis derselben Karte; Pokéball/Meisterball = eigenes Produkt, dessen Glitzerpreis.
// Mittelwert aus Trend, 7- und 30-Tage-Schnitt (der mittlere der vorhandenen Werte)
function mittelPreis(werte) {
  const w = werte.filter(x => x > 0).sort((a, b) => a - b);
  return w.length ? Math.round((w.length % 2 ? w[(w.length - 1) / 2] : (w[w.length / 2 - 1] + w[w.length / 2]) / 2) * 100) / 100 : null;
}
// Zweite Quelle, wenn TCGdex keinen Preis hat (z. B. Wizards-Promos): Cardmarket-Preise über pokemontcg.io
async function ersatzPreis(id, variante) {
  const m = String(id).match(/^(.+)-0*([A-Za-z]*\d+)$/);
  if (!m) return null;
  try {
    const url = `https://api.pokemontcg.io/v2/cards?q=set.id:${encodeURIComponent(m[1])}%20number:${encodeURIComponent(m[2])}&select=id,cardmarket`;
    let d = null;
    for (let versuch = 0; versuch < 4 && !d; versuch++)   // pokemontcg.io antwortet oft erst beim zweiten oder dritten Mal
      d = await fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
    const p = d?.data?.[0]?.cardmarket?.prices;
    if (!p) return null;
    return variante === "reverse" ? mittelPreis([p.reverseHoloTrend, p.reverseHoloAvg7, p.reverseHoloAvg30])
         : variante === "normal" ? mittelPreis([p.trendPrice, p.avg7, p.avg30]) : null;
  } catch (e) { return null; }
}
async function livePreis(id, variante = "normal") {
  return (await tcgdexPreis(id, variante)) ?? (await ersatzPreis(id, variante));
}
async function tcgdexPreis(id, variante) {
  try {
    const d = await fetch(`https://api.tcgdex.net/v2/en/cards/${id}`).then(r => r.ok ? r.json() : null);
    let c = d?.pricing?.cardmarket || {}, glitzer = false;
    if (variante !== "normal") {
      const folie = { pokeball: "pokeball", meisterball: "masterball" }[variante];
      const v = (d?.variants_detailed || []).find(v => folie ? v.foil === folie : v.type === "reverse" && !v.foil);
      if (v?.pricing?.cardmarket) c = v.pricing.cardmarket; else if (folie) return null;
      glitzer = true;
    }
    const f = k => c[glitzer ? k + "-holo" : k];
    return mittelPreis([f("trend"), f("avg7"), f("avg30")]);
  } catch (e) { return null; }
}

// ---------- Anzeige ----------
let tab = "sammlung";
function alles() {
  if (!B) return;
  const inv = inventar(), fehlt = fehlende(inv);
  bilanz(inv); sammlung(inv, fehlt); sets(inv, fehlt); einkaufen(fehlt); verkaufen(inv); verlauf();
}
function bilanz(inv) {
  const stueck = inv.reduce((a, e) => a + e.anzahl, 0);
  const wert = inv.reduce((a, e) => a + e.summe, 0) + B.sonstige.reduce((a, s) => a + (s.preis || 0), 0);
  const gs = new Set(inv.filter(e => e.set === "base1").map(e => e.nr)).size;
  const neu = ZUG.reduce((a, z) => a + (Number(z.anzahl) || 0), 0), weg = VK.reduce((a, v) => a + (Number(v.anzahl) || 0), 0);
  $("bilanz").innerHTML = `
    <div><span class="label">Karten</span><span class="wert">${stueck}</span><small>${inv.length} verschiedene</small></div>
    <div><span class="label">Wert ca.</span><span class="wert">${eur(wert)}</span><small>Marktwert, Stand ${datumText(B.stand)}</small></div>
    <div><span class="label">Grundset</span><span class="wert">${gs} / 102</span><small>verschiedene Karten</small></div>
    <div><span class="label">Über die App</span><span class="wert">+${neu} / −${weg}</span><small>hinzugefügt / verkauft</small></div>`;
}
// Name, wie er auf der Karte steht (Sprache der Karte); der deutsche Name als Zusatz, wenn er anders lautet
function kartenName(e) {
  const k = e.id && IDX?.karte(e.id), sp = String(e.sprache || "").toLowerCase();
  let titel = null;
  if (k && sp !== "de") {
    if (sp === "en") titel = k.en;
    else if (k.namen[sp]) titel = k.namen[sp];
    else if (IDX.sets[k.set]?.sprachen.includes(sp)) titel = k.en;   // in dieser Sprache gleich wie auf Englisch
  }
  return titel && norm(titel) !== norm(e.name) ? { titel, unter: e.name } : { titel: e.name, unter: "" };
}
// im Dialog „Karte hinzufügen“: Name in der gewählten Sprache, der deutsche in Klammern – „Ptitard (Quapsel)“
function dlgName(id, de) {
  const n = kartenName({ id, sprache: $("n-sprache").value, name: de });
  return n.unter ? `${n.titel} (${n.unter})` : n.titel;
}
function trifft(e, suche) {
  if (!suche || [e.name, e.nummer, setName(e.set), e.seltenheit, e.sprache, e.auflage, e.holo ? "holo" : ""].join(" ").toLowerCase().includes(suche)) return true;
  // auch englische, französische, italienische … Namen aus dem Kartenverzeichnis („Capumain“ findet Griffel)
  const k = e.id && IDX?.karte(e.id), n = norm(suche);
  return !!k && n.length >= 3 && [k.nen, ...k.nw].some(w => w.includes(n));
}
function sammlung(inv, fehlt) {
  const suche = $("suche").value.trim().toLowerCase();
  const set = $("s-set").value, sprache = $("s-sprache").value, sort = $("s-sort").value;
  const doppelt = $("s-doppelt").checked, mitFehl = $("s-fehlend").checked && !doppelt && !sprache
    && (!set || !!B.setkarten[set]);   // fehlende Karten kennt die App nur für die Sets der Grundsammlung
  const bekannt = new Set(SETREIHE);
  let liste = inv.filter(e => (!set || e.set === set || (set === "anderes" && !bekannt.has(e.set))) && (!sprache || e.sprache === sprache) && (!doppelt || e.anzahl > 1) && trifft(e, suche));
  const eigene = liste.length;
  if (mitFehl) liste = liste.concat(fehlt.filter(f => (!set || f.set === set) && trifft(f, suche)));
  const idx = s => { const i = SETREIHE.indexOf(s); return i < 0 ? 99 : i; };
  const wertVon = e => e.fehlt ? (e.preis || 0) : e.summe;
  const nrZahl = e => typeof e.nr === "number" ? e.nr : parseInt(e.nr, 10) || 0;
  const sortierer = {
    wert: (a, b) => wertVon(b) - wertVon(a),
    set: (a, b) => idx(a.set) - idx(b.set) || String(a.set).localeCompare(String(b.set)) || nrZahl(a) - nrZahl(b),
    name: (a, b) => a.name.localeCompare(b.name, "de"),
    neu: (a, b) => (b.zuletzt || "").localeCompare(a.zuletzt || "") || wertVon(b) - wertVon(a),
  };
  liste.sort(sortierer[sort]);
  $("s-treffer").textContent = `${eigene} Sorten` + (mitFehl ? ` · ${liste.length - eigene} fehlen` : "");
  $("s-raster").innerHTML = liste.length ? liste.map(e => e.fehlt ? `
    <button type="button" class="karte fehlt" data-fehlt="${e.set}|${e.nr}">
      <span class="bild">${bildHtml(setBild(e.set, e.nr))}</span><span class="marke">Fehlt</span>
      <span class="info"><span class="k-titel">${esc(e.name)}</span><span class="meta">${esc(setName(e.set))} · <span class="mono">${e.nummer}</span> ${e.symbol}</span>
      ${e.holo ? `<span class="chips"><span class="chip gelb">Holo</span></span>` : ""}<span class="preis">ca. ${eur(e.preis)}</span></span>
    </button>` : `
    <button type="button" class="karte" data-key="${esc(e.key)}">
      <span class="bild">${bildHtml(bildVon(e), e.name)}</span>
      ${e.anzahl > 1 ? `<span class="stueck">×${e.anzahl}</span>` : ""}${e.neu || e.zugang ? `<span class="marke neu">Neu</span>` : ""}
      <span class="info"><span class="k-titel">${esc(kartenName(e).titel)}</span>${kartenName(e).unter ? `<span class="meta">${esc(kartenName(e).unter)}</span>` : ""}<span class="meta">${esc(setName(e.set))} · <span class="mono">${esc(e.nummer)}</span> ${e.symbol}</span>
      <span class="chips"><span class="chip">${esc(e.sprache)}</span>${e.holo ? `<span class="chip gelb">Holo</span>` : ""}${e.auflage === "1. Auflage" ? `<span class="chip gelb">1. Aufl.</span>` : ""}${VARIANTE_KURZ[e.variante] ? `<span class="chip gelb">${VARIANTE_KURZ[e.variante]}</span>` : ""}</span>
      <span class="preis">${eur(e.preis)}</span></span>
    </button>`).join("") : `<div class="leer">Keine Karte passt zu diesen Filtern.</div>`;
}
// Sprachen einer Kartengruppe als kleine Chips, z. B. „DE 54“ „EN 3“
function sprachChips(liste) {
  const n = {};
  for (const e of liste) n[e.sprache || "?"] = (n[e.sprache || "?"] || 0) + e.anzahl;
  return Object.entries(n).sort((a, b) => b[1] - a[1])
    .map(([s, z]) => `<span class="chip" title="${esc(SPRACHE[s] || s)}">${esc(s)} ${z}</span>`).join("");
}
// Sets außerhalb der Grundsammlung, die über die App dazugekommen sind – neueste zuerst
function weitereSets(inv) {
  const reihe = IDX ? Object.keys(IDX.sets) : [];
  return [...new Set(inv.map(e => e.set))].filter(s => !SETREIHE.includes(s) && s !== "anderes")
    .sort((a, b) => reihe.indexOf(b) - reihe.indexOf(a));
}
function sets(inv, fehlt) {
  const besitz = besitzMenge(inv);
  const stand = {};   // Set → „hat/gesamt“ für den Filter der Sammlung
  $("sets").innerHTML = SETREIHE.filter(s => B.setkarten[s]).map(s => {
    const hat = B.setkarten[s].filter(k => besitz.has(`${s}|${k.nr}`)).length, gesamt = B.setkarten[s].length;
    stand[s] = `${hat}/${gesamt}`;
    const kosten = fehlt.filter(f => f.set === s).reduce((a, f) => a + (f.preis || 0), 0);
    return `<button type="button" class="setkarte" data-set="${s}"><span><strong>${esc(setName(s))}</strong></span>
      <span class="num">${hat} / ${gesamt}</span>
      <span class="voll"><span class="balken"><span style="width:${hat / gesamt * 100}%"></span></span><span>${gesamt - hat} fehlen · ca. ${eur(kosten)}</span></span>
      <span class="sprachen">${sprachChips(inv.filter(e => e.set === s))}</span></button>`;
  }).join("");
  const weitere = weitereSets(inv);
  $("weitere-titel").hidden = $("weitere-text").hidden = !weitere.length;
  $("weitere-sets").innerHTML = weitere.map(s => {
    const teil = inv.filter(e => e.set === s), gesamt = IDX?.sets[s]?.offiziell || 0;
    const hat = new Set(teil.map(e => String(e.nr))).size, wert = teil.reduce((a, e) => a + e.summe, 0);
    stand[s] = gesamt ? `${hat}/${gesamt}` : `${hat}`;
    return `<button type="button" class="setkarte" data-set="${esc(s)}"><span><strong>${esc(setName(s))}</strong></span>
      <span class="num">${hat}${gesamt ? " / " + gesamt : ""}</span>
      <span class="voll">${gesamt ? `<span class="balken"><span style="width:${Math.min(100, hat / gesamt * 100)}%"></span></span>` : ""}<span>Wert ca. ${eur(wert)}</span></span>
      <span class="sprachen">${sprachChips(teil)}</span></button>`;
  }).join("");
  // im Filter der Sammlung einzeln wählbar
  const og = $("s-weitere");
  if (og) {
    const wahl = $("s-set").value;
    og.innerHTML = weitere.map(s => `<option value="${esc(s)}">${esc(setName(s))} · ${stand[s]}</option>`).join("");
    og.hidden = !weitere.length;
    $("s-set").value = wahl;
  }
  for (const o of $("s-set").options) if (B.setkarten[o.value] && stand[o.value]) o.textContent = `${setName(o.value)} · ${stand[o.value]}`;
  $("sonstige").innerHTML = B.sonstige.map(s => `
    <button type="button" class="karte" data-sonstige="${s.key}"><span class="bild">${bildHtml(FOTOS[s.key], s.name)}</span>
      <span class="info"><span class="k-titel">${esc(s.name)}</span><span class="meta">${esc(s.art)}</span><span class="preis">ca. ${eur(s.preis)}</span></span></button>`).join("");
}
// ---------- Binder-Plan: welche Karte in welches Fach (2 Alben mit 9 Fächern pro Seite, je 60 Seiten) ----------
// Wie katalog/binder_plan.py: jedes Set auf einer neuen Seite, Nummernfolge, Fächer für fehlende Karten bleiben frei;
// pro Nummer das beste Exemplar (1. Auflage, dann Deutsch, dann höherer Wert); neuere Karten ohne Lücken.
const ALBEN = [["Album A", ["base1", "base2", "base3", "base5", "neo1", "basep"]], ["Album B", ["gym1", "gym2"]]];
const KLEINE_SETS = ["mee", "sve", "mep"];
let binderAlbum = 0;
function binderPlan(inv) {
  const nrVon = e => typeof e.nr === "number" && e.nr < 999 ? e.nr : parseInt(String(e.nummer || "").replace(/\D.*$/, ""), 10) || 0;
  const besitz = new Map();
  for (const e of inv) { const k = `${e.set}|${nrVon(e)}`; if (!besitz.has(k)) besitz.set(k, []); besitz.get(k).push(e); }
  const bestes = l => [...l].sort((a, b) => (a.auflage !== "1. Auflage") - (b.auflage !== "1. Auflage") || (a.sprache !== "DE") - (b.sprache !== "DE") || (b.preis || 0) - (a.preis || 0))[0];
  const schutz = e => (e.preis || 0) >= 30 ? "top" : (e.preis || 0) >= 10 || e.auflage === "1. Auflage" ? "huelle" : "";
  const fach = (e, n) => { const k = kartenName(e); return { nr: n, hat: true, e, name: k.titel, de: k.unter, schutz: schutz(e) }; };
  const im = new Set();
  const alben = ALBEN.map(([titel, liste]) => [titel, liste.filter(s => s !== "basep" || inv.some(e => e.set === s)).map(s => {
    if (s === "basep" || !B.setkarten[s]) {         // Promos: nur vorhandene, ohne Lücken
      const f = [...besitz].filter(([k]) => k.startsWith(s + "|")).map(([k, l]) => fach(bestes(l), Number(k.split("|")[1]))).sort((a, b) => a.nr - b.nr);
      f.forEach(x => im.add(x.e.key)); return { name: setName(s), faecher: f, luecken: false };
    }
    const groesse = Math.max(B.setkarten[s].length, ...B.setkarten[s].map(k => k.nr));
    const faecher = [];
    for (let n = 1; n <= groesse; n++) {
      const l = besitz.get(`${s}|${n}`), anderes = s === "gym1" ? "gym2" : "gym1";
      if (l) { const f = fach(bestes(l), n); im.add(f.e.key); faecher.push(f); }
      else if ((s === "gym1" || s === "gym2") && n >= 127 && n <= 132 && besitz.has(`${anderes}|${n}`))
        faecher.push({ nr: n, verweis: `bei ${setName(anderes)}` });
      else { const k = setInfo(s, n); faecher.push({ nr: n, name: k?.name || "", hat: false }); }
    }
    return { name: setName(s), faecher, luecken: true };
  })]);
  // neuere Karten in Album B: ohne Lücken, jedes Set auf einer neuen Seite, Energien und Promos zusammen
  const neu = weitereSets(inv).filter(s => !ALBEN.some(([, l]) => l.includes(s))).reverse();
  const gruppen = neu.filter(s => !KLEINE_SETS.includes(s)).map(s => [setName(s), [s]]);
  const klein = neu.filter(s => KLEINE_SETS.includes(s));
  if (klein.length) gruppen.push(["Energien und Promos", klein]);
  for (const [name, sl] of gruppen) {
    const f = [];
    for (const s of sl) [...besitz].filter(([k]) => k.startsWith(s + "|")).sort((a, b) => Number(a[0].split("|")[1]) - Number(b[0].split("|")[1]))
      .forEach(([k, l]) => { const x = fach(bestes(l), Number(k.split("|")[1])); x.set = sl.length > 1 ? setName(s) : ""; im.add(x.e.key); f.push(x); });
    alben[1][1].push({ name, faecher: f, luecken: false });
  }
  const box = inv.reduce((a, e) => a + e.anzahl, 0) - im.size;
  return { alben, box };
}
function zeigeBinder() {
  const { alben, box } = binderPlan(inventar());
  const seitenZahl = ab => ab.reduce((a, s) => a + Math.ceil(s.faecher.length / 9), 0);
  $("b-wahl").innerHTML = alben.map(([t, ab], i) => `<button type="button" class="chip-knopf" data-album="${i}" aria-pressed="${i === binderAlbum}">${esc(t)} · ${seitenZahl(ab)} von 60 Seiten</button>`).join("");
  const huellen = alben.flatMap(([, ab]) => ab.flatMap(s => s.faecher)).filter(f => f.schutz === "huelle").length;
  $("b-info").textContent = `Jedes Set beginnt auf einer neuen Seite, gestrichelte Fächer frei lassen. ${huellen} Karten vorher in eine Penny-Hülle, ${box} Doppelte in die Box. Fach antippen: Karte ansehen.`;
  let nr = 0;
  $("b-seiten").innerHTML = alben[binderAlbum][1].flatMap(abschnitt => {
    const seiten = [];
    for (let i = 0; i < abschnitt.faecher.length; i += 9) {
      const teil = abschnitt.faecher.slice(i, i + 9);
      nr++;
      const bereich = abschnitt.luecken ? `Nr. ${teil[0].nr}–${teil.at(-1).nr} · ` : "";
      seiten.push(`<section class="b-seite"><header><span><strong>Seite ${nr}</strong> · ${esc(abschnitt.name)}</span><span class="muted">${bereich}${teil.filter(f => f.hat).length}/${teil.length}</span></header>
        <div class="b-raster">${teil.map(binderFach).join("")}${'<div class="b-fach frei"></div>'.repeat(9 - teil.length)}</div></section>`);
    }
    return seiten;
  }).join("");
}
function binderFach(f) {
  if (f.verweis) return `<div class="b-fach leer"><span class="nr">${f.nr}</span><span class="nm">→ ${esc(f.verweis)}</span></div>`;
  if (!f.hat) return `<div class="b-fach leer"><span class="nr">${f.nr}</span><span class="nm">${esc(f.name)}</span><span class="zs">fehlt</span></div>`;
  const e = f.e, zusatz = [f.set, f.de, e.sprache !== "DE" ? e.sprache : "", e.auflage === "1. Auflage" ? "1. Aufl." : "", VARIANTE_KURZ[e.variante] || ""].filter(Boolean).join(" · ");
  return `<button type="button" class="b-fach" data-key="${esc(e.key)}"><span class="nr">${f.nr}</span><span class="nm">${esc(f.name)}</span>
    ${zusatz ? `<span class="zs">${esc(zusatz)}</span>` : ""}${f.schutz ? `<span class="hl${f.schutz === "top" ? " top" : ""}">${f.schutz === "top" ? "Toploader" : "Hülle"}</span>` : ""}</button>`;
}
$("binder-knopf").addEventListener("click", () => { zeigeBinder(); $("dlg-binder").showModal(); });
$("b-wahl").addEventListener("click", e => { const b = e.target.closest("[data-album]"); if (b) { binderAlbum = Number(b.dataset.album); zeigeBinder(); $("b-seiten").scrollIntoView({ block: "start" }); } });
$("b-seiten").addEventListener("click", e => { const b = e.target.closest("[data-key]"); if (b) zeigeKarte(b.dataset.key); });

function einkaufen(fehlt) {
  const suche = $("suche").value.trim().toLowerCase(), set = $("e-set").value, sort = $("e-sort").value;
  const stufen = [...document.querySelectorAll("[data-stufe]")].filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.dataset.stufe);
  const liste = fehlt.filter(f => (!set || f.set === set) && stufen.includes(stufeKauf(f.preis)) && trifft(f, suche));
  const so = { nr: (a, b) => a.nr - b.nr, preis: (a, b) => (a.preis || 0) - (b.preis || 0), "preis-ab": (a, b) => (b.preis || 0) - (a.preis || 0) };
  $("e-treffer").textContent = `${liste.length} Karten · ca. ${eur(liste.reduce((a, f) => a + (f.preis || 0), 0))}`;
  const html = SETREIHE.filter(s => B.setkarten[s]).map(s => {
    const teil = liste.filter(f => f.set === s).sort(so[sort]);
    if (!teil.length) return "";
    return `<section style="display:grid;gap:8px"><h2>${esc(setName(s))} <span class="muted" style="font-weight:400;font-size:1rem">· ${teil.length}</span></h2>
      <ol class="liste">${teil.map(f => `<li><span class="streifen f-${stufeKauf(f.preis)}"></span>${bildHtml(setBild(s, f.nr))}
        <span class="name">${esc(f.name)}${f.holo ? ` <span class="chip gelb">Holo</span>` : ""}<span class="unter"><span class="mono">${f.nummer}</span>${f.seltenheit ? " · " + esc(f.seltenheit) : ""} · <a href="${cm(f.name)}" target="_blank" rel="noopener">Cardmarket</a></span></span>
        <span class="rechts">ca. ${eur(f.preis)}${schreibbar ? `<button type="button" class="knopf" data-kaufen="${s}|${f.nr}">Gekauft</button>` : ""}</span></li>`).join("")}</ol></section>`;
  }).join("");
  $("e-listen").innerHTML = html || `<div class="leer">Keine fehlende Karte passt zu diesen Filtern.</div>`;
}
function verkaufen(inv) {
  const st = e => (e.preis || 0) >= 3 ? 1 : ((e.preis || 0) >= 1 || e.auflage === "1. Auflage") ? 2 : 3;
  const summe = n => { const t = inv.filter(e => st(e) === n); return { stueck: t.reduce((a, e) => a + e.anzahl, 0), richt: t.reduce((a, e) => a + (richtpreis(e) || 0) * e.anzahl, 0) }; };
  const [s1, s2, s3] = [1, 2, 3].map(summe);
  const erloes = VK.reduce((a, v) => a + (Number(v.preis) || 0), 0);
  $("v-stufen").innerHTML = `
    <div><span class="muted">1 · Einzeln</span><span class="wert">${eur(s1.richt)}</span><small class="muted">${s1.stueck} Karten</small></div>
    <div><span class="muted">2 · Günstig / Set-Paket</span><span class="wert">${eur(s2.richt)}</span><small class="muted">${s2.stueck} Karten</small></div>
    <div><span class="muted">Schon verkauft</span><span class="wert">${eur(erloes)}</span><small class="muted">${VK.reduce((a, v) => a + (Number(v.anzahl) || 0), 0)} Karten, dazu ${s3.stueck} im Restposten</small></div>`;
  const liste = inv.filter(e => st(e) === 1).sort((a, b) => (b.preis || 0) - (a.preis || 0));
  $("v-einzeln").innerHTML = liste.map(e => `<li style="cursor:pointer" data-key="${esc(e.key)}"><span class="streifen" style="background:var(--accent)"></span>${bildHtml(bildVon(e), e.name)}
    <span class="name">${esc(kartenName(e).titel)}${e.anzahl > 1 ? ` <span class="muted">×${e.anzahl}</span>` : ""}<span class="unter">${kartenName(e).unter ? esc(kartenName(e).unter) + " · " : ""}${esc(setName(e.set))} · <span class="mono">${esc(e.nummer)}</span> · ${esc(e.sprache)}${e.auflage === "1. Auflage" ? " · 1. Aufl." : ""}</span></span>
    <span class="rechts"><strong>${eur(richtpreis(e))}</strong><span class="muted" style="font-size:0.8rem">Markt ${eur(e.preis)}</span></span></li>`).join("");
}
function verlauf() {
  const eintraege = [...ZUG.map(z => ({ ...z, art: "zugang" })), ...VK.map(v => ({ ...v, art: "verkauf" }))]
    .sort((a, b) => (b.erstellt || "").localeCompare(a.erstellt || ""));
  const ausgegeben = ZUG.reduce((a, z) => a + (Number(z.bezahlt) || 0), 0), eingenommen = VK.reduce((a, v) => a + (Number(v.preis) || 0), 0);
  $("h-summen").innerHTML = `
    <div><span class="muted">Hinzugefügt</span><span class="wert">${ZUG.reduce((a, z) => a + (Number(z.anzahl) || 0), 0)}</span><small class="muted">Karten über die App</small></div>
    <div><span class="muted">Ausgegeben</span><span class="wert">${eur(ausgegeben)}</span><small class="muted">soweit eingetragen</small></div>
    <div><span class="muted">Eingenommen</span><span class="wert">${eur(eingenommen)}</span><small class="muted">${VK.length} Verkäufe</small></div>`;
  $("h-liste").innerHTML = eintraege.length ? eintraege.map(x => `<li><span class="streifen" style="background:${x.art === "zugang" ? "var(--guenstig)" : "var(--teuer)"}"></span>
    ${bildHtml(x.art === "zugang" && x.foto ? fotoUrl(x.foto) || setBild(x.set, x.nr, x.id_karte) : setBild(x.set, x.nr, x.id_karte))}
    <span class="name">${x.art === "zugang" ? "＋" : "−"} ${esc(kartenName({ id: x.id_karte, sprache: x.sprache, name: x.name }).titel)} ${Number(x.anzahl) > 1 ? `×${x.anzahl}` : ""}
      <span class="unter">${esc(setName(x.set))} ${x.nummer ? "· " + esc(x.nummer) : ""} · ${esc(x.sprache || "")} · ${datumText(x.datum)} · ${esc(x.art === "zugang" ? x.herkunft : x.plattform)}${x.notiz ? " · " + esc(x.notiz) : ""}</span></span>
    <span class="rechts">${x.art === "zugang" ? (x.bezahlt != null ? eur(x.bezahlt) : "") : eur(x.preis)}${schreibbar ? `<button type="button" class="knopf gefahr" data-loeschen="${x.art}|${x.id}">Löschen</button>` : ""}</span></li>`).join("")
    : `<li style="display:block;padding:14px"><span class="muted">Noch keine Einträge. Neue Karten erfasst du mit dem Knopf „＋ Karte“ unten rechts, Verkäufe über eine Karte in der Sammlung.</span></li>`;
}

// ---------- Tabs, Filter ----------
function zeigeTab(name) {
  if (!["sammlung", "sets", "einkaufen", "verkaufen", "verlauf"].includes(name)) name = "sammlung";
  tab = name;
  document.querySelectorAll("[data-tab]").forEach(b => { b.setAttribute("aria-selected", b.dataset.tab === name); b.tabIndex = b.dataset.tab === name ? 0 : -1; });
  document.querySelectorAll(".panel").forEach(p => { p.hidden = p.id !== "panel-" + name; });
  if (location.hash.slice(1) !== name) history.replaceState(null, "", location.search + "#" + name);
  const p = $("panel-" + name); if (p.getBoundingClientRect().top < 0) p.scrollIntoView();
}
document.querySelector(".tabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) zeigeTab(b.dataset.tab); });
$("suche").addEventListener("input", () => { if (!["sammlung", "einkaufen"].includes(tab)) zeigeTab("sammlung"); alles(); });
["s-set", "s-sprache", "s-sort", "s-doppelt", "s-fehlend", "e-set", "e-sort"].forEach(id => $(id).addEventListener("input", alles));
$("s-fehlend").addEventListener("change", e => { merke("fehlende-zeigen", e.target.checked ? "1" : ""); if (e.target.checked) { $("s-sort").value = "set"; alles(); } });
$("s-fehlend").checked = lies("fehlende-zeigen") === "1";
document.querySelectorAll("[data-stufe]").forEach(b => b.addEventListener("click", () => { b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"); alles(); }));
$("sets").addEventListener("click", zeigeSet);
$("weitere-sets").addEventListener("click", zeigeSet);
function zeigeSet(e) {   // Set antippen: in der Sammlung als Checkliste zeigen
  const b = e.target.closest("[data-set]"); if (!b) return;
  $("s-set").value = b.dataset.set; $("s-sprache").value = ""; $("s-doppelt").checked = false; $("s-fehlend").checked = true; $("s-sort").value = "set";
  alles(); zeigeTab("sammlung");
}

// ---------- Dialoge ----------
document.querySelectorAll("dialog").forEach(d => {
  d.addEventListener("click", e => { if (e.target === d || e.target.closest("[data-zu]")) d.close(); });
});

function zeigeKarte(key) {
  const e = inventar().find(x => x.key === key); if (!e) return;
  const n = kartenName(e);
  $("k-titel").textContent = n.titel;
  $("k-bild").innerHTML = bildHtml(bildVon(e), e.name);
  const teile = [`${e.anzahl} Stück`];
  if (e.zugang) teile.push(`${e.zugang} über die App hinzugefügt`);
  if (e.verkauft) teile.push(`${e.verkauft} verkauft`);
  $("k-info").innerHTML = `${n.unter ? `<div>Deutsch: ${esc(n.unter)}</div>` : ""}<div class="muted">${esc(setName(e.set))} · <span class="mono">${esc(e.nummer)}</span> · ${esc(e.sprache)} · ${esc(e.auflage)}${VARIANTE_KURZ[e.variante] ? " · " + VARIANTE[e.variante] : ""}${e.seltenheit ? " · " + esc(e.seltenheit) : ""}</div>
    <div>${teile.join(" · ")}</div>
    <div>Marktwert <strong class="num">${eur(e.preis)}</strong> pro Stück${richtpreis(e) ? ` · Angebotspreis ca. <strong class="num">${eur(richtpreis(e))}</strong>` : ""}</div>
    <div><a href="${cm(e.name)}" target="_blank" rel="noopener">Auf Cardmarket ansehen</a></div>`;
  $("k-aktionen").innerHTML = schreibbar ? `<button type="button" class="knopf" id="k-mehr">Weiteres Exemplar</button><button type="button" class="knopf voll" id="k-verkauf">Verkauf erfassen</button>` : "";
  if (schreibbar) {
    $("k-mehr").onclick = () => { $("dlg-karte").close(); oeffneNeu({ set: e.set, nr: e.nr, sprache: e.sprache, auflage: e.auflage, variante: e.variante, id: e.id }); };
    $("k-verkauf").onclick = () => { $("dlg-karte").close(); oeffneVerkauf(e); };
  }
  $("dlg-karte").showModal();
}
document.addEventListener("click", e => {
  const k = e.target.closest("[data-key]"); if (k && !e.target.closest("a")) { zeigeKarte(k.dataset.key); return; }
  const f = e.target.closest("[data-fehlt]");
  if (f) { const [set, nr] = f.dataset.fehlt.split("|"); if (schreibbar) oeffneNeu({ set, nr: Number(nr), herkunft: "Gekauft" }); return; }
  const kauf = e.target.closest("[data-kaufen]");
  if (kauf) { const [set, nr] = kauf.dataset.kaufen.split("|"); oeffneNeu({ set, nr: Number(nr), herkunft: "Gekauft" }); return; }
  const s = e.target.closest("[data-sonstige]");
  if (s) { const x = B.sonstige.find(y => y.key === s.dataset.sonstige); $("k-titel").textContent = x.name; $("k-bild").innerHTML = bildHtml(FOTOS[x.key], x.name);
    $("k-info").innerHTML = `<div class="muted">${esc(x.art)} · ${esc(x.set)}</div><div>${esc(x.beschreibung)}</div><div>ca. ${eur(x.preis)} (${zahl.format(x.tief)} bis ${eur(x.hoch)}, grobe Schätzung)</div>`;
    $("k-aktionen").innerHTML = ""; $("dlg-karte").showModal(); return; }
  const l = e.target.closest("[data-loeschen]"); if (l) frageLoeschen(l.dataset.loeschen);
});

// ---------- Karte hinzufügen / prüfen ----------
let neuFoto = null, anders = null, modus = "neu", erkennung = null;
let setVonHand = null;   // von Hand gewähltes Set – „Mit Nummer suchen“ sucht dann nur dort
const kannErkennen = () => !!EINST.gemini && !!IDX;
// Keine Vorauswahl: gespeichert wird nur eine erkannte oder bewusst gewählte Karte
function fuelleSets() {
  $("n-set").innerHTML = `<option value="">– Set wählen –</option>` + SETREIHE.filter(s => B.setkarten[s]).map(s => `<option value="${s}">${esc(setName(s))}</option>`).join("") + `<option value="anderes">Anderes Set …</option>`;
}
function fuelleKarten(nr) {
  const set = $("n-set").value, frei = set === "anderes";
  $("n-karte").closest("label").hidden = frei || !set; $("n-frei").hidden = !frei || !!anders; $("n-anders").hidden = !frei || !anders;
  for (const id of ["n-asuche", "n-aset-feld", "n-akarte-feld"]) $(id).hidden = !frei || !IDX;
  if (!set) { $("n-karte").innerHTML = ""; return; }
  if (frei) {
    if (IDX) fuelleAndereSets();
    if (anders) $("n-anders").innerHTML = `<div class="besitz zeile" style="border:0;padding:0;background:none"><div class="zeile">${bildHtml(anders.bild ? anders.bild + "/low.jpg" : null)}
      <div><strong>${esc(dlgName(anders.id, anders.de))}</strong><div class="muted" style="font-size:0.88rem">${esc(setName(anders.set))} · <span class="mono">${esc(nummerVon(anders))}</span></div></div></div></div>`;
    return;
  }
  $("n-karte").innerHTML = `<option value="">– Karte wählen –</option>` + B.setkarten[set].map(k => `<option value="${k.nr}">${k.nr} · ${esc(k.name)}${k.holo ? " (Holo)" : ""}</option>`).join("");
  $("n-karte").value = nr != null ? String(nr) : "";
}
// Anderes Set: alle Sets aus dem Kartenverzeichnis, mit Suche nach Name, deutschem Name oder Kürzel
let verzeichnis = null;   // Set-ID → Karten, einmal je Kartenverzeichnis
function kartenJeSet() {
  if (verzeichnis?.idx !== IDX) {
    verzeichnis = { idx: IDX, sets: {} };
    for (const k of IDX.karten) (verzeichnis.sets[k.set] ??= []).push(k);
  }
  return verzeichnis.sets;
}
const suchtext = s => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function fuelleAndereSets() {
  const woerter = suchtext($("n-asuche-text").value).split(/\s+/).filter(Boolean), wahl = anders?.set || $("n-aset").value;
  const sets = Object.values(IDX.sets).filter(s => kartenJeSet()[s.id]).reverse()   // neueste zuerst
    .filter(s => woerter.every(w => suchtext(`${s.name} ${s.name_de} ${s.kuerzel} ${s.id} ${s.serie}`).includes(w)));
  const gruppen = new Map();
  for (const s of sets) { if (!gruppen.has(s.serie)) gruppen.set(s.serie, []); gruppen.get(s.serie).push(s); }
  $("n-aset").innerHTML = `<option value="">${sets.length ? `– Set wählen (${sets.length}) –` : "– kein Set gefunden –"}</option>` +
    [...gruppen].map(([serie, l]) => `<optgroup label="${esc(serie || "Sonstige")}">` +
      l.map(s => `<option value="${s.id}">${esc(s.name_de || s.name)}${s.kuerzel ? " · " + esc(s.kuerzel) : ""}</option>`).join("") + "</optgroup>").join("");
  const genau = sets.filter(s => woerter.length === 1 && suchtext(s.kuerzel) === woerter[0]);   // „MEE“ = genau dieses Kürzel
  $("n-aset").value = sets.some(s => s.id === wahl) ? wahl : sets.length === 1 ? sets[0].id : genau.length === 1 ? genau[0].id : "";
  fuelleAndereKarten();
}
function fuelleAndereKarten() {
  const sid = $("n-aset").value, l = sid ? kartenJeSet()[sid] || [] : [];
  $("n-akarte").innerHTML = `<option value="">${sid ? "– Karte wählen –" : "– zuerst Set wählen –"}</option>` +
    l.map(k => `<option value="${k.id}">${esc(k.nr)} · ${esc(dlgName(k.id, k.de))}</option>`).join("");
  $("n-akarte").value = anders?.set === sid ? anders.id : "";
}
function andereKarteWeg() { anders = null; fuelleKarten(); zeigeBesitz(); markiereKandidat(); }
$("n-asuche-text").addEventListener("input", () => { if (anders) andereKarteWeg(); else fuelleAndereSets(); });
$("n-asuche-text").addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); });
$("n-aset").addEventListener("change", () => { setVonHand = $("n-aset").value || null; if (anders) andereKarteWeg(); else fuelleAndereKarten(); });
$("n-akarte").addEventListener("change", () => { const id = $("n-akarte").value; if (id) uebernimm(id, true); else andereKarteWeg(); });
function nummerVon(k) { const s = IDX.sets[k.set]; return s?.offiziell ? `${k.nr}/${s.offiziell}` : k.nr; }
const SPRACHE = { DE: "Deutsch", EN: "Englisch", FR: "Französisch", IT: "Italienisch", ES: "Spanisch", PT: "Portugiesisch",
  NL: "Niederländisch", JP: "Japanisch", KO: "Koreanisch", ZH: "Chinesisch", andere: "andere Sprache" };
// Varianten neuerer Karten (gleiche Nummer, anderer Glitzer, anderer Preis)
const VARIANTE = { normal: "Standard (wie gedruckt)", reverse: "Reverse Holo", pokeball: "Pokéball-Muster", meisterball: "Meisterball-Muster" };
const VARIANTE_KURZ = { reverse: "Reverse", pokeball: "Pokéball", meisterball: "Meisterball" };
const VARIANTE_VON_GEMINI = { reverse: "reverse", pokeball: "pokeball", meisterball: "meisterball" };
const schluessel = (id, sprache, auflage, variante) => `${id}|${sprache}|${auflage}` + (VARIANTE_KURZ[variante] ? `|${variante}` : "");
const VARIANTENPREIS = {};
function variantenPreis(id, variante) {   // live von TCGdex, einmal je Karte und Variante
  const k = `${id}|${variante}`;
  if (!(k in VARIANTENPREIS)) {
    VARIANTENPREIS[k] = undefined;
    livePreis(id, variante).then(p => { VARIANTENPREIS[k] = p; if ($("dlg-neu").open) zeigeBesitz(); });
  }
  return VARIANTENPREIS[k];
}
// gewählte Karte als {set, nr, name, nummer, id, preis, bild, variante}
function gewaehlt() {
  const set = $("n-set").value, variante = $("n-variante").value;
  let g = null;
  if (set === "anderes") {
    if (!anders) return null;
    const nr = /^\d+$/.test(anders.nr) ? Number(anders.nr) : anders.nr;
    g = { set: anders.set, nr, name: anders.de, nummer: nummerVon(anders), id: anders.id, preis: anders.preis ?? null, bild: anders.bild && anders.bild + "/low.jpg" };
  } else {
    if (!set || !$("n-karte").value) return null;
    const nr = Number($("n-karte").value), sk = setInfo(set, nr);
    if (!sk) return null;
    g = { set, nr, name: sk.name, nummer: sk.nummer, id: sk.id, preis: sk.preis, bild: setBild(set, nr) };
  }
  g.variante = variante;
  if (VARIANTE_KURZ[variante]) g.preis = variantenPreis(g.id, variante) ?? null;
  return g;
}
function zeigeBesitz() {
  const feld = $("n-besitz"), g = gewaehlt();
  if (!g) { feld.hidden = true; return; }
  const sp = $("n-sprache").value, au = $("n-auflage").value, va = g.variante;
  const hat = inventar().filter(e => (e.set === g.set && String(e.nr) === String(g.nr)) || gleicherPlatz(e, g));
  const karte = `${esc(dlgName(g.id, g.name))} · ${esc(setName(g.set))} <span class="mono">${esc(g.nummer)}</span>`;
  const huelle = (klasse, text) => {
    feld.className = "besitz " + klasse;
    feld.innerHTML = `<div class="zeile">${g.bild ? `<img src="${esc(g.bild)}" alt="Bild der erkannten Karte">` : ""}<div>${text}<div class="muted" style="font-size:0.88rem">${karte}</div></div></div>`;
  };
  feld.hidden = false;
  const variantenText = VARIANTE_KURZ[va] ? `<div>Variante: <strong>${VARIANTE[va]}</strong></div>` : "";
  if (!hat.length) { huelle("fehlt", `<strong class="gross-text">Fehlt dir noch!</strong>${variantenText}<div>Marktwert ca. ${eur(g.preis)}</div>`); return; }
  const teile = hat.map(e => `${e.anzahl}× ${SPRACHE[e.sprache] || e.sprache}${e.auflage === "1. Auflage" ? " (1. Auflage)" : ""}${VARIANTE_KURZ[e.variante] ? " " + VARIANTE[e.variante] : ""}`);
  const genau = hat.some(e => e.sprache === sp && e.auflage === au && (e.variante || "normal") === va);
  huelle("hat", `<strong class="gross-text">Hast du schon</strong>${variantenText}<div>${teile.join(", ")}.` +
    (genau ? " Diese wäre ein weiteres Exemplar." : ` Die Variante ${SPRACHE[sp] || sp}${au === "1. Auflage" ? ", 1. Auflage" : ""}${VARIANTE_KURZ[va] ? ", " + VARIANTE[va] : ""} hast du noch nicht.`) +
    `</div>${VARIANTE_KURZ[va] ? `<div>Marktwert ca. ${eur(g.preis)}</div>` : ""}`);
}
function setzeModus(m) {
  modus = m;
  $("neu-titel").textContent = m === "pruefen" ? "Karte prüfen" : "Karte hinzufügen";
  document.querySelectorAll("#form-neu .nur-neu").forEach(el => { el.hidden = m === "pruefen"; });
  $("n-speichern").hidden = m === "pruefen";
  $("n-wechsel").hidden = !(m === "pruefen" && schreibbar);
  $("n-naechste").hidden = !(m === "pruefen");
  $("n-foto-knopf").hidden = false; $("n-galerie-knopf").hidden = false;
  $("n-formular").hidden = m === "pruefen" && kannErkennen();   // beim Scannen keine Auswahlfelder
  $("n-korrigieren").hidden = true;
}
$("n-korrigieren").addEventListener("click", () => { $("n-formular").hidden = false; $("n-korrigieren").hidden = true; if (erkennung?.tipp.length > 1) zeigeKandidaten(); });
$("n-set").addEventListener("change", () => {
  const set = $("n-set").value;
  setVonHand = set && set !== "anderes" ? set : null;
  anders = set === "anderes" ? anders : null; fuelleKarten(); zeigeBesitz(); markiereKandidat();
});
["n-karte", "n-sprache", "n-auflage", "n-variante"].forEach(id => $(id).addEventListener("change", () => { zeigeBesitz(); markiereKandidat(); zeigeStempel(); }));
$("n-sprache").addEventListener("change", () => {   // andere Sprache: Kartennamen im Dialog anpassen
  if ($("n-set").value === "anderes") fuelleKarten();
  if (!$("n-kandidaten").hidden) zeigeKandidaten();
  const m = $("n-meldung"), g = gewaehlt();
  if (g && /^Erkannt: /.test(m.textContent)) m.textContent = m.textContent.replace(/^Erkannt: [^,]*,/, `Erkannt: ${dlgName(g.id, g.name)},`);
});
$("n-wechsel").addEventListener("click", () => {
  setzeModus("neu"); $("n-datum").value = heute(); $("n-anzahl").value = 1; $("n-erkennen").hidden = true; $("n-formular").hidden = false;
});
function oeffneNeu(vor = {}) {
  const m = vor.modus || "neu";
  if (m === "neu" && !schreibbar) { toast("Zum Speichern bitte zuerst GitHub in den Einstellungen einrichten."); return; }
  fuelleSets();
  $("form-neu").reset(); neuFoto = null; anders = null; erkennung = null; setVonHand = null; speicherId = null;
  $("n-vorschau").innerHTML = `<div class="leerbild"></div>`;
  $("n-meldung").className = "meldung"; $("n-meldung").textContent = "Mach ein Foto der Vorderseite. Die Nummer unten rechts sollte lesbar sein.";
  $("n-speichern-meldung").textContent = ""; $("n-erkennen").hidden = true; $("n-nurbild").hidden = true;
  $("n-kandidaten").hidden = true; $("n-stempel").hidden = true; $("n-nummer").value = "";
  if (vor.set && !B.setkarten[vor.set] && vor.id && IDX?.karte(vor.id)) { anders = { ...IDX.karte(vor.id) }; $("n-set").value = "anderes"; }
  else $("n-set").value = vor.set && B.setkarten[vor.set] ? vor.set : "";
  fuelleKarten(vor.nr);
  $("n-sprache").value = vor.sprache || "DE"; $("n-auflage").value = vor.auflage || "normal"; $("n-variante").value = vor.variante || "normal";
  $("n-herkunft").value = vor.herkunft || "Gekauft"; $("n-datum").value = heute(); $("n-anzahl").value = 1;
  setzeModus(m);
  if (m === "pruefen") {
    $("n-besitz").hidden = true;
    $("n-meldung").textContent = kannErkennen() ? "Fotografiere die Karte, die App sagt dir, ob du sie schon hast." : "Wähle Set und Karte, die App sagt dir, ob du sie schon hast. Für die automatische Erkennung fehlt der Gemini-Schlüssel.";
    if (!kannErkennen()) zeigeBesitz();
  } else zeigeBesitz();
  $("dlg-neu").showModal();
}
$("fab").addEventListener("click", () => oeffneNeu());
function scannen() {
  oeffneNeu({ modus: "pruefen" });
  if (kannErkennen()) $("n-foto").click();   // öffnet direkt die Kamera
}
$("fab-pruefen").addEventListener("click", scannen);
$("n-naechste").addEventListener("click", scannen);

async function verkleinere(datei, max = 1600) {
  const bild = await createImageBitmap(datei, { imageOrientation: "from-image" }).catch(() => null);
  if (!bild) return datei;
  const f = Math.min(1, max / Math.max(bild.width, bild.height));
  const c = document.createElement("canvas"); c.width = Math.round(bild.width * f); c.height = Math.round(bild.height * f);
  c.getContext("2d").drawImage(bild, 0, 0, c.width, c.height);
  return await new Promise(r => c.toBlob(b => r(b || datei), "image/jpeg", 0.85));
}
// Foto von der Kamera oder ein Bild aus der Galerie – danach gleicher Ablauf
async function fotoGewaehlt(e) {
  const datei = e.target.files && e.target.files[0]; if (!datei) return;
  e.target.value = "";   // dasselbe Bild darf nochmal gewählt werden
  $("n-meldung").className = "meldung"; $("n-meldung").textContent = "Foto wird vorbereitet …";
  neuFoto = await verkleinere(datei);
  $("n-vorschau").innerHTML = `<img src="${URL.createObjectURL(neuFoto)}" alt="Dein Foto">`;
  $("n-erkennen").hidden = !kannErkennen();
  $("n-meldung").textContent = kannErkennen() ? "Tippe auf „Karte erkennen“ oder wähle Set und Karte selbst." : "Wähle jetzt Set und Karte aus.";
  if (kannErkennen()) erkenne();
}
$("n-foto").addEventListener("change", fotoGewaehlt);
$("n-galerie").addEventListener("change", fotoGewaehlt);
$("n-erkennen").addEventListener("click", () => erkenne());
$("n-nurbild").addEventListener("click", () => erkenne({ ohneKI: true }));

// Ausschnitt der Stempel-Stelle – bei allen Sets mit Erstauflage, damit ein übersehener Stempel auffällt
function zeigeStempel() {
  const g = gewaehlt(), feld = $("n-stempel");
  if (!erkennung?.stempel || !g || !ERSTAUFLAGE_SETS.includes(g.set)) { feld.hidden = true; return; }
  const erste = $("n-auflage").value === "1. Auflage";
  feld.hidden = false;
  feld.innerHTML = `<img src="${stempelUrl()}" alt="Ausschnitt der Stelle für den Stempel"><span style="display:grid;gap:6px;justify-items:start">
    <span>${erste ? "<strong>Stempel „1. Auflage“ erkannt.</strong> Siehst du ihn im Ausschnitt?" : "Kein Stempel erkannt – <strong>normale Auflage</strong>."}</span>
    <button type="button" class="knopf" id="n-stempel-wechsel">${erste ? "Kein Stempel – normale Auflage" : "Doch Stempel – 1. Auflage"}</button></span>`;
  $("n-stempel-wechsel").onclick = () => {
    $("n-auflage").value = erste ? "normal" : "1. Auflage"; zeigeBesitz(); zeigeStempel();
    const m = $("n-meldung"); if (/^Erkannt: /.test(m.textContent))
      m.textContent = m.textContent.replace(", 1. Auflage", "").replace(/\. Stimmt das Bild\?$/, (erste ? "" : ", 1. Auflage") + ". Stimmt das Bild?");
  };
}
let stempelUrlCache = null;
function stempelUrl() {
  if (stempelUrlCache?.blob !== erkennung.stempel) stempelUrlCache = { blob: erkennung.stempel, url: URL.createObjectURL(erkennung.stempel) };
  return stempelUrlCache.url;
}

// Treffer übernehmen: Karte aus den eigenen Sets oder aus einem anderen Set
function uebernimm(id, vonHand = false) {
  const k = IDX.karte(kanonisch(id)); if (!k) return;
  if (!vonHand) setVonHand = null;   // Set kam aus der Erkennung, nicht vom Besitzer
  const nr = /^\d+$/.test(k.nr) ? Number(k.nr) : null;
  if (B.setkarten[k.set] && nr != null && setInfo(k.set, nr)) { anders = null; $("n-set").value = k.set; fuelleKarten(nr); }
  else {
    anders = { ...k, preis: undefined }; $("n-set").value = "anderes"; fuelleKarten();
    livePreis(k.id).then(p => { if (anders?.id === k.id) { anders.preis = p; zeigeBesitz(); } });
  }
  zeigeBesitz(); markiereKandidat();
}
function zeigeKandidaten() {
  const liste = erkennung?.tipp || [];
  if (liste.length < 2) { $("n-kandidaten").hidden = true; return; }
  $("n-kandidaten").hidden = false;
  $("n-kandidaten").innerHTML = `<strong>${erkennung.status === "pruefen" ? "Bitte prüfen: Welche Karte ist es?" : "Andere mögliche Karten"}</strong>
    <div class="reihe">${liste.map(id => { const k = IDX.karte(id);
      return `<button type="button" class="kandidat" data-kandidat="${esc(id)}" aria-pressed="false">${bildHtml(k?.bild ? k.bild + "/low.jpg" : null, k?.de)}
        <span><strong>${esc(k ? dlgName(id, k.de) : id)}</strong><br><span class="muted">${esc(setName(k?.set))} · ${esc(k ? nummerVon(k) : "")}</span></span></button>`; }).join("")}</div>`;
  markiereKandidat();
}
function markiereKandidat() {
  const g = gewaehlt();
  document.querySelectorAll("[data-kandidat]").forEach(b => b.setAttribute("aria-pressed", String(!!g && b.dataset.kandidat === g.id)));
}
$("n-kandidaten").addEventListener("click", e => { const b = e.target.closest("[data-kandidat]"); if (b) { uebernimm(b.dataset.kandidat); zeigeStempel(); } });

const FEHLERTEXT = {
  kontingent: "Das Gratis-Kontingent von Gemini ist für heute aufgebraucht (ab 9 Uhr wieder frei). Du kannst ohne KI vergleichen oder selbst auswählen.",
  zu_schnell: "Gerade zu viele Anfragen an Gemini. Bitte kurz warten oder ohne KI vergleichen.",
  ueberlastet: "Gemini ist gerade überlastet. Bitte nochmal versuchen oder ohne KI vergleichen.",
  schluessel: "Der Gemini-Schlüssel wird nicht akzeptiert. Bitte in den Einstellungen prüfen.",
  offline: "Keine Internetverbindung. Bitte Set und Karte selbst auswählen.",
};
async function erkenne({ ohneKI = false } = {}) {
  if (!neuFoto || !IDX) return;
  const knopf = $("n-erkennen"); knopf.disabled = true; $("n-nurbild").hidden = true;
  $("n-kandidaten").hidden = true; $("n-stempel").hidden = true; $("n-besitz").hidden = true; $("n-korrigieren").hidden = true;
  const meldung = $("n-meldung"); meldung.className = "meldung";
  const fortschritt = t => { meldung.textContent = t; };
  try {
    erkennung = ohneKI
      ? await nurBild(neuFoto, IDX, SETREIHE.filter(s => B.setkarten[s]), fortschritt)
      : await bestimme(neuFoto, IDX, EINST.gemini, fortschritt, $("n-nummer").value.trim());
    zeigeErkennung(ohneKI);
  } catch (e) {
    meldung.className = "meldung fehler";
    meldung.textContent = FEHLERTEXT[e?.code] || "Die Karte konnte nicht erkannt werden. Bitte Set und Karte selbst auswählen.";
    $("n-nurbild").hidden = !["kontingent", "zu_schnell", "ueberlastet", "leer", "fehler"].includes(e?.code);
    $("n-formular").hidden = false; zeigeBesitz();
  } finally { knopf.disabled = false; knopf.hidden = !kannErkennen() || modus === "pruefen"; }
}
// Ergebnis anzeigen (nach dem Foto oder nach „Mit Nummer suchen“)
function zeigeErkennung(ohneKI = false) {
  const meldung = $("n-meldung"); meldung.className = "meldung";
  $("n-kandidaten").hidden = true;
  {
    const r = erkennung.antwort;
    if (!erkennung.tipp.length) {
      meldung.textContent = `Die Karte${r?.name ? " „" + r.name + "“" : ""} wurde nicht gefunden. Trag die Nummer ein oder wähle Set und Karte selbst.`;
      $("n-formular").hidden = false; zeigeBesitz(); return;
    }
    uebernimm(erkennung.tipp[0]);
    if (r) {
      $("n-sprache").value = SPRACHE[r.sprache] && r.sprache !== "andere" ? r.sprache : "andere";
      $("n-auflage").value = r.erste_auflage ? "1. Auflage" : "normal";
      $("n-variante").value = VARIANTE_VON_GEMINI[r.glitzer] || "normal";
      if ($("n-set").value === "anderes") fuelleKarten();   // Namen in der erkannten Sprache
    }
    zeigeBesitz(); zeigeStempel();
    const g = gewaehlt();
    if (erkennung.status === "ok") {
      meldung.textContent = `Erkannt: ${dlgName(g.id, g.name)}, ${setName(g.set)} ${g.nummer}${$("n-auflage").value === "1. Auflage" ? ", 1. Auflage" : ""}. Stimmt das Bild?`;
      if (modus === "pruefen") $("n-korrigieren").hidden = false;
    } else {
      meldung.textContent = ohneKI ? "Ohne KI verglichen: Bitte die richtige Karte antippen oder selbst auswählen." : "Nicht ganz eindeutig – bitte die richtige Karte antippen.";
      if (r) meldung.textContent += ` (Gemini las: ${r.name || "?"} · ${r.nummer || "keine Nummer"} · ${r.set || "?"})`;
      zeigeKandidaten();
      if (modus === "pruefen") $("n-korrigieren").hidden = false;
    }
  }
}
// Kartennummer eintippen: vor dem Foto als Hinweis für Gemini, danach zum sofortigen Neu-Zuordnen
async function nummerSuchen() {
  const eingabe = $("n-nummer").value.trim();
  if (!eingabe || !IDX) return;
  // „MEE 007“: Kürzel bestimmt das Set; sonst ein von Hand gewähltes Set
  const h = nummerMitKuerzel(eingabe, IDX), nurSets = h.sets || (setVonHand ? [setVonHand] : null);
  if (!nurSets && !erkennung && neuFoto && kannErkennen()) { erkenne(); return; }
  const wo = nurSets ? ` in ${nurSets.map(setName).join(" / ")}` : "";
  $("n-meldung").className = "meldung"; $("n-meldung").textContent = `Suche Karten mit dieser Nummer${wo} …`;
  let neu = await neuZuordnen(erkennung, h.nummer, IDX, nurSets);
  if (!neu.tipp.length && nurSets) neu = await neuZuordnen(erkennung, eingabe, IDX);   // im Set nichts: überall suchen
  if (!neu.tipp.length) { $("n-meldung").textContent = `Keine Karte mit der Nummer ${eingabe}${wo} gefunden. Bitte so eingeben, wie sie auf der Karte steht, z. B. 046/086 oder MEE 007.`; return; }
  erkennung = neu;
  const gemerkt = setVonHand;
  if (!erkennung.antwort && erkennung.tipp.length > 1) erkennung.status = "pruefen";
  zeigeErkennung();
  setVonHand = gemerkt;   // weitere Suche bleibt im gewählten Set
  if (h.sprache && SPRACHE[h.sprache]) { $("n-sprache").value = h.sprache; zeigeBesitz(); }   // „MEE FR 007“
}
$("n-nummer-suchen").addEventListener("click", nummerSuchen);
$("n-nummer").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); nummerSuchen(); } });

const neueId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
// gleiche ID bei einem zweiten Versuch: kam der erste doch an, entsteht kein doppelter Eintrag und kein zweites Foto
let speicherId = null;
$("form-neu").addEventListener("submit", async ev => {
  ev.preventDefault();
  if (modus === "pruefen" || !schreibbar) return;
  const meldung = $("n-speichern-meldung"), knopf = $("n-speichern");
  const sprache = $("n-sprache").value, auflage = $("n-auflage").value, variante = $("n-variante").value;
  let eintrag;
  if ($("n-set").value !== "anderes" && !gewaehlt()) {
    meldung.textContent = "Noch keine Karte gewählt: Foto machen und erkennen lassen, die Nummer eintippen oder Set und Karte auswählen.";
    return;
  }
  if ($("n-set").value === "anderes" && !anders) {
    const text = $("n-freitext").value.trim();
    if (!text) { meldung.textContent = "Bitte Name, Set und Nummer eintragen."; return; }
    eintrag = { set: "anderes", nr: 999, name: text, nummer: "", key: `anderes-${text.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "-")}|${sprache}|${auflage}` };
  } else {
    const g = gewaehlt();
    eintrag = { set: g.set, nr: g.nr, name: g.name, nummer: g.nummer, id_karte: g.id, key: schluessel(g.id, sprache, auflage, variante),
                ...(VARIANTE_KURZ[variante] ? { variante } : {}),
                ...(B.setkarten[g.set] && !VARIANTE_KURZ[variante] ? {} : { preis: g.preis ?? null }) };
  }
  const anzahl = Math.max(1, Math.min(99, parseInt($("n-anzahl").value, 10) || 1));
  const id = speicherId ??= neueId();
  knopf.disabled = true; meldung.textContent = neuFoto ? "Foto wird hochgeladen …" : "Speichert …";
  try {
    let foto = null;
    if (neuFoto) { foto = `${PFADE.fotoOrdner}${id}.jpg`; await speicher.fotoHochladen(foto, neuFoto, `Foto: ${eintrag.name}`); FOTOURL[foto] = URL.createObjectURL(neuFoto); }
    meldung.textContent = "Speichert …";
    const neu = { id, ...eintrag, sprache, auflage, anzahl, foto, herkunft: $("n-herkunft").value,
      bezahlt: betrag($("n-preis").value), datum: $("n-datum").value || heute(), notiz: $("n-notiz").value.trim(), erstellt: new Date().toISOString() };
    ZUG = await speicher.aendern(PFADE.zugaenge, l => l.some(x => x.id === id) ? l : [...l, neu], `Zugang: ${anzahl}× ${eintrag.name}`);
    speicherId = null;
    merkeStand(); alles();
    $("dlg-neu").close(); toast(`Gespeichert: ${eintrag.name}`);
  } catch (e) {
    meldung.textContent = e?.code === "zeit" ? "GitHub hat nicht geantwortet (Verbindung zu langsam?). Bitte nochmal auf Speichern tippen."
      : e?.code === "offline" ? "Keine Internetverbindung – bitte später nochmal speichern."
      : e?.code === "token" || e?.code === "rechte" ? e.message + " Bitte in den Einstellungen prüfen."
      : "Speichern hat nicht geklappt. Bitte noch einmal versuchen.";
  } finally { knopf.disabled = false; }
});

// ---------- Verkauf ----------
let verkaufKarte = null;
function oeffneVerkauf(e) {
  verkaufKarte = e; $("form-verkauf").reset();
  $("vk-karte").textContent = `${e.name} · ${setName(e.set)} ${e.nummer} · ${e.sprache}${VARIANTE_KURZ[e.variante] ? " · " + VARIANTE[e.variante] : ""} · du hast ${e.anzahl}`;
  $("vk-anzahl").max = e.anzahl; $("vk-anzahl").value = 1; $("vk-datum").value = heute(); $("vk-meldung").textContent = "";
  if (richtpreis(e)) $("vk-preis").placeholder = "Vorschlag " + zahl.format(richtpreis(e));
  $("dlg-verkauf").showModal();
}
$("form-verkauf").addEventListener("submit", async ev => {
  ev.preventDefault();
  const e = verkaufKarte, meldung = $("vk-meldung"), knopf = $("vk-speichern");
  const anzahl = Math.max(1, Math.min(e.anzahl, parseInt($("vk-anzahl").value, 10) || 1));
  const preis = betrag($("vk-preis").value);
  if (preis == null) { meldung.textContent = "Bitte den Erlös eintragen, auch 0 bei einem Tausch."; return; }
  knopf.disabled = true; meldung.textContent = "Speichert …";
  try {
    const neu = { id: neueId(), key: e.key, name: e.name, set: e.set, nr: e.nr, nummer: e.nummer, sprache: e.sprache, auflage: e.auflage,
      ...(VARIANTE_KURZ[e.variante] ? { variante: e.variante } : {}),
      anzahl, preis, datum: $("vk-datum").value || heute(), plattform: $("vk-plattform").value, notiz: $("vk-notiz").value.trim(), erstellt: new Date().toISOString() };
    VK = await speicher.aendern(PFADE.verkaeufe, l => [...l, neu], `Verkauf: ${anzahl}× ${e.name}`);
    merkeStand(); alles();
    $("dlg-verkauf").close(); toast(`Verkauf gespeichert: ${e.name}`);
  } catch (err) { meldung.textContent = err?.code === "offline" ? "Keine Internetverbindung – bitte später nochmal speichern." : "Speichern hat nicht geklappt. Bitte noch einmal versuchen."; }
  finally { knopf.disabled = false; }
});

// ---------- Löschen ----------
let loeschZiel = null;
function frageLoeschen(wert) {
  const [art, id] = wert.split("|");
  const x = (art === "zugang" ? ZUG : VK).find(y => y.id === id); if (!x) return;
  loeschZiel = { art, x };
  $("f-titel").textContent = art === "zugang" ? "Zugang löschen?" : "Verkauf löschen?";
  $("f-text").textContent = art === "zugang"
    ? `${x.name} (${x.anzahl} Stück) wird aus der Sammlung entfernt${x.foto ? ", das Foto wird gelöscht (in der GitHub-Historie bleibt es erhalten)" : ""}.`
    : `Der Verkauf von ${x.name} (${x.anzahl} Stück) wird gelöscht, die Karte zählt wieder zur Sammlung.`;
  $("dlg-frage").showModal();
}
$("f-ja").addEventListener("click", async () => {
  const { art, x } = loeschZiel || {}; if (!x) return;
  $("f-ja").disabled = true;
  try {
    const pfad = art === "zugang" ? PFADE.zugaenge : PFADE.verkaeufe;
    const rest = await speicher.aendern(pfad, l => l.filter(y => y.id !== x.id), `Gelöscht: ${x.name}`);
    if (art === "zugang") ZUG = rest; else VK = rest;
    if (art === "zugang" && x.foto) await speicher.loeschen(x.foto, `Foto gelöscht: ${x.name}`).catch(() => {});
    merkeStand(); alles();
    $("dlg-frage").close(); toast("Gelöscht");
  } catch (e) { $("f-text").textContent = "Löschen hat nicht geklappt. Bitte noch einmal versuchen."; }
  finally { $("f-ja").disabled = false; }
});

// ---------- Einstellungen ----------
function oeffneEinstellungen() {
  $("e-repo").value = EINST.repo; $("e-token").value = EINST.token; $("e-gemini").value = EINST.gemini;
  $("e-ergebnis").innerHTML = `<div class="muted">App-Version ${VERSION}</div>
    <button type="button" class="knopf" id="e-aktualisieren" style="justify-self:start">App aktualisieren</button>`;
  $("e-aktualisieren").onclick = aktualisieren;
  $("dlg-einstellungen").showModal();
}
$("einstellungen-knopf").addEventListener("click", oeffneEinstellungen);
$("e-vergessen").addEventListener("click", () => {
  for (const k of ["token", "gemini"]) { EINST[k] = ""; merke(k, ""); }
  $("e-token").value = ""; $("e-gemini").value = "";
  $("e-ergebnis").innerHTML = "Beide Schlüssel sind von diesem Gerät entfernt.";
});
$("form-einstellungen").addEventListener("submit", async ev => {
  ev.preventDefault();
  EINST.repo = $("e-repo").value.trim(); EINST.token = $("e-token").value.trim(); EINST.gemini = $("e-gemini").value.trim();
  for (const k of ["repo", "token", "gemini"]) merke(k, EINST[k]);
  const zeilen = [];
  const zeige = () => { $("e-ergebnis").innerHTML = zeilen.join(""); };
  zeilen.push("<div>GitHub wird geprüft …</div>"); zeige();
  try {
    const s = TEST ? speicher : new GitHubSpeicher({ token: EINST.token, repo: EINST.repo });
    const r = await s.pruefen();
    zeilen[0] = r.schreiben ? "<div>✓ GitHub: verbunden, Speichern erlaubt</div>" : "<div>⚠ GitHub: nur Lesen erlaubt – beim Token „Contents: Read and write“ wählen</div>";
  } catch (e) { zeilen[0] = `<div>✗ GitHub: ${esc(e.message)}</div>`; }
  zeige();
  if (EINST.gemini) {
    zeilen.push("<div>Gemini wird geprüft …</div>"); zeige();
    try {
      const a = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": EINST.gemini } });
      zeilen[1] = a.ok ? "<div>✓ Gemini: Schlüssel gültig</div>" : "<div>✗ Gemini: Schlüssel wird nicht akzeptiert</div>";
    } catch (e) { zeilen[1] = "<div>✗ Gemini: keine Verbindung</div>"; }
  } else zeilen.push("<div>– Gemini: kein Schlüssel, automatische Erkennung aus</div>");
  zeige();
  if (!TEST) await verbinde();
});

// ---------- Laden und Verbinden ----------
function merkeStand() { try { localStorage.setItem("stand", JSON.stringify({ ZUG, VK, B })); } catch (e) {} }
function gemerkterStand() { try { return JSON.parse(localStorage.getItem("stand") || "null"); } catch (e) { return null; } }

async function verbinde() {
  if (!TEST && !EINST.token) {
    schreibbar = false; $("fab").hidden = true;
    status("Nicht verbunden: Tippe auf ⚙ Einstellungen und trage deinen GitHub-Zugangsschlüssel ein.", "warn");
    if (!B) { $("s-raster").innerHTML = `<div class="willkommen"><strong>Willkommen!</strong><span>Deine Sammlung liegt in deinem privaten GitHub-Repo. Trage einmalig den Zugangsschlüssel ein, dann lädt die App sie hierher.</span><button type="button" class="knopf voll" style="justify-self:start" id="w-einstellungen">Einstellungen öffnen</button></div>`;
      $("w-einstellungen").onclick = oeffneEinstellungen; }
    return;
  }
  speicher = TEST ? speicher : new GitHubSpeicher({ token: EINST.token, repo: EINST.repo });
  status("Lädt die Sammlung von GitHub …");
  try {
    const r = await speicher.pruefen();
    const [basis, zug, vk] = await Promise.all([speicher.lesen(PFADE.basis), speicher.lesen(PFADE.zugaenge), speicher.lesen(PFADE.verkaeufe)]);
    if (!basis) throw Object.assign(new Error("Die Grunddaten (basis.json) fehlen im Repo."), { code: "fehlt" });
    B = basis; ZUG = zug || []; VK = vk || [];
    schreibbar = r.schreiben; $("fab").hidden = !schreibbar; $("n-wechsel").hidden = !(modus === "pruefen" && schreibbar);
    status(schreibbar ? "Verbunden mit GitHub: Änderungen werden gespeichert." : "Nur ansehen: Der Zugangsschlüssel darf nicht speichern.", schreibbar ? "ok" : "warn");
    merkeStand(); starteAnzeige();
    speicher.lesen(PFADE.fotos, { gross: true }).then(d => { if (d) { FOTOS = d; alles(); } }).catch(() => {});
  } catch (e) {
    schreibbar = false; $("fab").hidden = true;
    const alt = gemerkterStand();
    if (alt?.B && e.code === "offline") { B = alt.B; ZUG = alt.ZUG || []; VK = alt.VK || []; starteAnzeige(); status("Offline: gespeicherter Stand, Änderungen erst wieder mit Internet.", "warn"); }
    else status(e.message + (e.code === "token" || e.code === "repo" ? " Bitte in den Einstellungen prüfen." : ""), "warn");
  }
}
let angezeigt = false;
function starteAnzeige() {
  if (!angezeigt) {
    const opt = SETREIHE.filter(s => B.setkarten[s]).map(s => `<option value="${s}">${esc(setName(s))}</option>`).join("");
    $("s-set").insertAdjacentHTML("beforeend", opt + `<option value="basep">Promos</option><optgroup label="Weitere Sets" id="s-weitere" hidden></optgroup><option value="anderes">Alle weiteren Sets</option>`);
    $("e-set").insertAdjacentHTML("beforeend", opt);
    zeigeTab(location.hash.slice(1));
    angezeigt = true;
  }
  $("fab-pruefen").hidden = false;
  alles();
}
// „App aktualisieren“: neueste Fassung von GitHub holen, alte Kopien verwerfen, neu laden
async function aktualisieren() {
  const k = $("e-aktualisieren"); k.disabled = true; k.textContent = "Lade neueste Version …";
  const dateien = ["./", "index.html", "app.js", "erkennung.js", "speicher.js", "sw.js", "daten/karten-index.json"];
  try { await Promise.all(dateien.map(u => fetch(u, { cache: "reload" }))); } catch {}
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch {}
  try { for (const n of await caches.keys()) if (n.startsWith("app-")) await caches.delete(n); } catch {}
  location.reload();
}
function neueVersionHinweis() {
  if ($("neue-version")) return;
  const b = document.createElement("button");
  b.id = "neue-version"; b.type = "button"; b.className = "knopf voll";
  b.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top, 0px));z-index:30;padding:8px 14px";
  b.textContent = "Neue Version verfügbar – tippen zum Aktualisieren";
  b.onclick = () => location.reload();
  document.body.append(b);
}

// Neue Sets: Die Montags-Automatik aktualisiert das Kartenverzeichnis im privaten Repo. Die App schaut
// höchstens einmal am Tag nach, ob es dort ein neueres gibt, und merkt es sich auf dem Gerät.
const VERZEICHNIS = "webapp/daten/karten-index.json";
async function neuesVerzeichnis() {
  if (!speicher || TEST || !schreibbar && !EINST.token || lies("verzeichnis-geprueft") === heute()) return;
  try {
    const d = await speicher.lesen(VERZEICHNIS, { gross: true });
    merke("verzeichnis-geprueft", heute());
    if (d?.stand && (!IDX || d.stand > IDX.stand)) {
      IDX = new Index(d); alles();
      try { localStorage.setItem("verzeichnis", JSON.stringify(d)); } catch (e) {}
    }
  } catch (e) {}
}

// beim Zurückkehren in die App frische Daten holen (z. B. nach Änderungen am PC)
let zuletzt = Date.now();
document.addEventListener("visibilitychange", async () => {
  if (document.hidden || !speicher || TEST || Date.now() - zuletzt < 60000) return;
  zuletzt = Date.now();
  try { const [zug, vk] = await Promise.all([speicher.lesen(PFADE.zugaenge), speicher.lesen(PFADE.verkaeufe)]); ZUG = zug || []; VK = vk || []; merkeStand(); alles(); } catch (e) {}
});

async function start() {
  if (TEST) {
    speicher = new TestSpeicher("../");
    window.testSpeicher = speicher; window.testHaken = haken;   // für Tests am PC
    EINST.gemini = EINST.gemini || "test";
  }
  // Kartenverzeichnis: mitgeliefert, oder eine neuere Fassung, die die App schon einmal aus dem Repo geholt hat
  await fetch("daten/karten-index.json").then(r => r.json()).then(d => {
    let gemerkt = null;
    try { gemerkt = JSON.parse(localStorage.getItem("verzeichnis") || "null"); } catch (e) {}
    IDX = new Index(gemerkt && gemerkt.stand > d.stand ? gemerkt : d); alles();
  }).catch(() => { status("Das Kartenverzeichnis konnte nicht geladen werden. Erkennung ist aus.", "warn"); });
  await verbinde();
  neuesVerzeichnis();
  if (TEST) status("Testmodus: Daten vom PC, Änderungen nur im Arbeitsspeicher.", "ok");
  if ("serviceWorker" in navigator && !TEST) {
    // Neue Version: der Service Worker übernimmt sofort – dann einen Hinweis zum Neuladen zeigen
    const hatteSteuerung = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hatteSteuerung) neueVersionHinweis(); });
    navigator.serviceWorker.register("sw.js").then(reg => {
      document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }
}
window.addEventListener("hashchange", () => zeigeTab(location.hash.slice(1)));
start();
