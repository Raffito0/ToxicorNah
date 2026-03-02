# Toxic or Nah - System Logic Documentation

> Ultimo aggiornamento: 2026-01-19
> Questo documento traccia tutta la logica implementata nel sistema.

---

## 1. ARCHITETTURA GENERALE

### Stack Tecnologico
- **Frontend**: React + TypeScript + Vite
- **Styling**: Tailwind CSS + Framer Motion
- **Backend**: Supabase (Database + Storage + Auth)
- **AI**: OpenAI GPT-4o-mini (vision)
- **Hosting**: TBD

### Target Audience
- **Demografica**: Ragazze Gen Z, 15-25 anni
- **Mercato Primario**: USA
- **Use Case**: Analisi chat di situationship/dating

### Flusso Utente
```
1. Upload screenshot chat
2. AI analizza immagine
3. Risultati salvati in Supabase
4. Display results page con card decks
5. Share card su social (viral loop)
```

---

## 1.1 APP STRUCTURE

### Navigazione: 3 Tab Design
```
┌─────────────────────────────────────┐
│                                     │
│           [CONTENT AREA]            │
│                                     │
├─────────────────────────────────────┤
│   📸 Home    │   👥 People   │   👤 Profile   │
└─────────────────────────────────────┘
```

### Tab 1: Home (📸)
**Scopo**: Analisi + Results + Discovery

**Sezioni**:
1. **CTA Principale**: "Analyze a Chat" (upload screenshot)
2. **Hot Receipt Widget**: 1 messaggio virale dalla community (refresh ogni ora)
3. **Recent Analysis**: Ultime 3 analisi dell'utente (quick access)

**Comportamento**:
- Dopo analisi → mostra Results Page inline
- Scroll down → torna a Home con widget

### Tab 2: People (👥)
**Scopo**: Storico persone analizzate con timeline

**Layout**:
```
┌─────────────────────────────────────┐
│ 🔍 Search                           │
├─────────────────────────────────────┤
│ ┌─────┐                             │
│ │ 👤  │ Marco                       │
│ │     │ 3 analyses • Last: 2 days   │
│ │ 🔴🟡 │ The Love Bomber             │
│ └─────┘                             │
├─────────────────────────────────────┤
│ ┌─────┐                             │
│ │ 👤  │ Andrea                      │
│ │     │ 1 analysis • Last: 1 week   │
│ │ 🟢  │ The Green Flag              │
│ └─────┘                             │
└─────────────────────────────────────┘
```

**Person Profile Page**:
- Header: Nome + foto (opzionale) + archetypes badges
- Timeline: Tutte le analisi in ordine cronologico
- Evolution: "Da The Love Bomber a The Ghost" (se cambia)
- Stats: Toxicity trend, pattern ricorrenti

**Database**:
```sql
CREATE TABLE analyzed_persons (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE analysis_person_link (
  analysis_id UUID REFERENCES analyses(id),
  person_id UUID REFERENCES analyzed_persons(id),
  PRIMARY KEY (analysis_id, person_id)
);
```

### Tab 3: Profile (👤)
**Scopo**: Account + Settings + Stats

**Sezioni**:
1. **User Stats**: Totale analisi, archetypes sbloccati
2. **Archetype Badges**: Grid delle carte sbloccate (visualizzazione compatta)
3. **Settings**: Account, notifiche, privacy
4. **Premium**: Upgrade CTA se free user

**Nota**: Gli archetypes qui sono BADGES, non collection standalone.
L'appeal è "quanti ne hai sbloccati" non "colleziona tutti".

---

## 2. AI ANALYSIS SYSTEM

### File: `src/services/openaiService.ts`

### Modello Utilizzato
- **Modello**: `gpt-4o-mini`
- **Costo**: ~$0.0026/analisi
- **Input**: Immagine screenshot chat (base64)

### Identificazione Messaggi
```
REGOLA CRITICA:
- LEFT side (bolle grigie) = Persona analizzata (soggetto dell'analisi)
- RIGHT side (bolle blu/verdi) = Utente che ha caricato la chat

L'AI deve:
1. Analizzare SOLO i messaggi LEFT side per toxicity score
2. MAI includere messaggi RIGHT side nei messageInsights
3. Double-check visivo prima di includere un messaggio
```

