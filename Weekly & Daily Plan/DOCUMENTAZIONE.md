# Weekly & Daily Plan Generator — Documentazione Completa

## Indice
1. [Introduzione e Contesto del Progetto](#1-introduzione-e-contesto-del-progetto)
2. [Architettura del Sistema](#2-architettura-del-sistema)
3. [Setup Tecnico](#3-setup-tecnico)
4. [Le 17 Regole + Regole Aggiuntive](#4-le-17-regole--regole-aggiuntive)
5. [Personalità Dinamiche (Regola 16)](#5-personalità-dinamiche-regola-16)
6. [Flusso di Esecuzione](#6-flusso-di-esecuzione)
7. [Output Generati](#7-output-generati)
8. [Stato Persistente](#8-stato-persistente)
9. [Validazione e Testing](#9-validazione-e-testing)
10. [Parametri Configurabili](#10-parametri-configurabili)

---

## 1. Introduzione e Contesto del Progetto

### Il Progetto

Stiamo costruendo un sistema di gestione automatizzata per **6 account social** distribuiti su **3 telefoni fisici**, ognuno con un account TikTok e un account Instagram. Questi account fanno parte di un progetto di crescita organica su piattaforme social — pubblicano contenuti video in modo regolare per costruire audience e engagement.

### Il Problema

Le piattaforme social (TikTok, Instagram) hanno sistemi anti-bot e anti-spam molto sofisticati. Se un account posta in modo troppo regolare, troppo meccanico o con pattern riconoscibili, rischia:

- **Shadowban**: i contenuti vengono penalizzati dall'algoritmo e mostrati a meno persone
- **Limitazioni**: l'account viene temporaneamente limitato nelle funzionalità
- **Ban permanente**: nei casi peggiori, l'account viene sospeso definitivamente

Inoltre, tutti e 6 gli account condividono **un unico proxy mobile SOCKS5 con IP USA**. Questo significa che se due account risultano attivi contemporaneamente dallo stesso IP, le piattaforme possono collegare gli account tra loro e bannarli tutti insieme.

### La Soluzione

Questo generatore crea **piani settimanali e giornalieri** che emulano perfettamente il comportamento di **6 utenti umani reali e indipendenti**. Ogni piano rispetta 17+ regole comportamentali studiate per:

1. **Evitare pattern meccanici**: orari, durate e azioni variano ogni giorno in modo naturale
2. **Emulare imperfezioni umane**: sessioni abortite, errori di posting, giorni di riposo, sessioni di puro scroll
3. **Gestire il proxy condiviso**: solo 1 account attivo alla volta, rotazione IP ad ogni cambio telefono
4. **Variare nel tempo**: le "personalità" degli account cambiano gradualmente ogni 1-2 settimane

Il risultato è un piano che, visto dall'esterno, sembra il comportamento naturale di 6 persone diverse che usano i social in modo indipendente.

### Come si Integra nell'App

Il piano generato viene utilizzato dall'automazione (app/bot) per sapere **esattamente quando e cosa fare** su ogni account:

- **Quando** aprire l'app (orario preciso)
- **Su quale telefono** operare
- **Quale piattaforma** usare (TikTok o Instagram)
- **Quanto scrollare** prima di postare (simulare comportamento umano)
- **Se postare** o meno (giorni di riposo, errori simulati)
- **Quanto restare** dopo aver postato
- **Quando ruotare il proxy** (cambio IP al cambio telefono)

Il piano viene generato in formato **JSON** (per l'automazione) e **TXT** (per verifica manuale).

---

## 2. Architettura del Sistema

### Struttura File

```
Weekly & Daily Plan/
├── planner/                    # Package Python principale
│   ├── __init__.py
│   ├── config.py               # Configurazione: account, proxy, slot orari, parametri regole
│   ├── models.py               # Modelli dati: Session, DailyPlan, WeeklyPlan, ecc.
│   ├── personality.py          # Regola 16: personalità dinamiche degli account
│   ├── rules_engine.py         # Implementazione di tutte le regole comportamentali
│   ├── scheduler.py            # Motore di scheduling principale (cuore del sistema)
│   ├── proxy_manager.py        # Gestione rotazione proxy
│   ├── formatter.py            # Output: JSON strutturato + testo leggibile
│   └── main.py                 # Entry point CLI
├── state/
│   └── account_state.json      # Stato persistente tra esecuzioni
├── output/                     # Piani generati
│   ├── weekly_plan_YYYY-WNN.json
│   ├── weekly_plan_YYYY-WNN.txt
│   ├── daily_plan_YYYY-MM-DD.json
│   └── daily_plan_YYYY-MM-DD.txt
├── validate.py                 # Script di validazione regole
└── stress_test.py              # Test di stress (20 generazioni)
```

### I 6 Account

| Telefono | TikTok | Instagram |
|----------|--------|-----------|
| Phone 1 | `ph1_tiktok` | `ph1_instagram` |
| Phone 2 | `ph2_tiktok` | `ph2_instagram` |
| Phone 3 | `ph3_tiktok` | `ph3_instagram` |

### Il Proxy

- **Tipo**: SOCKS5 Mobile USA
- **Server**: `sinister.services:20002`
- **Credenziali**: `CY9NRSRY:CY9NRSRY`
- **Rotazione IP**: via HTTP GET a `http://sinister.services/selling/rotate?token=a4803a26a87c41699f3c5d10e7bdc292`
- **Regola fondamentale**: solo 1 account attivo alla volta. Quando si cambia telefono, si ruota l'IP.

---

## 3. Setup Tecnico

### Prerequisiti
- Python 3.8+ installato
- Nessuna dipendenza esterna (solo libreria standard Python)

### Utilizzo

```bash
# Generare piano settimanale (settimana corrente)
python -m planner.main --weekly

# Generare piano settimanale per una data specifica
python -m planner.main --weekly --date 2026-03-02

# Generare piano giornaliero
python -m planner.main --daily

# Generare piano giornaliero per data specifica
python -m planner.main --daily --date 2026-03-02

# Validare il piano generato
python validate.py

# Stress test (20 generazioni + validazione)
python stress_test.py
```

### Timezone
Tutti gli orari sono in **ET (Eastern Time)**, timezone di riferimento per il proxy USA.

---

## 4. Le 17 Regole + Regole Aggiuntive

### REGOLA 1 — Ordine Giornaliero dei Telefoni

**Cosa fa**: Ogni giorno, l'ordine in cui i 3 telefoni vengono utilizzati è completamente casuale. Anche l'ordine TikTok/Instagram dentro ogni telefono è casuale.

**Perché**: Un umano non segue sempre lo stesso ordine. Un giorno potrebbe iniziare da TikTok, il giorno dopo da Instagram. Non c'è pattern fisso.

**Vincolo critico — Blocco Telefono**: I 2 account dello stesso telefono sono **sempre consecutivi**. Non succede mai che Phone 1 TikTok sia separato da Phone 1 Instagram da una sessione di un altro telefono. Questo perché fisicamente stai usando lo stesso dispositivo: apri TikTok, fai le tue cose, poi apri Instagram sullo stesso telefono, poi posi il telefono e prendi il successivo.

**Esempio**:
```
Phone 2 | TikTok        ← blocco Phone 2
Phone 2 | Instagram
  [ROTAZIONE PROXY]      ← cambio telefono = cambio IP
Phone 1 | Instagram      ← blocco Phone 1
Phone 1 | TikTok
  [ROTAZIONE PROXY]
Phone 3 | TikTok         ← blocco Phone 3
Phone 3 | Instagram
```

### REGOLA 1b — Nessuna Stessa Piattaforma al Confine tra Telefoni

**Cosa fa**: Quando si passa da un telefono all'altro, il primo account del nuovo telefono deve essere su una piattaforma **diversa** dall'ultimo account del telefono precedente.

**Perché**: Se l'ultimo account del Phone 1 è TikTok e il primo account del Phone 2 è ancora TikTok, sembrerebbe innaturale — due sessioni TikTok consecutive da IP diversi in pochi minuti. Alternando piattaforma, il pattern è più realistico.

**Esempio**:
```
CORRETTO:
  Phone 1 | Instagram    ← ultimo di Phone 1
  [ROTAZIONE PROXY]
  Phone 2 | TikTok       ← primo di Phone 2 (piattaforma diversa ✓)

EVITATO:
  Phone 1 | Instagram
  [ROTAZIONE PROXY]
  Phone 2 | Instagram    ← stessa piattaforma ✗ (non succede mai)
```

### REGOLA 2 — Frequenza di Posting

**Cosa fa**: Determina quanti post fa ogni account ogni giorno. I valori possibili sono: 0 (riposo), 1 (giorno one-post), o 2 (giorno normale).

**Come funziona**: Ogni account ha un `two_post_target` (75-95%) che rappresenta la probabilità di fare 2 post in un giorno normale (non rest, non one-post). Questo target fa parte della "personalità" dell'account e cambia ogni 1-2 settimane.

**Perché**: Un utente reale non posta esattamente lo stesso numero di volte ogni giorno. Alcuni giorni è più attivo, altri meno. Il target del 75-95% assicura che la maggior parte dei giorni abbia 2 post, ma con variazione naturale.

**Numeri tipici settimanali**: 8-12 post per account.

### REGOLA 3 — Numero di Sessioni per Account

**Cosa fa**: Ogni account ha **2 sessioni al giorno** (92% dei casi) o **1 sola sessione** (8% dei casi). Massimo 2 sessioni.

**Come funziona**: Le 2 sessioni vengono posizionate in slot temporali diversi. Ad esempio: una sessione nel Midday (11-13) e una nell'Evening (19:30-22).

**Perché**: Un utente reale non sta sull'app una volta sola al giorno — di solito controlla almeno 2 volte. Ma occasionalmente (8%) ha una giornata impegnata e controlla solo una volta.

**Vincolo Blocco Telefono**: Entrambi gli account dello stesso telefono hanno sempre lo stesso numero di sessioni. Se Phone 1 TikTok ha 2 sessioni, anche Phone 1 Instagram ha 2 sessioni, così appaiono sempre insieme in ogni round.

### REGOLA 4 — Durata Scroll Pre-Post

**Cosa fa**: Prima di postare, l'utente scrolla (guarda contenuti di altri) per un certo tempo.

| Tipo | Durata | Probabilità |
|------|--------|-------------|
| Normale | 6-19 minuti | ~77% |
| Breve (apro e posto quasi subito) | 1-5 minuti | 8-15% |
| Lunga (mi perdo nello scroll) | 19-24 minuti | 6-13% |

**Perché**: Nessuno apre TikTok/Instagram e posta immediatamente. Prima guarda cosa c'è, scrolla un po' il feed, guarda qualche video — poi posta. La variazione emula i diversi stati d'animo: a volte hai fretta (1-5 min), a volte ti perdi nei contenuti (19-24 min), di solito è una via di mezzo.

### REGOLA 5 — Durata Scroll Post-Post

**Cosa fa**: Dopo aver postato, l'utente continua a scrollare per un po' prima di chiudere l'app.

| Tipo | Durata | Probabilità |
|------|--------|-------------|
| Normale | 6-14 minuti | ~80% |
| Breve (chiudo subito dopo il post) | 1-5 minuti | 8-15% |
| Lunga (resto a controllare views/commenti) | 15-24 minuti | 3-8% |

**Perché**: Dopo aver postato, un utente reale spesso continua a guardare altri contenuti, controlla le prime views, risponde a qualche commento. La durata varia: a volte chiude subito, a volte resta a lungo.

### REGOLA 6 — Slot Temporali e Smart Distribution

**Cosa fa**: Le sessioni vengono posizionate in finestre orarie specifiche, diverse tra giorni feriali e weekend.

**Slot Giorni Feriali (Lun-Ven) — ET:**

| Slot | Orario | Peso | Logica |
|------|--------|------|--------|
| Morning | 6:00-8:00 | 1 | Sveglia, controlla il telefono |
| Midday | 11:00-13:00 | 2 | Pausa pranzo |
| Afternoon | 16:00-18:00 | 2 | Fine lavoro/scuola |
| Evening | 19:30-22:00 | 3 | Orario di punta, massimo engagement |

**Slot Weekend (Sab-Dom) — ET:**

| Slot | Orario | Peso | Logica |
|------|--------|------|--------|
| Late Morning | 9:00-11:00 | 1 | Sveglia tardi nel weekend |
| Early Afternoon | 12:00-14:00 | 2 | Dopo pranzo |
| Afternoon | 15:00-18:00 | 2 | Pomeriggio libero |
| Night Peak | 19:00-23:30 | 3 | Serata, massimo engagement |

**Smart Distribution**: Le sessioni dove l'utente deve postare vengono messe preferibilmente negli slot con peso engagement più alto (Evening/Night Peak), perché è lì che i contenuti ottengono più views. Il peso viene elevato al quadrato per le sessioni di posting, aumentando drasticamente la probabilità degli slot serali.

**Perché**: Un utente strategico posta quando sa che ci sono più persone online. Ma non sempre — a volte posta anche nel Midday. La distribuzione pesata emula questo comportamento.

### REGOLA 7 — Giorno di Riposo Settimanale

**Cosa fa**: Ogni account ha l'84-95% di probabilità di avere un giorno di riposo durante la settimana. Nel giorno di riposo l'account **apre comunque l'app e scrolla**, ma **non posta niente**.

**Perché**: Anche gli utenti più attivi saltano un giorno ogni tanto. Ma non spariscono completamente — continuano a consumare contenuti. Avere sessioni di solo scroll nel giorno di riposo appare naturale e mantiene l'account "vivo" senza postare.

**Esempio nel piano**:
```
Phone 2 TikTok - Rest: Martedì
  → Martedì: "Scroll 11min (no post - rest/browse)" e "Scroll 22min (no post - rest/browse)"
```

### REGOLA 8 — Giorno con 1 Solo Post

**Cosa fa**: Ogni account ha 1 giorno a settimana dove posta solo 1 volta invece di 2. Questo giorno è **sempre diverso** dal giorno di riposo.

**Perché**: Aggiunge un'ulteriore variazione. Non tutti i giorni attivi sono uguali — alcuni giorni l'utente è meno motivato e posta una sola volta.

### REGOLA 9 — Rotazione dei Giorni Speciali

**Cosa fa**: Il giorno di riposo e il giorno one-post vengono **ruotati tra le settimane**. Non cadono mai nello stesso giorno della settimana per 2 settimane consecutive.

**Perché**: Se il riposo fosse sempre il Lunedì, sarebbe un pattern riconoscibile. Ruotando il giorno, il comportamento appare più naturale e imprevedibile.

**Come funziona**: Il sistema salva nel file di stato quale giorno della settimana (0=Lun, 6=Dom) è stato usato come riposo/one-post. La settimana dopo, quel giorno viene escluso dalla selezione.

### REGOLA 10 — Pausa di 2 Giorni Consecutivi

**Cosa fa**: Ogni 7-15 giorni, **un account casuale** su ogni telefono prende una pausa completa di 2 giorni consecutivi. Durante la pausa, quell'account è **completamente inattivo** (0 sessioni, 0 scroll, sparisce).

**Vincoli**:
- Solo 1 dei 2 account del telefono prende la pausa (l'altro resta attivo normalmente)
- Le pause su telefoni diversi **non si sovrappongono** nel tempo
- L'intervallo tra pause è randomizzato (7-15 giorni) per ogni telefono

**Perché**: Anche gli utenti più attivi a volte si assentano per un paio di giorni (vacanza, giornate impegnate, disintossicazione digitale). Questo pattern è molto comune e rende l'account più credibile.

**Esempio**:
```
Phone 1 TikTok: break Venerdì + Sabato
Phone 2 Instagram: break Lunedì + Martedì
Phone 3 TikTok: break Mercoledì + Giovedì
→ Nessuna sovrapposizione tra telefoni
```

### REGOLA 11 — Variazione Weekend

**Cosa fa**: Nel weekend il comportamento cambia in diversi modi:
- **60-75% delle sessioni** sono dopo le 16:00 (nella pratica la media è ~85%)
- Gli slot sono diversi: si inizia alle 9:00 (non alle 6:00), si finisce alle 23:30 (non alle 22:00)
- Le sessioni sono leggermente più lunghe (moltiplicatore 1.0-1.3x)
- Account con personalità `weekend_more_active` scrollano ancora di più

**Perché**: Nel weekend le persone si svegliano più tardi, hanno più tempo libero, e passano più tempo sui social, specialmente la sera. L'algoritmo riflette questo spostamento di comportamento.

### REGOLA 12 — Sessioni Abortite

**Cosa fa**: Il 5-10% delle sessioni viene "abortito": l'utente apre l'app, ci sta meno di 2 minuti, e chiude senza fare niente. Se la sessione avrebbe dovuto avere un post, il post viene rischedulato nel round successivo.

**Perché**: Tutti abbiamo aperto un'app per sbaglio, o l'abbiamo aperta e poi ci siamo distratti subito. Queste micro-sessioni sono estremamente comuni nel comportamento umano reale e rendono il profilo di utilizzo più credibile.

**Esempio**:
```
19:59-20:00  Phone 3 | TikTok
             ABORTED (1min) - opened and closed
```

### REGOLA 13 — Sessioni Estese

**Cosa fa**: Il 3-7% di probabilità settimanale (per account) di una sessione extra lunga, tra 25 e 40 minuti di scroll/attività. Massimo 1 sessione estesa per account per settimana.

**Perché**: A volte un utente si perde completamente nello scroll — trova contenuti interessanti, un rabbit hole di video, e resta molto più del solito. Queste sessioni anomale sono normali nel comportamento umano.

**Esempio**:
```
20:25-21:02  Phone 3 | TikTok
             EXTENDED session (37min) - long scroll
```

### REGOLA 14 — Errori di Posting

**Cosa fa**: Quando un account tenta di postare, c'è una piccola probabilità di "errore":

| Evento | Probabilità | Significato |
|--------|-------------|-------------|
| SAVED AS DRAFT | 2-5% | Il video viene salvato come bozza per sbaglio |
| SKIPPED POST | 1-3% | L'utente cambia idea e decide di non postare |

Il post conta come "tentato ma non riuscito". L'utente continua a scrollare normalmente dopo l'errore.

**Perché**: Nessuno è perfetto. A volte il dito scivola sul pulsante sbagliato (draft), a volte riguardi il video e decidi che non ti piace (skip). Queste imperfezioni sono markers di comportamento umano che i sistemi anti-bot cercano.

**Esempio**:
```
Scroll 1min -> SAVED AS DRAFT (error) -> Scroll 15min
Scroll 1min -> SKIPPED POST (changed mind) -> Scroll 8min
```

### REGOLA 15 — Coordinazione Cross-Phone

**Cosa fa**: Ogni giorno devono essere attivi **almeno 2 telefoni su 3**. Il sistema impedisce che i 2-day break + rest day creino una situazione dove solo 1 telefono è attivo.

**Perché**: Se un giorno avesse attività solo su 1 telefono, significherebbe che tutte le sessioni vengono dallo stesso IP (nessuna rotazione proxy). Avere almeno 2 telefoni attivi garantisce che ci siano rotazioni e che il pattern di utilizzo del proxy sia distribuito.

**Come funziona**: Dopo aver assegnato tutte le pause, il sistema verifica ogni giorno. Se un giorno ha meno di 2 telefoni attivi, rimuove automaticamente un 2-day break per risolvere il conflitto.

### REGOLA 17 — Sequenzialità e Gap tra Sessioni

**Cosa fa**: Le sessioni non si sovrappongono mai e hanno gap naturali tra di loro:

| Situazione | Gap |
|------------|-----|
| Tra 2 account dello **stesso telefono** | 1-5 minuti |
| Tra **telefoni diversi** (dopo rotazione proxy) | 0-30 minuti |

**Perché**: Il gap di 1-5 minuti tra account dello stesso telefono simula il tempo di chiudere un'app e aprirne un'altra. Il gap di 0-30 minuti tra telefoni diversi simula il tempo di posare un telefono, magari fare altro, e prendere il successivo.

---

## 5. Personalità Dinamiche (Regola 16)

### Concetto

Ogni account ha una "personalità" — un set di parametri che influenzano tutte le regole sopra. Questo fa sì che ogni account si comporti in modo **leggermente diverso** dagli altri.

### Parametri della Personalità

| Parametro | Range | Cosa Influenza |
|-----------|-------|----------------|
| `two_post_target` | 75-95% | Probabilità di fare 2 post nei giorni normali |
| `session_length_bias` | 0.85-1.15 | Moltiplicatore per la durata di tutte le sessioni |
| `rest_day_prob` | 84-95% | Probabilità di avere un giorno di riposo |
| `abort_prob` | 5-10% | Probabilità che una sessione venga abortita |
| `draft_error_prob` | 2-5% | Probabilità di errore draft nel posting |
| `skip_post_prob` | 1-3% | Probabilità di skippare un post |
| `pre_post_short_prob` | 8-15% | Probabilità di scroll breve prima del post |
| `pre_post_long_prob` | 6-13% | Probabilità di scroll lungo prima del post |
| `post_post_short_prob` | 8-15% | Probabilità di scroll breve dopo il post |
| `post_post_long_prob` | 3-8% | Probabilità di scroll lungo dopo il post |
| `weekend_more_active` | 15-25% chance | Se l'account è più attivo nel weekend |

### Evoluzione nel Tempo

La personalità **cambia ogni 7-14 giorni** con una transizione graduale:
- I nuovi valori vengono generati casualmente dentro i range
- Il risultato finale è un blend: **70% nuovi valori + 30% vecchi valori**
- Questo crea una transizione morbida, non un cambio brusco

**Perché**: Le persone reali cambiano comportamento nel tempo. Magari una settimana postano di più, la settimana dopo sono meno attivi. Ma non cambiano drasticamente da un giorno all'altro — è una transizione graduale.

---

## 6. Flusso di Esecuzione

### Generazione Piano Settimanale

```
1. CARICAMENTO STATO
   └→ Legge account_state.json (personalità, ultimo riposo, ultimo break, ecc.)
   └→ Aggiorna personalità se necessario (R16)

2. ASSEGNAZIONE GIORNI SPECIALI (per ogni account)
   ├→ Rest day: scelta casuale, diverso dalla settimana precedente (R7, R9)
   ├→ One-post day: scelta casuale, diverso da rest e da settimana precedente (R8, R9)
   └→ Two-day break: se l'intervallo è scaduto, assegna 2 giorni consecutivi (R10)
       └→ Validazione cross-phone: almeno 2 telefoni attivi ogni giorno (R15)

3. PER OGNI GIORNO DELLA SETTIMANA:
   │
   ├→ Step 1: Determina sessioni e post per ogni account
   │   ├→ Account in 2-day break? → completamente inattivo
   │   ├→ Giorno di riposo? → sessioni ma 0 post
   │   ├→ Giorno one-post? → massimo 1 post
   │   └→ Giorno normale? → 1-2 post (basato su personalità)
   │
   ├→ Step 1b: Sincronizza sessioni per telefono
   │   └→ Entrambi gli account di un telefono hanno lo stesso numero di sessioni
   │
   ├→ Step 2: Costruisci blocchi telefono per round
   │   ├→ Round 1: prima sessione di ogni account
   │   ├→ Round 2: seconda sessione (se presente)
   │   ├→ Per ogni sessione: check abort (R12) → se abortita e aveva post, reschedula
   │   ├→ Per ogni sessione: check extended (R13) → sessione lunga 25-40min
   │   └→ Assegna slot temporale al blocco (R6, Smart Distribution)
   │
   ├→ Step 3: Forza round 2 dopo round 1
   │   └→ Se lo slot del round 2 è prima del round 1, lo sposta avanti
   │
   ├→ Step 4: Ordina blocchi per orario slot + ordine telefono
   │
   ├→ Step 4b: Evita stessa piattaforma ai confini tra telefoni
   │   └→ Se ultimo account Phone X = stessa piattaforma del primo di Phone Y → inverti Phone Y
   │
   └→ Step 5: Posiziona sessioni sequenzialmente
       ├→ Calcola orario esatto dentro lo slot (randomizzato)
       ├→ Applica gap tra sessioni (1-5min stesso telefono, 0-30min diverso)
       ├→ Inserisci rotazioni proxy dove serve (cambio telefono)
       └→ Garantisci zero sovrapposizioni (R17)

4. SALVATAGGIO
   ├→ Salva piano in output/ (JSON + TXT)
   └→ Aggiorna account_state.json con il nuovo stato
```

### Schema di una Giornata Tipica

```
MATTINA (Midday slot, 11:00-13:00)
  │
  ├→ Phone 2 | TikTok
  │   Scroll 11min → POST video → Scroll 8min
  ├→ Phone 2 | Instagram
  │   Scroll 7min → POST video → Scroll 12min
  │
  │  [ROTAZIONE PROXY - cambio IP]
  │
  ├→ Phone 1 | Instagram          ← piattaforma diversa da ultimo di Ph2
  │   Scroll 15min → POST video → Scroll 6min
  └→ Phone 1 | TikTok
      Scroll 5min (no post - rest/browse)

  ... gap 10-25 minuti ...

SERA (Evening slot, 19:30-22:00)
  │
  ├→ Phone 2 | Instagram
  │   Scroll 19min → POST video → Scroll 10min
  ├→ Phone 2 | TikTok
  │   Scroll 8min → POST video → Scroll 14min
  │
  │  [ROTAZIONE PROXY]
  │
  ├→ Phone 3 | TikTok              ← piattaforma diversa da ultimo di Ph2
  │   ABORTED (1min) - opened and closed
  └→ Phone 3 | Instagram
      Scroll 24min → POST video → Scroll 3min
```

---

## 7. Output Generati

### JSON (per l'automazione)

Il file JSON contiene tutti i dati strutturati necessari all'automazione:

```json
{
  "week": 9,
  "year": 2026,
  "start_date": "2026-02-23",
  "end_date": "2026-03-01",
  "days": {
    "2026-02-23": {
      "sessions": [
        {
          "account": "ph1_tiktok",
          "phone": 1,
          "platform": "tiktok",
          "start_time": "12:14",
          "end_time": "12:38",
          "time_slot": "Midday",
          "session_number": 1,
          "type": "normal",
          "post_scheduled": true,
          "post_outcome": "posted",
          "pre_activity_minutes": 11,
          "post_activity_minutes": 12,
          "total_duration_minutes": 24,
          "proxy_rotation_before": false
        }
      ],
      "proxy_rotations": [
        {
          "time": "15:05",
          "reason": "phone_switch",
          "from_phone": 1,
          "to_phone": 2
        }
      ]
    }
  },
  "account_summaries": {
    "ph1_tiktok": {
      "total_posts": 12,
      "total_sessions": 14,
      "rest_days": ["2026-02-26"],
      "one_post_days": ["2026-02-24"],
      "two_day_break": [],
      "aborted_sessions": 1,
      "extended_sessions": 0,
      "draft_errors": 0,
      "skipped_posts": 0
    }
  }
}
```

**Campi sessione spiegati**:
- `account`: identificativo dell'account (es. `ph1_tiktok`)
- `phone`: numero del telefono (1, 2 o 3)
- `platform`: piattaforma (`tiktok` o `instagram`)
- `start_time` / `end_time`: orario inizio/fine sessione (ET)
- `time_slot`: in quale slot cade la sessione
- `session_number`: 1 = prima sessione del giorno, 2 = seconda
- `type`: `normal`, `aborted`, `extended`, o `rest_only`
- `post_scheduled`: se era previsto un post in questa sessione
- `post_outcome`: `posted`, `draft`, `skipped`, o `null`
- `pre_activity_minutes`: minuti di scroll prima del post
- `post_activity_minutes`: minuti di scroll dopo il post
- `total_duration_minutes`: durata totale della sessione
- `proxy_rotation_before`: se c'è stata rotazione proxy prima di questa sessione

### TXT (per verifica manuale)

Il file TXT è una versione leggibile per controllare visivamente che tutto sia corretto:

```
============================================================
  WEEKLY PLAN - Week 9, 2026
  23/02/2026 - 01/03/2026
  Generated: 27/02/2026 15:54 | Timezone: ET (Eastern Time)
============================================================

LUNEDI' 23/02/2026
--------------------------------------------------
  12:14-12:38  Phone 2 | TikTok
             Scroll 11min -> POST video -> Scroll 12min
             [ROTATE PROXY: Phone 2 -> Phone 1]
  16:00-16:17  Phone 1 | Instagram
             Scroll 10min -> POST video -> Scroll 6min
  ...

============================================================
  WEEKLY SUMMARY
============================================================
  Phone 1  Instagram:  8 posts, 13 sessions | Rest: Sun 01/03 | 1-post: Mon 23/02
  Phone 1     TikTok:  8 posts, 10 sessions | Rest: Sat 28/02 | 1-post: Thu 26/02
  ...
```

---

## 8. Stato Persistente

Il file `state/account_state.json` salva le informazioni necessarie tra una generazione e l'altra:

```json
{
  "ph1_tiktok": {
    "account_name": "ph1_tiktok",
    "personality": {
      "two_post_target": 0.87,
      "session_length_bias": 1.03,
      "rest_day_prob": 0.91,
      "abort_prob": 0.07,
      ...
    },
    "personality_last_changed": "2026-02-20",
    "last_rest_day_weekday": 3,
    "last_one_post_day_weekday": 5,
    "last_two_day_break_date": "2026-02-15",
    "two_day_break_interval": 11,
    "extended_session_used_this_week": false,
    "extended_session_week": 9
  },
  ...
}
```

**Cosa viene tracciato**:
- **Personalità corrente** + data ultimo cambio → per sapere quando generarne una nuova (R16)
- **Ultimo giorno di riposo** (weekday 0-6) → per non ripetere lo stesso giorno (R9)
- **Ultimo giorno one-post** (weekday 0-6) → per non ripetere lo stesso giorno (R9)
- **Data ultimo 2-day break** → per calcolare quando fare il prossimo (R10)
- **Intervallo break** → quanti giorni tra un break e il successivo (7-15, randomizzato)
- **Sessione estesa usata** → per limitare a 1 per settimana per account (R13)

---

## 9. Validazione e Testing

### validate.py

Controlla un piano generato contro tutte le regole:
- R1: Account dello stesso telefono sempre consecutivi
- R1b: Nessuna stessa piattaforma ai confini tra telefoni
- R3: Massimo 2 sessioni per account per giorno
- R4/R5: Durate scroll nei range corretti
- R6: Sessioni dentro i confini degli slot (weekday vs weekend)
- R7: Nessun post nei giorni di riposo
- R8: Massimo 1 post nei giorni one-post, diverso dal rest day
- R10: Break di 2 giorni consecutivi, nessuna sessione in quei giorni
- R12: Sessioni abortite < 2 minuti, senza post
- R13: Sessioni estese 25-40 minuti
- R15: Almeno 2 telefoni attivi ogni giorno
- R17: Nessuna sovrapposizione tra sessioni
- PROXY: Rotazione solo e sempre al cambio telefono

### stress_test.py

Genera il piano **20 volte** e valida ogni generazione. Riporta:
- Errori e warning totali
- Pass rate (deve essere 100%)
- Statistiche weekend bias (media, min, max delle sessioni dopo le 16:00)

**Ultimo risultato**: 20/20 PASS, 0 errori, 0 warning.

---

## 10. Parametri Configurabili

Tutti i parametri sono centralizzati in `planner/config.py`. Ecco cosa puoi modificare:

### Slot Temporali
Modifica gli orari e i pesi degli slot in `WEEKDAY_SLOTS` e `WEEKEND_SLOTS`.

### Probabilità delle Regole

| Parametro | Valore attuale | Dove si trova |
|-----------|---------------|---------------|
| Probabilità sessione singola | 8% | `single_session_prob` |
| Scroll pre-post (normale) | 6-19 min | `pre_post_normal_range` |
| Scroll pre-post (breve) | 1-5 min | `pre_post_short_range` |
| Scroll pre-post (lungo) | 19-24 min | `pre_post_long_range` |
| Scroll post-post (normale) | 6-14 min | `post_post_normal_range` |
| Scroll post-post (breve) | 1-5 min | `post_post_short_range` |
| Scroll post-post (lungo) | 15-24 min | `post_post_long_range` |
| Probabilità rest day | 84-95% | `rest_day_prob_range` |
| Intervallo 2-day break | 7-15 giorni | `two_day_break_interval_range` |
| Probabilità abort | 5-10% | `abort_prob_range` |
| Durata max abort | 2 min | `abort_max_duration` |
| Probabilità extended (settimanale) | 3-7% | `extended_weekly_prob_range` |
| Durata extended | 25-40 min | `extended_duration_range` |
| Probabilità draft error | 2-5% | `draft_error_prob_range` |
| Probabilità skip post | 1-3% | `skip_post_prob_range` |
| Intervallo cambio personalità | 7-14 giorni | `personality_change_interval_range` |
| Bias durata sessioni | 0.85-1.15x | `session_length_bias_range` |
| Gap tra sessioni (telefoni diversi) | 0-30 min | `inter_session_gap_range` |
| Durata sessione rest-only | 5-25 min | `rest_session_duration_range` |
| Target 2 post al giorno | 75-95% | `two_post_target_range` |

### Proxy
Modifica host, porta, credenziali e URL di rotazione nella sezione `PROXY` di config.py.

### Account
Per aggiungere/rimuovere account o telefoni, modifica le liste `ACCOUNTS` e `PHONES` in config.py.

---

## Numeri Tipici per Settimana (per account)

| Metrica | Valore tipico |
|---------|--------------|
| Post totali | 8-12 |
| Sessioni totali | 9-14 |
| Giorni di riposo | 0-1 |
| Giorni 1-post | 1 |
| Pausa 2 giorni | 1 ogni 7-15 giorni |
| Sessioni abortite | 0-2 |
| Sessioni estese | 0-1 |
| Errori draft | 0-1 |
| Post skippati | 0-1 |
| Durata media sessione | ~15-25 minuti |
