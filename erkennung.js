// Kartenerkennung: Gemini liest die Karte, die App ordnet sie über das Nachschlagewerk zu
// (Name zuerst, Nummer/Gesamtzahl/Set entscheiden), vergleicht die Bilder und fragt bei
// Mehrdeutigkeit mit Kandidatenbildern nach. Ablauf und Schwellen wie im Test an 290 Karten.

export const MODELL = "gemini-flash-lite-latest";   // Alias: rückt automatisch auf die neueste Version nach
export const haken = { gemini: null };              // zum Testen: Gemini-Aufruf ersetzen
const BILDER = "https://assets.tcgdex.net/";

export const PROMPT = `Du siehst drei Bilder: Bild 1 ist ein Foto einer Pokémon-Sammelkarte, Bild 2 ist ein vergrößerter Ausschnitt
der Stelle links unter dem Kartenbild, wo bei Erstauflagen ein Stempel sitzt, Bild 3 ist der untere Kartenrand
vergrößert, dort steht die Kartennummer (bei älteren Karten rechts, bei neueren links mit Set-Kürzel).
Bestimme die Karte genau:
- name: Kartenname wie aufgedruckt
- name_en: englischer Name der Karte
- set: englischer Name des Sets, erkennbar am Set-Symbol rechts unter dem Bild bzw. bei neueren Karten am Set-Kürzel links unten (z. B. "Base Set", "Jungle", "Fossil",
  "Team Rocket", "Gym Heroes", "Gym Challenge", "Neo Genesis"). Ein schwarzer Stern mit Nummer als Symbol bedeutet
  "Wizards Black Star Promos". Hat die Karte kein Set-Symbol, gib "Base Set" an.
- nummer: die aufgedruckte Kartennummer genau wie gedruckt, z. B. "35/102", "008/088" oder "TG05/TG30" (bei neueren Karten links unten nach dem Set-Kürzel, das Kürzel selbst nicht mit angeben). Bei Promokarten steht nur eine
  Zahl (oft im schwarzen Stern oder als "Nr. 5"), dann nur diese Zahl. Lies die Ziffern sorgfältig einzeln, am besten in Bild 3.
- sprache: Sprache des aufgedruckten Kartentexts: DE, EN, FR, IT, ES, PT, NL, JP, KO, ZH oder andere (Energiekarten: „ENERGY“ = EN, „ENERGIE“ = DE)
- erste_auflage: nur true, wenn in Bild 2 deutlich ein Stempel "Edition 1" bzw. "1st Edition" (schwarzer Kreis/Rahmen
  mit einer 1) zu erkennen ist. Ein Schatten, Holo-Glanz oder Text ist kein Stempel.
- holo: true, wenn das Kartenbild glitzert (Holo)
- sicher: false, wenn du bei Set oder Nummer unsicher bist`;

const SCHEMA = { type: "OBJECT", properties: {
  name: { type: "STRING" }, name_en: { type: "STRING" }, set: { type: "STRING" }, nummer: { type: "STRING" },
  sprache: { type: "STRING" }, erste_auflage: { type: "BOOLEAN" }, holo: { type: "BOOLEAN" }, sicher: { type: "BOOLEAN" } },
  required: ["name", "name_en", "set", "nummer", "sprache", "erste_auflage", "holo", "sicher"] };

const PROMPT_WAHL = liste => `Bild 1 ist ein Foto einer Pokémon-Karte. Die weiteren Bilder sind Kandidaten (${liste}).
Welcher Kandidat ist genau dieselbe Karte? Vergleiche Kartenbild, Set-Symbol rechts unter dem Bild und die Nummer unten rechts.
Die Sprache kann verschieden sein (Foto deutsch, Kandidat englisch) – das spielt keine Rolle.
Antworte mit dem Buchstaben des Kandidaten oder "keiner".`;
const SCHEMA_WAHL = { type: "OBJECT", properties: { kandidat: { type: "STRING" }, grund: { type: "STRING" } }, required: ["kandidat", "grund"] };

