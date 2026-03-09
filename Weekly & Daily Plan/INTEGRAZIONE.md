# Guida all'Integrazione del Piano nel Software

## Panoramica

Il piano genera un file JSON (`output/weekly_plan_YYYY-WNN.json`) che contiene **tutte le istruzioni** per l'intera settimana. Il tuo software deve semplicemente leggere questo file e **riprodurre esattamente** quello che c'e scritto, sessione per sessione, in ordine cronologico.

Il software non deve prendere **nessuna decisione** — tutta la logica (quando postare, quanto scrollare, quando ruotare il proxy, quando fare pause) e gia calcolata nel piano.

---

## Struttura del JSON

### Struttura Generale

```json
{
  "week": 9,
  "year": 2026,
  "start_date": "2026-02-23",
  "end_date": "2026-03-01",
  "days": {
    "2026-02-23": {
      "date": "2026-02-23",
      "sessions": [ ... ],
      "proxy_rotations": [ ... ]
    },
    "2026-02-24": { ... },
    ...
  },
  "account_summaries": { ... }
}
```

### Struttura di una Sessione

Ogni sessione e un oggetto con tutti i dati necessari:

```json
{
  "account": "ph1_tiktok",
  "phone": 1,
  "platform": "tiktok",
  "start_time": "19:30",
  "end_time": "19:40",
  "time_slot": "Evening",
  "session_number": 1,
  "type": "normal",
  "post_scheduled": true,
  "post_outcome": "posted",
  "pre_activity_minutes": 4,
  "post_activity_minutes": 5,
  "total_duration_minutes": 10,
  "proxy_rotation_before": true
}
```

### Significato di ogni campo

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `account` | string | Identificativo dell'account (es. `ph1_tiktok`, `ph2_instagram`) |
| `phone` | int | Numero del telefono fisico (1, 2 o 3) |
| `platform` | string | Quale app usare: `"tiktok"` o `"instagram"` |
| `start_time` | string | Orario di inizio sessione in formato `"HH:MM"` (timezone ET) |
| `end_time` | string | Orario di fine sessione in formato `"HH:MM"` (timezone ET) |
| `time_slot` | string | In quale fascia oraria cade (solo informativo) |
| `session_number` | int | 1 = prima sessione del giorno, 2 = seconda |
| `type` | string | Tipo di sessione: `"normal"`, `"aborted"`, `"extended"`, `"rest_only"` |
| `post_scheduled` | bool | `true` se questa sessione prevede un post |
| `post_outcome` | string/null | Come deve finire il post: `"posted"`, `"draft"`, `"skipped"`, o `null` |
| `pre_activity_minutes` | int | Minuti di scroll PRIMA del post |
| `post_activity_minutes` | int | Minuti di scroll DOPO il post |
| `total_duration_minutes` | int | Durata totale della sessione in minuti |
| `proxy_rotation_before` | bool | `true` = devi ruotare il proxy PRIMA di iniziare questa sessione |

---

## I 4 Tipi di Sessione

### 1. `"normal"` — Sessione Normale

La sessione standard: apri l'app, scrolla, posta, scrolla ancora, chiudi.

```
APRI APP
  |
  v
SCROLL per pre_activity_minutes minuti
  |
  v
SE post_scheduled = true:
  |  → Gestisci post_outcome (vedi sezione dedicata sotto)
  |
  v
SCROLL per post_activity_minutes minuti
  |
  v
CHIUDI APP
```

**Esempio dal JSON:**
```json
{
  "type": "normal",
  "platform": "tiktok",
  "pre_activity_minutes": 11,
  "post_scheduled": true,
  "post_outcome": "posted",
  "post_activity_minutes": 12
}
```
→ Apri TikTok, scrolla 11 minuti, pubblica il video, scrolla altri 12 minuti, chiudi.

### 2. `"aborted"` — Sessione Abortita

L'utente apre l'app, ci sta meno di 2 minuti e chiude senza fare niente. Simula il comportamento di aprire un'app per errore o per distrazione.

```
APRI APP
  |
  v
RESTA per pre_activity_minutes minuti (1-2 min max)
  (scroll brevissimo o niente)
  |
  v
CHIUDI APP
```

`post_scheduled` e sempre `false`. Non fare nulla se non aprire e chiudere.

