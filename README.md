# 🚒 Feuerwehr Störungsmelder – LZ Frechen

Fahrzeug-Störungs- und Reparaturmeldungssystem für das Löschzentrum Frechen.  
Erreichbar unter: **https://werkstatt.lz-frechen.de**

---

## Plesk Deployment

### 1. Repo klonen oder ZIP hochladen
```bash
git clone https://github.com/svenskoni/werkstatt.git
```
Oder ZIP hochladen und entpacken nach `/var/www/vhosts/werkstatt.lz-frechen.de/httpdocs/`

### 2. Plesk – Node.js konfigurieren
| Einstellung | Wert |
|---|---|
| Node.js-Version | ≥ 18 LTS |
| Anwendungsmodus | `production` |
| Anwendungsstamm | `/httpdocs` |
| Dokumentstamm | `/httpdocs/public` |
| Anwendungsstartdatei | `server.js` |

### 3. Umgebungsvariablen in Plesk eintragen
Alle Werte aus `.env.example` als Env-Vars eintragen. **PORT NICHT setzen!**

### 4. Passwörter generieren
```bash
node tools/generate-passwords.js
```

### 5. npm install + App starten
In Plesk: **npm install** → **Node.js aktivieren** → **App neu starten**

---

## Benutzerrollen
| Rolle | Dashboard | Eingabe | Status ändern |
|---|---|---|---|
| `view` | ✓ | ✗ | ✗ |
| `user` | ✓ | ✓ | ✗ |
| `admin` | ✓ | ✓ | ✓ |

---

## Hinweis: better-sqlite3
`better-sqlite3` muss kompiliert werden. Bei Problemen:
```bash
npm rebuild better-sqlite3
```