### Output Structure
```typescript
interface ChatAnalysisResult {
  scores: AnalysisScores;           // Punteggi 0-100
  profile: ProfileClassification;    // Classificazione generale
  categoryAnalysis: {                // 5 categorie fisse
    redFlagsGreenFlags: CategoryAnalysis;
    powerBalance: CategoryAnalysis;
    intentions: CategoryAnalysis;
    chemistry: CategoryAnalysis;
    investment: CategoryAnalysis;
  };
  messageInsights: MessageInsight[]; // Breakdown messaggi
  personArchetype: ArchetypeMatch;   // Archetype persona analizzata
  userArchetype: ArchetypeMatch;     // Archetype utente
}
```

---

## 3. CARD DECK SYSTEM

### 3.1 First Deck: Emotional Profile Cards (SwipeableCardDeck)

**File**: `src/components/SwipeableCardDeck.tsx`

**Scopo**: Mostrare 5 carte con l'analisi emotiva per categoria

**Categorie Fisse** (in ordine):
1. Red Flags & Green Flags
2. Power Balance
3. Intentions
4. Chemistry
5. Investment

**Layout Carta**:
- Altezza: `480px`
- Larghezza max: `300px`
- Immagine: `52%` altezza
- Border radius: `28px`

**Interazioni**:
- Tap → Flip carta (mostra retro con dettagli)
- Swipe X → Passa alla carta successiva
- Carte sotto hanno rotazione e offset

**Generazione Colori Pills**:
```typescript
// Genera 4 colori dalle gradient della carta
function generatePillColors(gradientStart: string): string[]
// Usa conversione RGB → HSL → variazioni → HEX
```

### 3.2 Second Deck: Message Breakdown Cards (VerticalCardDeck)

**File**: `src/components/MessageInsightCard.tsx`

**Scopo**: Breakdown dei singoli messaggi più significativi

**Layout Carta**:
- Altezza: `180px`
- 50% sinistra: Messaggio in "bolla"
- 50% destra: Tag + Titolo + Descrizione

**Colori per Tag**:
```
RED FLAG/TOXIC:
  - gradientStart: #5C1A1A
  - gradientEnd: #3D1212
  - accentColor: #8B3A3A

GREEN FLAG/CUTE:
  - gradientStart: #1A3D2E
  - gradientEnd: #0D2619
  - accentColor: #2D5C45

SUS:
  - gradientStart: #4A3D1A
  - gradientEnd: #332A12
  - accentColor: #6B5A2E

VIBE CHECK:
  - gradientStart: #1A2F4D
  - gradientEnd: #121F33
  - accentColor: #3A5A7A
```

**Logica Colore Testo**:
```typescript
// Assicura che accentColor sia abbastanza scuro per testo bianco
function ensureDarkEnoughForWhiteText(hexColor: string): string {
  // Calcola luminanza
  // Se > 0.45, scurisce proporzionalmente
  // Testo nella bolla è SEMPRE bianco
}
```

**Interazioni**:
- Tap → Flip carta (mostra soluzione)
- Swipe Y → Passa alla carta successiva

---

## 4. MESSAGE INSIGHTS SELECTION LOGIC

### File: `src/services/openaiService.ts` (sezione messageInsights)

### Criteri di Selezione (DA IMPLEMENTARE)

```
PRIORITÀ SELEZIONE MESSAGGI:

1. "THE SMOKING GUN" (1 carta obbligatoria)
   - Il messaggio più incriminante/rivelatore
   - Massimo shock value
   - Quello che fa dire "I KNEW IT"

2. "THE PATTERN" (2-3 carte)
   - Messaggi che mostrano pattern ricorrenti
   - Crea la narrativa "ecco cosa fa sempre"
   - Evidenzia comportamenti ripetuti

3. "THE CONTRAST" (1 carta opzionale)
   - Se presente, un messaggio che contrasta
   - Es: momento carino seguito da tossico
   - Mostra la manipolazione

REGOLE:
- LIMITE: 4-6 messaggi MAX
- MAI includere: "ok", "lol", "hey", messaggi generici
- SOLO messaggi da LEFT side (persona analizzata)
- Priorità a messaggi che creano "OMG moments"
```

### Rarity System (DA IMPLEMENTARE)
```
🟢 GREEN FLAG - Common (messaggi carini)
🟡 SUS - Uncommon (ambigui)
🔴 RED FLAG - Rare (problematici)
⚫ TOXIC - Epic (molto gravi)
💀 EXTREME - Legendary (estremi)
```