**Esempio:**
```json
{
  "type": "aborted",
  "pre_activity_minutes": 1,
  "post_scheduled": false,
  "total_duration_minutes": 1
}
```
→ Apri l'app, resta ~1 minuto, chiudi.

### 3. `"rest_only"` — Sessione Solo Scroll

L'utente apre l'app e scrolla senza postare. Succede nei giorni di riposo o nelle sessioni extra senza post programmati.

```
APRI APP
  |
  v
SCROLL per pre_activity_minutes minuti
  (nessun post)
  |
  v
CHIUDI APP
```

`post_scheduled` e sempre `false`, `post_activity_minutes` e sempre `0`.

**Esempio:**
```json
{
  "type": "rest_only",
  "pre_activity_minutes": 15,
  "post_scheduled": false,
  "total_duration_minutes": 15
}
```
→ Apri l'app, scrolla 15 minuti guardando contenuti, chiudi.

### 4. `"extended"` — Sessione Estesa

Sessione extra lunga (25-40 minuti). L'utente si perde nello scroll. Puo includere un post a un punto casuale.

```
APRI APP
  |
  v
SE post_scheduled = false:
  |  → SCROLL per total_duration_minutes minuti
  |
SE post_scheduled = true:
  |  → SCROLL per un po' (parte della durata totale)
  |  → Gestisci post_outcome
  |  → SCROLL per il tempo rimanente
  |
  v
CHIUDI APP
```

**Esempio senza post:**
```json
{
  "type": "extended",
  "total_duration_minutes": 37,
  "post_scheduled": false
}
```
→ Apri l'app, scrolla 37 minuti di fila, chiudi.

**Esempio con post:**
```json
{
  "type": "extended",
  "total_duration_minutes": 31,
  "post_scheduled": true,
  "post_outcome": "posted"
}
```
→ Apri l'app, scrolla per un po', posta il video, continua a scrollare fino a 31 minuti totali, chiudi.

---

## I 3 Esiti del Post (post_outcome)

Quando `post_scheduled = true`, il campo `post_outcome` dice come deve andare a finire:

### `"posted"` — Pubblicazione Normale
Il caso standard. Il video viene pubblicato con successo.
```
Seleziona video → Compila caption → Pubblica → Successo
```

### `"draft"` — Salvato come Bozza (errore simulato)
Simula un errore: l'utente inizia a postare ma il video finisce nelle bozze.
```
Seleziona video → Compila caption → Salva come bozza (invece di pubblicare)
```

### `"skipped"` — Post Saltato (cambio idea)
Simula l'utente che cambia idea: apre la schermata di posting ma poi torna indietro.
```
Apri schermata di post → Guarda il video → Torna indietro senza postare
```

**Nota**: Sia per `"draft"` che per `"skipped"`, il post NON viene pubblicato. L'utente continua poi a scrollare normalmente (il campo `post_activity_minutes` indica quanto scrollare dopo).

---

## Rotazione del Proxy

### Quando ruotare

Il campo `proxy_rotation_before` ti dice se ruotare il proxy **prima** di iniziare la sessione.

- `true` = ruota il proxy (stai cambiando telefono)
- `false` = non ruotare (stai sullo stesso telefono)

### Come ruotare

```
HTTP GET → http://sinister.services/selling/rotate?token=a4803a26a87c41699f3c5d10e7bdc292
```

Dopo la rotazione, aspetta 2-3 secondi che il nuovo IP si stabilizzi prima di aprire l'app.

### Configurazione proxy

```
Tipo:     SOCKS5
Host:     sinister.services
Porta:    20002
Username: CY9NRSRY
Password: CY9NRSRY
URL:      socks5://CY9NRSRY:CY9NRSRY@sinister.services:20002
```

---

## Logica Completa del Software

### Pseudo-codice