// Sets, die es als 1. Auflage gibt (Stempel links unter dem Bild)
export const ERSTAUFLAGE_SETS = ["base1", "base2", "base3", "base5", "gym1", "gym2", "neo1", "neo2", "neo3", "neo4"];
// Gleiche Karten in zwei Sets: Die Basis-Energien 127–132 von Gym Heroes und Gym Challenge sind identisch
// gedruckt. Die App führt sie als eine Karte (unter Gym Heroes).
export function kanonisch(id) {
  const m = /^gym2-(12[7-9]|13[0-2])$/.exec(id);
  return m ? `gym1-${m[1]}` : id;
}
function ohneDoppelte(liste) {
  const gesehen = new Set();
  return liste.filter(k => { k.id = kanonisch(k.id); if (gesehen.has(k.id)) return false; gesehen.add(k.id); return true; });
}

const ART = [0.10, 0.11, 0.90, 0.47];      // Kartenbild einer Wizards-Karte (Anteile)
const STEMPEL = [0.0, 0.40, 0.40, 0.62];   // Stelle des Erstauflage-Stempels
const NUMMER = [0.0, 0.88, 1.0, 1.0];      // unterer Kartenrand mit der Kartennummer (alt: rechts, neu: links)

// ---------- Nachschlagewerk ----------
export class Index {
  constructor(daten) {
    this.stand = daten.stand;
    this.sets = {};
    for (const [id, [name, name_de, serie, offiziell, gesamt, pfad]] of Object.entries(daten.sets))
      this.sets[id] = { id, name, name_de, serie, offiziell, gesamt, pfad };
    this.karten = [];
    for (const [sid, liste] of Object.entries(daten.karten))
      for (const [nr, en, de, bild, weitere] of liste)
        this.karten.push({ id: `${sid}-${nr}`, set: sid, nr, en, de: de || en,
          bild: bild === 1 ? `${BILDER}${this.sets[sid].pfad}/${nr}` : bild ? BILDER + bild : null,
          nen: norm(en), nde: norm(de || en), nw: weitere ? weitere.split("|").map(norm) : [] });
    this.nachId = new Map(this.karten.map(k => [k.id, k]));
  }
  karte(id) { return this.nachId.get(id); }
}

// ---------- Textvergleich wie Pythons difflib.SequenceMatcher.ratio ----------
export function norm(s) {
  return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function treffer(a, b) {
  // Summe der Längen aller übereinstimmenden Blöcke (rekursiv längster gemeinsamer Teilstring)
  const stapel = [[0, a.length, 0, b.length]];
  let summe = 0;
  while (stapel.length) {
    const [alo, ahi, blo, bhi] = stapel.pop();
    let besti = alo, bestj = blo, bestk = 0, j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const neu = new Map();
      for (let j = blo; j < bhi; j++) {
        if (a[i] !== b[j]) continue;
        const k = (j2len.get(j - 1) || 0) + 1;
        neu.set(j, k);
        if (k > bestk) { besti = i - k + 1; bestj = j - k + 1; bestk = k; }
      }
      j2len = neu;
    }
    if (!bestk) continue;
    summe += bestk;
    if (alo < besti && blo < bestj) stapel.push([alo, besti, blo, bestj]);
    if (besti + bestk < ahi && bestj + bestk < bhi) stapel.push([besti + bestk, ahi, bestj + bestk, bhi]);
  }
  return summe;
}
export function aehnlich(a, b, schonNorm = false) {
  if (!a || !b) return 0;
  const x = schonNorm ? a : norm(a), y = schonNorm ? b : norm(b);
  if (!x.length && !y.length) return 0;
  return 2 * treffer(x, y) / (x.length + y.length);
}