---

## 5. ARCHETYPE SYSTEM

### Database: `archetypes` table

### Struttura
```sql
CREATE TABLE archetypes (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,              -- "The Love Bomber"
  category TEXT NOT NULL,          -- "Red Flags & Green Flags"
  image_url TEXT NOT NULL,         -- URL immagine Supabase Storage
  gradient_start TEXT NOT NULL,    -- "#1B3D00"
  gradient_end TEXT NOT NULL,      -- "#0A1F00"
  semantic_tags TEXT[] NOT NULL,   -- ["love_bombing", "hot_cold"]
  severity_range INT[] NOT NULL,   -- [7, 10]
  description_template TEXT,       -- Template con {placeholders}
  traits_pool TEXT[] NOT NULL,     -- Pool di traits selezionabili
  rarity TEXT DEFAULT 'common'     -- common/rare/epic
);
```

### Categorie e Archetypes

**Red Flags & Green Flags** (5 archetypes):
- The Love Bomber (rare) - severity 7-10
- The Gaslighter (epic) - severity 8-10
- The Breadcrumber (common) - severity 6-9
- The Green Flag (rare) - severity 1-3
- The Respectful (common) - severity 1-4

**Power Balance** (5 archetypes):
- The Chaser (common) - severity 6-10
- The Pursued (rare) - severity 1-4
- The Power Player (epic) - severity 7-10
- The Balanced (common) - severity 1-3
- The Hot-Cold Player (rare) - severity 6-9

**Intentions** (5 archetypes):
- The Relationship Seeker (rare) - severity 1-3
- The Ego Booster (common) - severity 7-10
- The Time Passer (common) - severity 5-8
- The Hookup Hunter (rare) - severity 6-9
- The Confused (common) - severity 4-7

**Chemistry** (5 archetypes):
- The Electric Connection (rare) - severity 8-10
- The Flatline (common) - severity 1-3
- The One-Sided Spark (common) - severity 5-8
- The Slow Burn (rare) - severity 4-7
- The Forced Connection (common) - severity 3-6

**Investment** (5 archetypes):
- The High Effort (rare) - severity 8-10
- The Bare Minimum (common) - severity 7-10
- The Inconsistent (common) - severity 5-8
- The Matcher (rare) - severity 4-7
- The Ghost (epic) - severity 8-10

### Semantic Matching Algorithm

**File**: `src/services/archetypeMatchingService.ts`

```typescript
function selectBestArchetype(category, analysis) {
  // 1. Fetch archetypes della categoria
  // 2. Score ogni archetype:
  //    - 60% weight: semantic tags overlap
  //    - 30% weight: severity range match
  //    - 10% weight: rarity boost
  // 3. Return archetype con score più alto + confidence
}
```

---

## 6. PERSONALIZZAZIONE AI

### Description Requirements
```
- 2-3 frasi CORTE (35-50 parole MAX)
- Tono Gen Z (casual, relatable, brutally honest)
- SPECIFICO per questa chat
- Crea "OMG this is SO him" moments
```

### Traits Requirements
```
- Esattamente 4 traits per categoria
- 1-2 parole max per trait
- MATCH con l'analisi (se negativo → traits negativi)
- Specifici per la chat analizzata
```

---

## 7. UI/UX PATTERNS

### Colori Base
- Background: `#000000` (nero)
- Testo primario: `#FFFFFF`
- Testo secondario: `rgba(255, 255, 255, 0.55)`
- Accent: Varia per categoria/sentiment

### Font
- Font Family: `DM Sans, sans-serif`
- Titoli: 700 weight
- Body: 400 weight

### Animazioni
- Card flip: 0.5s ease con keyframes
- Card stack: spring physics (stiffness: 300, damping: 30)
- Swipe threshold: 100px o velocity 500

---

## 7.1 THE DYNAMIC CARD (Third Deck - Finale Section)

### Scopo
Sezione finale della Results Page che mostra la **dinamica relazionale** tra la persona analizzata e l'utente. È il "grand finale" emotivo che:
1. Dà un nome alla dinamica ("Toxic Magnet")
2. Spiega PERCHÉ succede (insight psicologico)
3. Fornisce un'azione concreta per rompere il pattern

