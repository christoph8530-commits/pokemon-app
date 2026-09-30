# Pokémon-Sammlung (Web-App)

Persönliche Handy-App für eine Pokémon-Kartensammlung: Sammlung, Sets, Einkaufsliste, Verkäufe und Karten scannen.

- **Keine Daten in diesem Repo.** Die Sammlung liegt in einem privaten Repo; die App liest und schreibt sie über die GitHub-API mit einem Zugangsschlüssel, der nur im Browser des Geräts gespeichert wird.
- **Erkennung:** Gemini (eigener API-Schlüssel, ebenfalls nur auf dem Gerät) liest Name und Nummer; die App ordnet die Karte über ein Verzeichnis aller Karten zu, vergleicht die Bilder und fragt bei Mehrdeutigkeit nach. Ohne Gemini gibt es einen reinen Bildvergleich.
- **Kartendaten und -bilder:** [TCGdex](https://tcgdex.dev) (`daten/karten-index.json` ist daraus erzeugt).

Dieses Repo wird aus dem Ordner `webapp/` des privaten Repos veröffentlicht; Änderungen dort machen, nicht hier.