```python
import json
import time
import random
from datetime import datetime

# ── 1. Carica il piano ──
with open("output/weekly_plan_2026-W09.json") as f:
    plan = json.load(f)

# ── 2. Prendi le sessioni di oggi ──
today = datetime.now().strftime("%Y-%m-%d")
today_plan = plan["days"].get(today)

if not today_plan:
    print("Nessuna sessione programmata per oggi")
    exit()

sessions = today_plan["sessions"]
print(f"Oggi: {len(sessions)} sessioni programmate")

# ── 3. Esegui ogni sessione in ordine ──
for i, session in enumerate(sessions):

    # ── 3a. Aspetta l'orario di inizio ──
    wait_until(session["start_time"])

    # ── 3b. Rotazione proxy (se necessario) ──
    if session["proxy_rotation_before"]:
        print(f"Rotazione proxy: Phone {sessions[i-1]['phone']} -> Phone {session['phone']}")
        rotate_proxy()
        time.sleep(3)  # stabilizzazione IP

    # ── 3c. Esegui la sessione in base al tipo ──
    phone = session["phone"]
    platform = session["platform"]

    print(f"[{session['start_time']}] Phone {phone} | {platform} | {session['type']}")

    if session["type"] == "aborted":
        execute_aborted_session(phone, platform, session)

    elif session["type"] == "rest_only":
        execute_rest_session(phone, platform, session)

    elif session["type"] == "extended":
        execute_extended_session(phone, platform, session)

    elif session["type"] == "normal":
        execute_normal_session(phone, platform, session)

    print(f"[{session['end_time']}] Sessione completata")


# ═══════════════════════════════════════════════════════
# FUNZIONI DA IMPLEMENTARE
# ═══════════════════════════════════════════════════════

def wait_until(time_str):
    """Aspetta fino all'orario specificato (HH:MM in ET).

    Converti l'orario in timestamp ET e fai sleep fino a quel momento.
    Aggiungi una piccola variazione casuale (+/- 30 secondi) per
    non essere esattamente preciso al minuto.
    """
    ...

def rotate_proxy():
    """Chiama l'API di rotazione del proxy.

    HTTP GET a:
    http://sinister.services/selling/rotate?token=a4803a26a87c41699f3c5d10e7bdc292
    """
    ...


def execute_aborted_session(phone, platform, session):
    """Sessione abortita: apri app, resta brevissimo, chiudi.

    Durata: session["pre_activity_minutes"] minuti (1-2 min max).
    Non fare scroll aggressivo — simula apertura accidentale.
    """
    open_app(phone, platform)
    time.sleep(session["pre_activity_minutes"] * 60)
    close_app(phone, platform)


def execute_rest_session(phone, platform, session):
    """Sessione solo scroll: apri app, scrolla, chiudi.

    Durata: session["pre_activity_minutes"] minuti.
    Nessun post. Solo consumo di contenuti.
    """
    open_app(phone, platform)
    random_scroll(phone, platform, session["pre_activity_minutes"])
    close_app(phone, platform)


def execute_extended_session(phone, platform, session):
    """Sessione estesa: scroll lungo (25-40 min), eventuale post.

    Durata totale: session["total_duration_minutes"].
    Se c'e un post, inseriscilo a un punto casuale durante la sessione.
    """
    open_app(phone, platform)

    total = session["total_duration_minutes"]

    if session["post_scheduled"]:
        # Posta a un punto casuale nella sessione
        scroll_before = random.randint(5, total - 5)
        random_scroll(phone, platform, scroll_before)
        handle_post(phone, platform, session["post_outcome"])
        random_scroll(phone, platform, total - scroll_before)
    else:
        random_scroll(phone, platform, total)

    close_app(phone, platform)


def execute_normal_session(phone, platform, session):
    """Sessione normale: scroll pre-post, post, scroll post-post.

    1. Scrolla per session["pre_activity_minutes"] minuti
    2. Se post_scheduled: gestisci il post con l'outcome specificato
    3. Scrolla per session["post_activity_minutes"] minuti
    """
    open_app(phone, platform)

    # Scroll prima del post
    random_scroll(phone, platform, session["pre_activity_minutes"])

    # Post (se previsto)
    if session["post_scheduled"]:
        handle_post(phone, platform, session["post_outcome"])

    # Scroll dopo il post
    if session["post_activity_minutes"] > 0:
        random_scroll(phone, platform, session["post_activity_minutes"])

    close_app(phone, platform)


def handle_post(phone, platform, outcome):
    """Gestisci il post in base all'outcome.

    outcome = "posted"  → pubblica il video normalmente
    outcome = "draft"   → inizia a postare ma salva come bozza
    outcome = "skipped" → apri schermata di post, poi torna indietro
    """
    if outcome == "posted":
        # Flusso completo: seleziona video, caption, pubblica
        select_video(phone, platform)
        write_caption(phone, platform)
        tap_publish(phone, platform)

    elif outcome == "draft":
        # Flusso errore: seleziona video, caption, salva come bozza
        select_video(phone, platform)
        write_caption(phone, platform)
        tap_save_draft(phone, platform)

    elif outcome == "skipped":
        # Flusso cambio idea: apri schermata post, guarda, torna indietro
        open_post_screen(phone, platform)
        time.sleep(random.randint(3, 8))  # guarda un attimo
        go_back(phone, platform)


def random_scroll(phone, platform, minutes):
    """Scrolla il feed per N minuti con comportamento umano.

    Implementa:
    - Velocita di scroll variabile
    - Pause su contenuti interessanti (2-8 secondi per video)
    - Occasionali like (opzionale)
    - Swipe non perfettamente dritti
    """
    ...

def open_app(phone, platform):
    """Apri TikTok o Instagram sul telefono specificato."""
    ...

def close_app(phone, platform):
    """Chiudi l'app corrente."""
    ...
```