### Posizionamento Neuroscientifico
- **Peak-End Rule**: Ultima sezione = massimo impatto sulla memoria
- **Dual Coding Theory**: Nome + sottotitolo = due ancore cognitive
- **Emotional Priming**: Sottotitolo prepara emotivamente prima del flip
- **Agency Restoration**: Pattern Break dà potere all'utente

### Layout Carta

**FRONTE**:
```
┌─────────────────────────────────────┐
│                                     │
│         "Toxic Magnet"              │
│    The chase that never ends        │
│                                     │
│   He is...        You are...        │
│   ┌─────┐         ┌─────┐           │
│   │ IMG │         │ IMG │           │
│   └─────┘         └─────┘           │
│   The Dawn        The Ice           │
│   Listener        Charmer           │
│                                     │
│       👆 Tap to break free          │
│                                     │
└─────────────────────────────────────┘
```

**RETRO** (dopo flip):
```
┌─────────────────────────────────────┐
│                                     │
│            (!) icon                 │
│       Why This Happens              │
│                                     │
│   You're his perfect target. He     │
│   love bombs because you accept     │
│   crumbs as meals. Not your fault.  │
│   But now you see it.               │
│                                     │
│   ─────────────────────────         │
│                                     │
│            (🔓) icon                │
│         Pattern Break               │
│                                     │
│   Stop responding within 5 min.     │
│   Make him wait. Watch his          │
│   behavior change.                  │
│                                     │
└─────────────────────────────────────┘
```

### Struttura Dati AI

**File**: `src/services/openaiService.ts`

```typescript
interface RelationshipDynamic {
  name: string;      // "Toxic Magnet", "The Endless Chase"
  subtitle: string;  // "The chase that never ends"
  whyThisHappens: string;  // 2-3 sentences
  patternBreak: string;    // 1-2 sentences, actionable
}
```

**Prompt AI Requirements**:
```
relationshipDynamic:
  - name: Creative Gen Z name (2-4 words)
    Examples: "Toxic Magnet", "Situationship Limbo", "Love Bombing Cycle"

  - subtitle: Emotional hook (4-7 words)
    Examples: "The chase that never ends", "Almost something, never quite"

  - whyThisHappens: 2-3 sentences explaining WHY
    - Reference BOTH archetypes (person + user)
    - Gen Z tone
    - Creates "OMG that's exactly it" moment

  - patternBreak: 1-2 sentences SPECIFIC action
    - Must be concrete, not generic
    - Actionable immediately
    - Empowering, not judgmental
```

### Interazioni

- **Tap** → Flip carta (mostra retro)
- **No swipe** → È una carta singola, non un deck

### Animazioni

```typescript
// Flip animation
animate={{
  rotateY: isFlipped ? 180 : 0,
}}
transition={{
  duration: 0.5,
  ease: [0.4, 0, 0.2, 1],
}}
```

### File Componente

**File**: `src/components/DynamicCard.tsx`

```typescript
interface DynamicCardProps {
  analysisId: string;
}

// Contenuto da caricare:
// - relationshipDynamic (name, subtitle, whyThisHappens, patternBreak)
// - personArchetype (name, title, imageUrl)
// - userArchetype (name, title, imageUrl)
```

### Database Storage

I dati vengono salvati in `analysis_results.ai_raw_response` (già esistente) e recuperati tramite `getAnalysisResult()`.

Campi aggiunti a `StoredAnalysisResult`:
```typescript
relationshipDynamic: {
  name: string;
  subtitle: string;
  whyThisHappens: string;
  patternBreak: string;
};
```

### Design Decisions

1. **Sottotitolo sotto il nome**: Aggiunge layer emotivo senza spoilerare il retro
2. **CTA "Tap to break free"**: Più engaging di "Tap to reveal", action-oriented
3. **Icone sul retro**: (!) per Why This Happens, lucchetto aperto per Pattern Break
4. **Gradient**: Usa gradient basato su toxicity score (coerente con altre sezioni)

---

## 8. RECEIPT WALL STRATEGY

### Decisione: Receipt Wall come "Spice", NON come Tab

**Rationale**:
- Contenuto testuale non genera engagement tipo TikTok
- Un tab dedicato è "dead space" che utenti non visiterebbero
- Meglio usarlo come elemento di scoperta/social proof

### Implementazione: Hot Receipt Widget

**Posizione**: Home tab, sotto CTA principale