// ---------- Zuordnung ----------
export function kandidaten(r, index) {
  const nummer = r.nummer || "";
  const m = nummer.match(/(\d+)\s*\/\s*(\d+)/), nur = nummer.match(/^\D*(\d+)\D*$/);
  const nrG = m ? m[1].replace(/^0+/, "") : nur ? nur[1].replace(/^0+/, "") : null;
  const totG = m ? Number(m[2]) : null;
  const nEn = norm(r.name_en), nName = norm(r.name), nSet = norm(r.set);
  // Nummern mit Buchstaben (TG05, SWSH123, H06); ein mitgelesenes Set-Kürzel (SVI025) stört nicht
  const roh = nummer.toUpperCase().replace(/\s/g, "").split("/")[0], mt = roh.match(/^([A-Z]*)(\d+)$/);
  const nrPasst = nr => {
    const n = nr.toUpperCase();
    if (!mt) return !!roh && n === roh;
    const mk = n.match(/^([A-Z]*)(\d+)$/);
    return mk ? Number(mk[2]) === Number(mt[2]) && (mk[1] === mt[1] || mk[1] === "") : n === roh;
  };
  const setAehnlich = {};
  const liste = [];
  for (const k of index.karten) {
    let name = Math.max(aehnlich(nEn, k.nen, true), aehnlich(nName, k.nde, true), aehnlich(nName, k.nen, true));
    for (const w of k.nw) if (name < 1) name = Math.max(name, aehnlich(nName, w, true));   // französische usw. Namen
    if (name < 0.85) continue;
    const s = index.sets[k.set];
    let p = 2 * name;
    const nrOk = nrPasst(k.nr);
    if (nrOk) p += 1.0;
    else if (nrG && /^\d+$/.test(k.nr) && Math.abs(Number(k.nr) - Number(nrG)) <= 9) p += 0.3;
    const totOk = totG == null || totG === s.offiziell || totG === s.gesamt;
    if (totG && totOk) p += 0.8;
    p += 0.6 * (setAehnlich[k.set] ??= aehnlich(nSet, norm(s.name), true));
    // passtVoll: Nummer UND Gesamtzahl stimmen (z. B. 130/132) – dann hat das gegen das Bild Vorrang
    liste.push({ p, id: k.id, passt: nrOk && totOk && name >= 0.95, passtVoll: nrOk && totG != null && totOk && name >= 0.95, bild: 0, hatBild: !!k.bild });
  }
  liste.sort((a, b) => b.p - a.p);
  return ohneDoppelte(liste).slice(0, 8);
}
// Karten mit (fast) gleichem Namen – für den Fall, dass die Nummer ganz falsch gelesen wurde
function gleichnamige(r, index) {
  const nEn = norm(r.name_en), nName = norm(r.name);
  return index.karten.filter(k => k.bild && Math.max(aehnlich(nEn, k.nen, true), aehnlich(nName, k.nde, true),
    ...k.nw.map(w => aehnlich(nName, w, true))) >= 0.95);
}

