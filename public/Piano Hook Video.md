Obiettivo:  
 Hook video 95–99% indistinguibile da UGC reale su TikTok / IG.

---

# **🎯 PROBLEMA STRUTTURALE ATTUALE**

1. Selfie (Kling Avatar V2) è troppo generico.

2. Candid (Seedance) ha contraddizioni tra fixed e handheld.

3. Motion descrive emozione, non fisica.

4. Nessuna differenza tecnica vera tra selfie e candid.

5. Fallback troppo “AI sounding”.

6. Mancanza di micro instabilità fisica reale.

---

# **🔥 OBIETTIVO V2.0**

Separare completamente:

* SELFIE LIPSYNC (Kling Avatar V2)

* CANDID MOTION (Seedance)

Devono avere logiche fisiche diverse.

---

# **\===============================**

# **🔵 PARTE 1 — KLING\_LIPSYNC (SELFIE)**

# **\===============================**

## **1️⃣ Eliminare fallback attuale**

Rimuovere:

She says it with a realistic sad expression on her face, realistic human expressiveness, handheld camera

È troppo generico e AI-sounding.

---

## **2️⃣ Nuovo fallback selfie (obbligatorio)**

Sostituire con:

She records herself impulsively, slight natural wrist instability, micro vertical movement from breathing, subtle uneven posture, natural facial asymmetry, tiny irregular blink timing, quiet contained emotion, realistic handheld phone recording

Motivo:

* Descrive fisica, non emozione teatrale.

* Introduce instabilità reale.

---

## **3️⃣ Aggiunta fisica obbligatoria in img-to-video.js (SELFIE ONLY)**

Sempre appendere:

very subtle natural wrist instability,  
micro vertical movement from breathing,  
slight natural handheld sway,  
barely noticeable framing shift,  
natural facial asymmetry,  
tiny uneven micro expressions

Non 20%.  
 Sempre.

---

## **4️⃣ Rimuovere qualsiasi parametro camera\_movement fixed per selfie**

Se presente:

camera\_movement: 'fixed'

→ ELIMINARE.

Selfie NON può essere fixed.

---

## **5️⃣ Micro human noise injection (15%)**

In img-to-video.js:

if (isSelfie && Math.random() \< 0.15) {  
 motionPromptFinal \+= ", very subtle momentary framing misalignment before stabilizing";  
}

Questo crea realismo umano spontaneo.

---

# **\===============================**

# **🔴 PARTE 2 — KLING\_MOTION (CANDID / SEEDANCE)**

# **\===============================**

Qui è diverso.

## **1️⃣ Tenere camera fixed**

Per candid sì:

camera\_movement: 'fixed'  
---

## **2️⃣ Rimuovere handheld micro drift 20%**

Attualmente hai:

\+ "extremely subtle natural handheld micro drift"

RIMUOVERLO per candid.

È incoerente con tripod.

---

## **3️⃣ Motion pool ristrutturato**

Attuale problema:  
 Motion descrive emozione.

Nuovo principio:  
 Motion descrive micro fisica.

### **Cold Motion Pool (glaciale, dominante)**

const coldMotionPool \= \[

"...remains completely still for a moment, blinks once slowly, jaw subtly tightens",

"...barely tilts chin forward, breath steady and controlled, minimal movement",

"...micro eyebrow lift, no other visible movement",

"...holds still, slow controlled exhale through nose",

"...slight head tilt, expression unreadable, stillness dominates"  
\];  
---

### **Explosive Motion Pool (contenuta ma reale)**

const explosiveMotionPool \= \[

"...sharp short exhale, jaw tightens briefly",

"...quick blink of disbelief, minimal head shift",

"...subtle head shake once, lips press then relax",

"...eyes widen slightly before narrowing",

"...visible tension in jaw and neck, small breath reset"  
\];  
---

## **4️⃣ Rimuovere teatralità**

Non usare parole:

* dramatic

* intense

* furious

* emotional

Solo micro tensione.

---

# **\===============================**

# **🟡 PARTE 3 — MICRO ASIMMETRIA REALE**

# **\===============================**

Per entrambi i tipi, aggiungere 25% chance:

if (Math.random() \< 0.25) {  
 motionPromptFinal \+= ", slight asymmetrical micro expression, uneven muscle movement";  
}

Questo rompe l’effetto puppet.

---

# **\===============================**

# **🟣 PARTE 4 — OCCHI REALISTICI**

# **\===============================**

Attualmente avete eye focus randomizzato 40%.

Va bene.

Ma modificare:

Non scrivere:  
 "eyes toward camera"

Scrivere:

eyes naturally shifting focus,  
brief micro saccade before settling

Gli umani fanno micro-saccades.  
 Gli AI no.

---

# **\===============================**

# **🟢 PARTE 5 — RIMOZIONE CONTRADDIZIONI**

# **\===============================**

Verificare che NON coesistano:

* camera fixed

* handheld drift

Mai insieme.

---

# **\===============================**

# **🔥 PARTE 6 — STRUTTURA FINALE PROMPT SELFIE**

# **\===============================**

Struttura definitiva Kling lipsync:

\[selectedSubconcept.hook\_prompt OR new selfie fallback\]  
\+ physicalLayerSelfie  
\+ no text / no watermark suffix

Dove physicalLayerSelfie è SEMPRE presente.

---

# **\===============================**

# **📊 RISULTATO ATTESO**

# **\===============================**

PRIMA:  
 UGC realism \~70–80%

DOPO:  
 UGC realism 92–97%

Differenza enorme in:

* credibilità

* retention

* commenti “is this real?”

* shareability

---

# **🧠 REGOLA DEFINITIVA**

Selfie:  
 instabilità fisica SEMPRE.

Candid:  
 stabilità camera \+ micro tensione corporea.

Mai mescolare i due.