**Layout**:
```
┌─────────────────────────────────────┐
│ 🔥 HOT RECEIPT                      │
├─────────────────────────────────────┤
│ "I'll text you later babe"          │
│                                     │
│ Translation: Later = Never          │
│                                     │
│ 🔴 RED FLAG  •  2.3K 👀  •  1h ago  │
└─────────────────────────────────────┘
```

**Logica**:
- Mostra 1 messaggio con alto engagement
- Refresh ogni ora
- Anonimizzato (no username, no context)
- Tap → mostra "translation" o AI insight

### Push Notifications (Future)
```
"🔥 1,247 people analyzed this EXACT message today"
"😱 New toxic pattern trending: 'I'm not ready for a relationship'"
```

---

## 9. SHARE CARD SYSTEM

### Scopo: Viral Loop via Instagram/TikTok Stories

**Meccanismo**:
```
User analizza chat → Vede risultati → Tap "Share"
     ↓
Genera immagine 1080x1920 (Stories format)
     ↓
Share su IG/TikTok con deep link
     ↓
Friend vede → Tap → Apre app → Analizza sua chat
     ↓
REPEAT (viral snowball)
```

### Deep Links

**iOS**: Universal Links
```
apple-app-site-association file su toxicornah.com
Link format: https://toxicornah.com/share/[card-id]
```

**Android**: App Links
```
assetlinks.json su toxicornah.com
Link format: https://toxicornah.com/share/[card-id]
```

**Fallback**: Se app non installata → App Store/Play Store

### Share Card Variants

#### Variant 1: Profile Card (Main)
```
┌─────────────────────────────────────┐
│                                     │
│         [ARCHETYPE IMAGE]           │
│                                     │
│         "The Love Bomber"           │
│                                     │
│    ████████████░░░░  78% TOXIC      │
│                                     │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │
│  │Manip│ │Hot  │ │Bread│ │Ghost│   │
│  │     │ │Cold │ │crumb│ │     │   │
│  └─────┘ └─────┘ └─────┘ └─────┘   │
│                                     │
│      Analyze YOUR chat →            │
│      toxicornah.com                 │
│                                     │
│         [APP LOGO]                  │
└─────────────────────────────────────┘
```

#### Variant 2: Receipt Card
```
┌─────────────────────────────────────┐
│                                     │
│  ┌───────────────────────────────┐  │
│  │ "I'm just really busy rn"    │  │
│  └───────────────────────────────┘  │
│                                     │
│           TRANSLATION:              │
│    "You're not a priority"          │
│                                     │
│         🔴 RED FLAG                 │
│                                     │
│      What does YOUR chat say?       │
│      toxicornah.com                 │
│                                     │
│         [APP LOGO]                  │
└─────────────────────────────────────┘
```

#### Variant 3: Score Card
```
┌─────────────────────────────────────┐
│                                     │
│         HIS TOXICITY SCORE          │
│                                     │
│              78%                    │
│         ████████████░░░░            │
│                                     │
│    🔴 12 Red Flags                  │
│    🟢 2 Green Flags                 │
│    🟡 5 Sus Moments                 │
│                                     │
│         VERDICT: RUN 🏃‍♀️            │
│                                     │
│      Check YOUR situationship →     │
│         [APP LOGO]                  │
└─────────────────────────────────────┘
```

### Technical Implementation

**File**: `src/components/ShareCardGenerator.tsx`

```typescript
interface ShareCardProps {
  variant: 'profile' | 'receipt' | 'score';
  data: {
    archetypeName?: string;
    archetypeImage?: string;
    toxicityScore?: number;
    traits?: string[];
    message?: string;
    translation?: string;
    redFlagCount?: number;
    greenFlagCount?: number;
    gradient: { start: string; end: string };
  };
}

async function generateShareCard(props: ShareCardProps): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d')!;

  // 1. Draw gradient background
  const gradient = ctx.createLinearGradient(0, 0, 0, 1920);
  gradient.addColorStop(0, props.data.gradient.start);
  gradient.addColorStop(1, props.data.gradient.end);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1920);

  // 2. Draw archetype image (if profile variant)
  // 3. Draw text content
  // 4. Draw branding footer

  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob!), 'image/png');
  });
}

async function shareToSocial(blob: Blob, platform: 'instagram' | 'tiktok') {
  const file = new File([blob], 'toxic-or-nah.png', { type: 'image/png' });

  if (navigator.share && navigator.canShare({ files: [file] })) {
    await navigator.share({
      files: [file],
      title: 'My Toxic or Nah Results',
      url: 'https://toxicornah.com'
    });
  } else {
    // Fallback: download image
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'toxic-or-nah.png';
    a.click();
  }
}
```