---

## Checklist di Integrazione

### Cosa ti serve per iniziare

- [ ] Il piano JSON generato (`python -m planner.main --weekly`)
- [ ] Un modo per controllare i 3 telefoni (ADB, Appium, o altro framework)
- [ ] Connessione al proxy SOCKS5 configurata su ogni telefono
- [ ] I video da postare pronti per ogni account

### Funzioni da implementare nel tuo software

| Funzione | Priorita | Descrizione |
|----------|----------|-------------|
| `wait_until()` | Alta | Timer che aspetta l'orario giusto |
| `rotate_proxy()` | Alta | HTTP GET all'URL di rotazione |
| `open_app()` | Alta | Apri TikTok/Instagram sul telefono |
| `close_app()` | Alta | Chiudi l'app |
| `random_scroll()` | Alta | Scrolla il feed in modo realistico |
| `handle_post()` | Alta | Pubblica video / salva bozza / skip |
| `select_video()` | Media | Seleziona il video da pubblicare |
| `write_caption()` | Media | Scrivi la caption/descrizione |
| `tap_publish()` | Media | Premi il pulsante di pubblicazione |
| `tap_save_draft()` | Bassa | Salva come bozza (per errori simulati) |
| `open_post_screen()` | Bassa | Apri la schermata di nuovo post |
| `go_back()` | Bassa | Torna indietro (per skip simulati) |

### Sequenza Operativa Giornaliera

```
1. All'inizio della giornata:
   → Carica il JSON del piano settimanale
   → Filtra le sessioni di oggi (chiave = data di oggi)

2. Per ogni sessione (in ordine):
   → Aspetta l'orario di start_time
   → Se proxy_rotation_before: ruota il proxy
   → Esegui la sessione in base al type
   → Logga il risultato

3. A fine giornata:
   → Verifica che tutte le sessioni siano state eseguite
   → Logga eventuali errori/problemi
```

---

## Note Importanti

### Timezone
Tutti gli orari nel JSON sono in **ET (Eastern Time)**. Il tuo software deve convertirli nel timezone locale se necessario, o assicurarsi che i telefoni siano configurati in ET.

### Ordine delle Sessioni
Le sessioni nel JSON sono **gia in ordine cronologico**. Non servono sort o riordinamenti — eseguile nell'ordine in cui appaiono.

### Tolleranza Oraria
Non essere roboticamente preciso sugli orari. Aggiungi +/- 30-60 secondi di variazione casuale all'inizio di ogni sessione. Se `start_time` dice `"19:30"`, inizia tra le 19:29:30 e le 19:30:30.

### Durate dello Scroll
I minuti indicati nel JSON (es. `pre_activity_minutes: 11`) sono la durata target. Il tuo software puo variare di +/- 1 minuto senza problemi. L'importante e che la durata totale della sessione sia circa uguale a `total_duration_minutes`.

### Gestione Errori
Se una sessione fallisce (crash dell'app, errore di rete, ecc.), non riprovare immediatamente. Logga l'errore e passa alla sessione successiva. Il piano e progettato per essere resiliente — saltare una sessione non compromette la settimana.

### Generazione Nuovi Piani
Genera un nuovo piano ogni settimana:
```bash
python -m planner.main --weekly
```
Il sistema ricorda lo stato precedente (giorni di riposo, personalita, ecc.) e genera un piano diverso ma coerente con la storia dell'account.