// ---------- Bilder ----------
async function bitmap(quelle) {
  return quelle instanceof ImageBitmap ? quelle : await createImageBitmap(quelle, { imageOrientation: "from-image" });
}
function ausschnitt(bild, [x0, y0, x1, y1], breite, hoehe) {
  const c = new OffscreenCanvas(breite, hoehe), g = c.getContext("2d");
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(bild, x0 * bild.width, y0 * bild.height, (x1 - x0) * bild.width, (y1 - y0) * bild.height, 0, 0, breite, hoehe);
  return c;
}
// Karte im Foto finden: gelber Rand, über Zeilen/Spalten mit gelben Pixeln (längster Bereich).
// Ergebnis: Anteile [x0, y0, x1, y1] oder null, wenn kein Kartenrand gefunden wurde.
// Gelb: Wizards- und ältere Karten. Silber (ab 2023): hell, wenig Farbe, eher bläulich als bräunlich.
const GELB = (r, gr, b, mx, d) => {
  let ton = mx === r ? ((gr - b) / d) % 6 : mx === gr ? (b - r) / d + 2 : (r - gr) / d + 4;
  ton = (ton < 0 ? ton + 6 : ton) * 60;
  return ton >= 38 && ton <= 68 && d / (mx + 1e-6) > 0.42 && mx > 0.45;
};
const SILBER = (r, gr, b, mx, d) => mx > 0.62 && d / (mx + 1e-6) < 0.3 && b >= r + 0.02;
export function findeKarte(bild) {
  const w = 300, h = Math.max(1, Math.round(bild.height * w / bild.width));
  const c = new OffscreenCanvas(w, h), g = c.getContext("2d");
  g.drawImage(bild, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  for (const rand of [GELB, SILBER]) {
    const box = rahmen(px, w, h, rand, bild);
    if (box) return box;
  }
  return null;
}
function rahmen(px, w, h, rand, bild) {
  const zeilen = new Float32Array(h), spalten = new Float32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, r = px[i] / 255, gr = px[i + 1] / 255, b = px[i + 2] / 255;
    const mx = Math.max(r, gr, b), d = mx - Math.min(r, gr, b) + 1e-6;
    if (rand(r, gr, b, mx, d)) { zeilen[y]++; spalten[x]++; }
  }
  const lauf = (werte, anzahl, grenze) => {
    let best = null, start = null, ende = 0, luecke = 0;
    for (let i = 0; i <= werte.length + 4; i++) {
      const v = i < werte.length ? werte[i] / anzahl : 0;
      if (v > grenze) { if (start === null) start = i; luecke = 0; ende = i + 1; }
      else if (start !== null && ++luecke > 3) { if (!best || ende - start > best[1] - best[0]) best = [start, ende]; start = null; luecke = 0; }
    }
    return best;
  };
  const ry = lauf(zeilen, w, 0.015), rx = lauf(spalten, h, 0.015);
  if (!ry || !rx || ry[1] - ry[0] < h * 0.3 || rx[1] - rx[0] < w * 0.3) return null;
  const verh = ((ry[1] - ry[0]) * bild.height / h) / ((rx[1] - rx[0]) * bild.width / w);
  if (verh < 1.15 || verh > 1.6) return null;
  return [rx[0] / w, ry[0] / h, rx[1] / w, ry[1] / h];
}
// Foto auf die Karte zuschneiden (unverändert, wenn keine Karte gefunden wurde)
const BOX_SCHEMA = { type: "OBJECT", properties: { box_2d: { type: "ARRAY", items: { type: "INTEGER" } } }, required: ["box_2d"] };
async function boxVonGemini(bild, schluessel) {
  const f = Math.min(1, 768 / Math.max(bild.width, bild.height));
  const r = await (haken.gemini || gemini)(schluessel, [await alsJpeg(bild, Math.round(bild.width * f), Math.round(bild.height * f)),
    { text: "Wo ist die Pokémon-Karte in diesem Foto? Gib ihren Rand als box_2d [ymin, xmin, ymax, xmax] im Bereich 0–1000 an." }], BOX_SCHEMA);
  const [y0, x0, y1, x1] = r?.box_2d || [];
  return x0 >= 0 && x1 > x0 && x1 <= 1000 && y0 >= 0 && y1 > y0 && y1 <= 1000 ? [x0 / 1000, y0 / 1000, x1 / 1000, y1 / 1000] : null;
}
// schluessel nur nötig, wenn kein Kartenrand gefunden wird (dann fragt die App Gemini nach der Lage der Karte)
export async function karteImFoto(foto, schluessel = null) {
  const bild = await bitmap(foto);
  let box = findeKarte(bild), ueberGemini = false;
  if (!box && schluessel) { box = await boxVonGemini(bild, schluessel).catch(e => { if (e.code === "kontingent") throw e; return null; }); ueberGemini = !!box; }
  if (!box) return { bild, gefunden: false, ueberGemini };
  const b = Math.round((box[2] - box[0]) * bild.width), h = Math.round((box[3] - box[1]) * bild.height);
  return { bild: ausschnitt(bild, box, b, h), gefunden: true, ueberGemini };
}
function vergroessert(bild, bereich, maxKante = 1200, maxFaktor = 3) {
  const b = (bereich[2] - bereich[0]) * bild.width, h = (bereich[3] - bereich[1]) * bild.height;
  const f = Math.min(maxFaktor, maxKante / Math.max(b, h));
  return ausschnitt(bild, bereich, Math.round(b * f), Math.round(h * f));
}

export function merkmal(bild) {
  // Kartenbild in zwei Stufen verkleinern (ähnlich wie PIL), dann je Farbkanal normieren
  const zwischen = ausschnitt(bild, ART, 64, 44);
  const c = new OffscreenCanvas(16, 11), g = c.getContext("2d");
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(zwischen, 0, 0, 16, 11);
  const px = g.getImageData(0, 0, 16, 11).data, n = 16 * 11, v = new Float32Array(n * 3);
  for (let kanal = 0; kanal < 3; kanal++) {
    let summe = 0, quad = 0;
    for (let i = 0; i < n; i++) { const w = px[i * 4 + kanal]; summe += w; quad += w * w; }
    const mittel = summe / n, sd = Math.sqrt(Math.max(0, quad / n - mittel * mittel));
    for (let i = 0; i < n; i++) v[i * 3 + kanal] = (px[i * 4 + kanal] - mittel) / (sd + 1);
  }
  let laenge = 0; for (const w of v) laenge += w * w;
  laenge = Math.sqrt(laenge) || 1;
  return v.map(w => w / laenge);
}
const skalar = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