### Share Button Placement
1. **Results Page**: Sticky footer "Share Results"
2. **Person Profile**: "Share [Name]'s Profile"
3. **Individual Receipt Card**: Tap-hold → "Share this receipt"

---

## 10. MONETIZATION HOOKS (PIANIFICATO)

### Free Tier
- 3 analisi gratuite al mese
- Vedi tutti i risultati ma share card ha watermark
- Emotional profiles completi

### Premium ($4.99/mese)
- Analisi illimitate
- Share card senza watermark
- "Deep Dive" - spiegazione dettagliata
- "Pattern Analysis" - frequenza comportamenti
- "Response Coach" - come rispondere
- Push notifications personalizzate
- Early access nuovi archetypes

### Business Forecast (USA Market)

**Assumptions**:
- Prezzo: $4.99/month
- Target: Ragazze 15-25 USA (~25M addressable)
- Marketing: Organic viral + paid acquisition

**Year 1 Conservative**:
```
Downloads: 500K
Free users: 450K (90%)
Trials: 50K (10%)
Conversions: 15K (30% of trials)
MRR: $75K
ARR: $900K
```

**Year 1 Optimistic**:
```
Downloads: 1.5M
Free users: 1.2M (80%)
Trials: 300K (20%)
Conversions: 70K (23% of trials)
MRR: $350K
ARR: $4.2M
```

**Key Metrics to Track**:
- Viral coefficient (K-factor)
- Share-to-download ratio
- Trial-to-paid conversion
- Monthly churn rate

---

## 11. ARCHETYPE STRATEGY

### Decisione: Archetypes come Enhancement, NON Collection

**Analisi Neuroscientifica**:
- **Picture Superiority Effect**: Immagini ricordate 6x meglio del testo
- **Emotional Anchoring**: Volto/personaggio crea connessione emotiva
- **Anthropomorphization**: "He's LITERALLY The Love Bomber" → sharing trigger

**Dove Funzionano** (9/10):
1. **Results Page**: Prima impressione, massimo impatto
2. **Person Profile**: Badge sull'header della persona
3. **Share Card**: Visual hook per viralità

**Dove NON Funzionano** (3/10):
- **Collection Tab Standalone**: Nessun valore emotivo, vanity feature
- **Gamification Pura**: Target non è "gamer", non vuole grindare

### Implementazione Corretta

**Profile Badge System**:
```
┌─────────────────────────────────────┐
│ Marco                               │
│ ┌────┐ ┌────┐ ┌────┐               │
│ │ 🔴 │ │ 🟡 │ │ ⚫ │               │
│ │Love│ │Hot │ │Ghst│               │
│ │Bomb│ │Cold│ │    │               │
│ └────┘ └────┘ └────┘               │
│ 3 archetypes over 5 analyses        │
└─────────────────────────────────────┘
```

**Evolution Tracking**:
- Prima analisi: "The Charmer"
- Seconda analisi: "The Hot-Cold Player"
- Terza analisi: "The Ghost"
- Display: "Evolution: Charmer → Hot-Cold → Ghost 📉"

### Archetype Unlock Counter (Light Gamification)

**Nel Profile Tab**:
```
Your Archetype Encyclopedia
┌─────────────────────────────────────┐
│ 12/75 Archetypes Discovered         │
│ ████████░░░░░░░░░░░░░░░░░░  16%     │
│                                     │
│ Recent: The Love Bomber (rare!)     │
└─────────────────────────────────────┘
```

**Nota**: Questo è "nice to have", non core feature.
Il valore principale resta nelle analisi, non nel collezionare.

---

## 12. CHANGELOG

### 2026-01-21 (Session 3)
- [x] Progettata sezione "The Dynamic" (third deck finale)
- [x] Definita struttura RelationshipDynamic con name, subtitle, whyThisHappens, patternBreak
- [x] Analisi neuroscientifica: Peak-End Rule, Dual Coding, Agency Restoration
- [x] Deciso sottotitolo emotivo sotto il nome della dinamica
- [x] CTA cambiato in "Tap to break free" (action-oriented)
- [x] Documentato layout fronte/retro della carta
- [ ] Implementare DynamicCard.tsx

