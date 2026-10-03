// Speicher: liest und schreibt die Sammlungsdaten im privaten GitHub-Repo über die GitHub-API.
// Der Zugangsschlüssel (Token) bleibt nur im Browser dieses Geräts (localStorage).
// Zum Ausprobieren am PC gibt es einen Testspeicher, der nur im Arbeitsspeicher schreibt.

export const PFADE = {
  basis: "katalog/app/daten/basis.json",     // Grundsammlung, vom PC gebaut (app.py)
  fotos: "katalog/app/daten/fotos.json",     // eigene Fotos der Grundsammlung (klein)
  zugaenge: "app-daten/zugaenge.json",       // Karten, die über die App dazukommen
  verkaeufe: "app-daten/verkaeufe.json",     // Verkäufe über die App
  fotoOrdner: "app-daten/fotos/",            // Handyfotos neuer Karten
};

export class SpeicherFehler extends Error {
  constructor(code, text) { super(text); this.code = code; }
}

function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const textZuBase64 = text => base64(new TextEncoder().encode(text));

export class GitHubSpeicher {
  constructor({ token, repo, zweig = "main" }) {
    this.token = token; this.repo = repo; this.zweig = zweig;
    this.shas = {};                               // letzter bekannter Stand je Datei (für sicheres Überschreiben)
  }
  async anfrage(pfad, { methode = "GET", body, roh = false } = {}) {
    let antwort;
    // Zeitlimit: bricht die Mobilverbindung weg, hängt fetch sonst ewig (Fotos dürfen länger dauern)
    const abbruch = new AbortController(), uhr = setTimeout(() => abbruch.abort(), methode === "PUT" ? 90000 : 30000);
    try {
      antwort = await fetch(`https://api.github.com/repos/${this.repo}/contents/${pfad}` + (methode === "GET" ? `?ref=${this.zweig}` : ""), {
        method: methode, cache: "no-store", signal: abbruch.signal,
        headers: { Authorization: `Bearer ${this.token}`, "X-GitHub-Api-Version": "2022-11-28",
                   Accept: roh ? "application/vnd.github.raw+json" : "application/vnd.github+json",
                   ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw abbruch.signal.aborted ? new SpeicherFehler("zeit", "GitHub hat nicht rechtzeitig geantwortet.")
                                   : new SpeicherFehler("offline", "Keine Verbindung zu GitHub.");
    } finally { clearTimeout(uhr); }
    if (antwort.status === 404) return null;
    if (antwort.status === 401) throw new SpeicherFehler("token", "Der GitHub-Zugangsschlüssel stimmt nicht oder ist abgelaufen.");
    if (antwort.status === 403) throw new SpeicherFehler("rechte", "Der Zugangsschlüssel darf dieses Repo nicht bearbeiten.");
    if (antwort.status === 409 || antwort.status === 422) throw new SpeicherFehler("konflikt", "Die Datei wurde inzwischen geändert.");
    if (!antwort.ok) throw new SpeicherFehler("fehler", `GitHub antwortet mit Fehler ${antwort.status}.`);
    return antwort;
  }
  // Prüft Token und Repo. Ergebnis: {ok, schreiben}
  async pruefen() {
    let a;
    try {
      a = await fetch(`https://api.github.com/repos/${this.repo}`, { cache: "no-store",
        headers: { Authorization: `Bearer ${this.token}`, "X-GitHub-Api-Version": "2022-11-28" } });
    } catch (e) { throw new SpeicherFehler("offline", "Keine Verbindung zu GitHub."); }
    if (a.status === 401) throw new SpeicherFehler("token", "Der GitHub-Zugangsschlüssel stimmt nicht oder ist abgelaufen.");
    if (a.status === 404) throw new SpeicherFehler("repo", "Das Repo wurde nicht gefunden oder der Schlüssel hat keinen Zugriff darauf.");
    if (!a.ok) throw new SpeicherFehler("fehler", `GitHub antwortet mit Fehler ${a.status}.`);
    const d = await a.json();
    this.zweig = d.default_branch || this.zweig;
    return { ok: true, schreiben: !!d.permissions?.push };
  }
  // JSON-Datei lesen; null wenn es sie noch nicht gibt
  async lesen(pfad, { gross = false } = {}) {
    if (gross) {                                   // große Dateien (> 1 MB) nur roh, ohne Stand
      const a = await this.anfrage(pfad, { roh: true });
      return a ? a.json() : null;
    }
    const a = await this.anfrage(pfad);
    if (!a) { delete this.shas[pfad]; return null; }
    const d = await a.json();
    this.shas[pfad] = d.sha;
    const bytes = Uint8Array.from(atob(d.content.replace(/\n/g, "")), c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  // JSON-Datei schreiben. Schlägt mit code "konflikt" fehl, wenn sie seit dem Lesen geändert wurde.
  async schreiben(pfad, daten, nachricht) {
    const a = await this.anfrage(pfad, { methode: "PUT", body: {
      message: nachricht, branch: this.zweig, content: textZuBase64(JSON.stringify(daten, null, 1) + "\n"),
      ...(this.shas[pfad] ? { sha: this.shas[pfad] } : {}) } });
    this.shas[pfad] = (await a.json()).content.sha;
  }
  // Liste lesen, ändern, schreiben – bei gleichzeitiger Änderung neu lesen und nochmal versuchen
  async aendern(pfad, aenderung, nachricht) {
    for (let versuch = 0; versuch < 3; versuch++) {
      const liste = (await this.lesen(pfad)) || [];
      const neu = aenderung(liste);
      try { await this.schreiben(pfad, neu, nachricht); return neu; }
      catch (e) { if (e.code !== "konflikt" || versuch === 2) throw e; }
    }
  }
  async fotoHochladen(pfad, blob, nachricht) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    try { await this.anfrage(pfad, { methode: "PUT", body: { message: nachricht, branch: this.zweig, content: base64(bytes) } }); }
    catch (e) { if (e.code !== "konflikt") throw e; }   // gibt es schon: ein früherer Versuch kam doch an
  }
  async fotoLesen(pfad) {
    const a = await this.anfrage(pfad, { roh: true });
    return a ? a.blob() : null;
  }
  async loeschen(pfad, nachricht) {
    const a = await this.anfrage(pfad);
    if (!a) return;
    const { sha } = await a.json();
    await this.anfrage(pfad, { methode: "DELETE", body: { message: nachricht, branch: this.zweig, sha } });
  }
}

// Nur zum Ausprobieren am PC: liest die Grunddaten vom lokalen Server, schreibt nur in den Arbeitsspeicher.
export class TestSpeicher {
  constructor(basisUrl) { this.basisUrl = basisUrl; this.dateien = {}; this.fotos = {}; this.schreibvorgaenge = []; }
  async pruefen() { return { ok: true, schreiben: true }; }
  async lesen(pfad) {
    if (pfad in this.dateien) return structuredClone(this.dateien[pfad]);
    const a = await fetch(this.basisUrl + pfad).catch(() => null);
    return a && a.ok ? a.json() : null;
  }
  async schreiben(pfad, daten, nachricht) {
    await new Promise(r => setTimeout(r, 150));
    this.dateien[pfad] = structuredClone(daten); this.schreibvorgaenge.push({ pfad, nachricht });
  }
  async aendern(pfad, aenderung, nachricht) {
    const neu = aenderung((await this.lesen(pfad)) || []);
    await this.schreiben(pfad, neu, nachricht); return neu;
  }
  async fotoHochladen(pfad, blob, nachricht) { this.fotos[pfad] = blob; this.schreibvorgaenge.push({ pfad, nachricht }); }
  async fotoLesen(pfad) {
    if (this.fotos[pfad]) return this.fotos[pfad];
    const a = await fetch(this.basisUrl + pfad).catch(() => null);
    return a && a.ok ? a.blob() : null;
  }
  async loeschen(pfad, nachricht) { delete this.fotos[pfad]; delete this.dateien[pfad]; this.schreibvorgaenge.push({ pfad, nachricht }); }
}