const refCache = new Map();
async function refBild(karte) {
  if (!karte?.bild) return null;
  if (!refCache.has(karte.id))
    refCache.set(karte.id, fetch(karte.bild + "/low.jpg").then(r => r.ok ? r.blob() : null).then(b => b && createImageBitmap(b)).catch(() => null));
  return refCache.get(karte.id);
}
async function alsJpeg(canvasOderBild, breite, hoehe, qualitaet = 0.85) {
  const c = canvasOderBild instanceof OffscreenCanvas ? canvasOderBild : (() => {
    const cc = new OffscreenCanvas(breite, hoehe); cc.getContext("2d").drawImage(canvasOderBild, 0, 0, breite, hoehe); return cc; })();
  const blob = await c.convertToBlob({ type: "image/jpeg", quality: qualitaet });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { inline_data: { mime_type: "image/jpeg", data: btoa(s) } };
}

// ---------- Gemini ----------
export class GeminiFehler extends Error {
  constructor(code, text) { super(text); this.code = code; }
}
export async function gemini(schluessel, teile, schema, modell = MODELL) {
  let antwort;
  try {
    antwort = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modell}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": schluessel, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: teile }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 } }) });
  } catch (e) { throw new GeminiFehler("offline", "Keine Verbindung zu Gemini."); }
  if (!antwort.ok) {
    const text = await antwort.text().catch(() => "");
    if (antwort.status === 429) throw new GeminiFehler(/PerDay|quota/i.test(text) ? "kontingent" : "zu_schnell", text);
    if (antwort.status === 400 && /API key/i.test(text)) throw new GeminiFehler("schluessel", text);
    if (antwort.status === 403) throw new GeminiFehler("schluessel", text);
    throw new GeminiFehler(antwort.status >= 500 ? "ueberlastet" : "fehler", text);
  }
  const d = await antwort.json();
  const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new GeminiFehler("leer", "Gemini hat nicht geantwortet.");
  return JSON.parse(text);
}