### 2026-01-19 (Session 2)
- [x] Definita App Structure a 3 tab: Home, People, Profile
- [x] Deciso Receipt Wall come "spice" (Hot Receipt Widget) non tab dedicato
- [x] Progettato People tab con timeline persone analizzate
- [x] Definito Share Card System con 3 varianti
- [x] Analizzato validità neuroscientifica archetype cards
- [x] Creato business forecast USA market
- [x] Documentato deep link strategy per viralità
- [x] Aggiornato SYSTEM_LOGIC.md con tutte le decisioni

### 2026-01-19 (Session 1)
- [x] Implementata logica `ensureDarkEnoughForWhiteText` per leggibilità testo
- [x] Aggiornato prompt AI per non includere messaggi utente (RIGHT side)
- [x] Definita logica selezione messaggi (Smoking Gun + Pattern + Contrast)
- [x] Creato questo documento
- [x] Implementata logica selezione messaggi nel prompt AI (4-6 messaggi con priorità)

### TODO Priorità Alta
- [ ] Implementare ShareCardGenerator.tsx
- [ ] Creare People tab con timeline
- [ ] Setup deep links (Universal Links + App Links)
- [ ] Implementare Hot Receipt Widget
- [ ] Aggiungere share button a Results Page

### TODO Priorità Media
- [ ] Aggiungere rarity system ai message insights
- [ ] Implementare Person Profile page con evolution tracking
- [ ] Creare archetype badge grid nel Profile tab
- [ ] Setup analytics (viral coefficient, K-factor)

### TODO Priorità Bassa
- [ ] Implementare paywall premium
- [ ] Push notifications per trending receipts
- [ ] Archetype unlock counter (gamification light)

---

## 13. FILE CRITICI

### Esistenti
| File | Responsabilità |
|------|----------------|
| `src/services/openaiService.ts` | Prompt AI e parsing risposta |
| `src/services/analysisService.ts` | Salvataggio in DB e retrieval |
| `src/services/archetypeMatchingService.ts` | Matching semantico archetypes |
| `src/components/SwipeableCardDeck.tsx` | First deck (Emotional Profiles) |
| `src/components/MessageInsightCard.tsx` | Second deck cards (Message Breakdown) |
| `src/components/VerticalCardDeck.tsx` | Second deck container |
| `src/components/DynamicCard.tsx` | Third deck (The Dynamic - finale) |
| `src/components/ResultsPage.tsx` | Pagina risultati principale |
| `supabase/seed_archetypes.sql` | Seed database archetypes |

### Da Creare
| File | Responsabilità |
|------|----------------|
| `src/components/ShareCardGenerator.tsx` | Generazione share card canvas-based |
| `src/components/PeopleTab.tsx` | Tab persone analizzate |
| `src/components/PersonProfile.tsx` | Profilo singola persona con timeline |
| `src/components/HotReceiptWidget.tsx` | Widget hot receipt per Home |
| `src/components/ArchetypeBadge.tsx` | Badge archetype per profili |
| `src/services/shareService.ts` | Logica sharing + deep links |
| `src/services/personService.ts` | CRUD persone analizzate |

### Database Migrations
| File | Responsabilità |
|------|----------------|
| `supabase/migrations/XXX_create_analyzed_persons.sql` | Tabella persone |
| `supabase/migrations/XXX_create_hot_receipts.sql` | Tabella receipts virali |

---

## 14. QUICK REFERENCE

### Dimensioni Share Card
- **Stories**: 1080 x 1920 px
- **Post Square**: 1080 x 1080 px
- **Post Landscape**: 1200 x 630 px (OG image)

### Colori Principali
```css
--bg-primary: #000000;
--text-primary: #FFFFFF;
--text-secondary: rgba(255, 255, 255, 0.55);
--red-flag: #5C1A1A;
--green-flag: #1A3D2E;
--sus: #4A3D1A;
```

### API Endpoints (Pianificati)
```
GET  /api/hot-receipt          → Receipt virale del momento
POST /api/share/generate       → Genera share card
GET  /api/persons              → Lista persone utente
POST /api/persons              → Crea persona
GET  /api/persons/:id/timeline → Timeline analisi persona
```

---

*Questo documento viene aggiornato ad ogni modifica significativa del sistema.*