// ---------- Ganze Erkennung ----------
// foto: Blob/File vom Handy. Ergebnis: {antwort, tipp: [ids], status: "ok"|"pruefen", bildaehnlich, anfragen}
export async function bestimme(foto, index, schluessel, fortschritt = () => {}) {
  fortschritt("Suche die Karte im Foto …");
  const { bild, gefunden, ueberGemini } = await karteImFoto(foto, schluessel);
  const skala = Math.min(1, 1024 / Math.max(bild.width, bild.height));
  const klein = await alsJpeg(bild, Math.round(bild.width * skala), Math.round(bild.height * skala));
  const stempelBild = vergroessert(bild, STEMPEL, 800, 2);
  const stempel = await alsJpeg(stempelBild);
  const nummer = await alsJpeg(vergroessert(bild, NUMMER));
  fortschritt("Gemini liest die Karte …");
  const frage = haken.gemini || gemini;
  const antwort = await frage(schluessel, [klein, stempel, nummer, { text: PROMPT }], SCHEMA);
  const extra = { stempel: await stempelBild.convertToBlob({ type: "image/jpeg", quality: 0.85 }), zugeschnitten: gefunden };
  let anfragen = 1 + (ueberGemini ? 1 : 0);
  const kand = kandidaten(antwort, index);
  if (!kand.length) return { antwort, tipp: [], status: "pruefen", bildaehnlich: [], anfragen, ...extra };

  fortschritt("Vergleiche mit den Kartenbildern …");
  const q = merkmal(bild);
  await Promise.all(kand.map(async k => {
    const ref = await refBild(index.karte(k.id));
    k.bild = ref ? skalar(merkmal(ref), q) : 0;
    k.p += 1.5 * k.bild;
  }));
  kand.sort((a, b) => b.p - a.p);

  // Bild passt gar nicht: alle gleichnamigen Karten nach Bildähnlichkeit ordnen
  if (kand[0].bild < 0.2 && kand[0].hatBild && !kand[0].passtVoll) {
    fortschritt("Suche nach dem passenden Bild …");
    const alle = await Promise.all(gleichnamige(antwort, index).map(async k => {
      const ref = await refBild(k);
      return { id: k.id, bild: ref ? skalar(merkmal(ref), q) : -1 };
    }));
    alle.sort((a, b) => b.bild - a.bild);
    const beste = ohneDoppelte(alle).slice(0, 3);
    if (beste.length) return { antwort, tipp: beste.map(k => k.id), status: "pruefen",
                               bildaehnlich: beste.map(k => k.bild), anfragen, ...extra };
  }

  let status = "ok";
  const knapp = kand.length > 1 && kand[0].p - kand[1].p < 0.5;
  if (!kand[0].hatBild) status = kand[0].passt ? "ok" : "pruefen";     // kein Vergleichsbild: Rückfrage würde die Karte aussortieren
  else if (!kand[0].passt || knapp) {
    const auswahl = [];
    for (const k of kand.slice(0, 3)) { const ref = await refBild(index.karte(k.id)); if (ref) auswahl.push([k, ref]); }
    if (auswahl.length >= 2) {
      fortschritt("Gemini vergleicht die ähnlichsten Karten …");
      const buchst = "ABC".slice(0, auswahl.length);
      const teile = [klein];
      for (const [, ref] of auswahl) teile.push(await alsJpeg(ref, 300, 420));
      teile.push({ text: PROMPT_WAHL([...buchst].map((c, i) => `Bild ${i + 2} = ${c}`).join(", ")) });
      let wahl = null;
      try { wahl = await frage(schluessel, teile, SCHEMA_WAHL); anfragen++; } catch (e) { if (e.code === "kontingent") throw e; }
      const w = String(wahl?.kandidat || "").trim().toUpperCase()[0];
      const pos = w ? buchst.indexOf(w) : -1;
      if (pos >= 0) {
        const [gewaehlt] = auswahl[pos];
        kand.splice(kand.indexOf(gewaehlt), 1); kand.unshift(gewaehlt);
        status = gewaehlt.passt ? "ok" : "pruefen";
      } else status = "pruefen";
    } else status = "pruefen";
  }
  const tipp = kand.slice(0, 3).map(k => k.id), aehnlich = kand.slice(0, 3).map(k => k.bild);
  // unsicher: zusätzlich die gleichnamige Karte mit dem ähnlichsten Bild vorschlagen (falls Gemini die Nummer verlesen hat)
  if (status === "pruefen") {
    fortschritt("Suche das ähnlichste Kartenbild …");
    const alle = gleichnamige(antwort, index).slice(0, 200);
    let beste = null;
    await Promise.all(alle.map(async k => {
      const ref = await refBild(k);
      const wert = ref ? skalar(merkmal(ref), q) : -1;
      if (!beste || wert > beste.wert) beste = { id: kanonisch(k.id), wert };
    }));
    if (beste && beste.wert > 0.3 && !tipp.includes(beste.id)) {
      tipp.splice(Math.min(1, tipp.length), 0, beste.id); aehnlich.splice(Math.min(1, aehnlich.length), 0, beste.wert);
      tipp.length = Math.min(tipp.length, 3); aehnlich.length = tipp.length;
    }
  }
  return { antwort, tipp, status, bildaehnlich: aehnlich, anfragen, ...extra };
}

// ---------- Ohne KI: nur Bildvergleich (Rückfall, wenn Gemini nicht erreichbar ist) ----------
// Vergleicht mit den Karten der angegebenen Sets. Ergebnis wie bestimme(), immer "pruefen".
export async function stempelAusschnitt(foto) {
  const { bild } = await karteImFoto(foto);
  return vergroessert(bild, STEMPEL, 800, 2).convertToBlob({ type: "image/jpeg", quality: 0.85 });
}
export async function nurBild(foto, index, setIds, fortschritt = () => {}) {
  const q = merkmal((await karteImFoto(foto)).bild);
  const karten = index.karten.filter(k => setIds.includes(k.set) && k.bild);
  const ergebnis = [];
  let fertig = 0;
  await Promise.all(karten.map(async k => {
    const ref = await refBild(k);
    if (ref) ergebnis.push({ id: k.id, bild: skalar(merkmal(ref), q) });
    if (++fertig % 50 === 0) fortschritt(`Vergleiche Bilder … ${fertig} von ${karten.length}`);
  }));
  ergebnis.sort((a, b) => b.bild - a.bild);
  const beste = ohneDoppelte(ergebnis).slice(0, 3);
  return { antwort: null, tipp: beste.map(k => k.id), status: "pruefen", bildaehnlich: beste.map(k => k.bild), anfragen: 0,
           stempel: await stempelAusschnitt(foto) };
}
