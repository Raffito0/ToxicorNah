diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/edgar-parser.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/edgar-parser.js
index 0a6504d..a24d7f3 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/edgar-parser.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/edgar-parser.js
@@ -442,7 +442,85 @@ function parseForm4Xml(xmlString) {
   }
 }
 
-// ─── Section 3: Classification (placeholder, added in Section 03) ─────────────
+// ─── Section 3: Transaction Classification ────────────────────────────────────
+
+const TRANSACTION_CODE_MAP = {
+  P: 'purchase',
+  S: 'sale',
+  G: 'gift',
+  F: 'tax_withholding',
+  M: 'option_exercise',
+  X: 'option_exercise',
+  A: 'award',
+  D: 'disposition',
+  J: 'other',
+};
+
+/**
+ * @param {{ transactionCode: string }} transaction
+ * @returns {string}
+ */
+function classifyTransaction(transaction) {
+  return TRANSACTION_CODE_MAP[transaction.transactionCode] || 'other';
+}
+
+/**
+ * @param {string|null|undefined} officerTitle
+ * @returns {'CEO'|'CFO'|'President'|'COO'|'Director'|'VP'|'Other'}
+ */
+function classifyInsiderRole(officerTitle) {
+  if (!officerTitle) return 'Other';
+  const t = officerTitle.trim().toLowerCase();
+
+  if (t === 'ceo' || t.includes('chief executive') || t.includes('principal executive')) return 'CEO';
+  if (t === 'cfo' || t.includes('chief financial') || t.includes('principal financial')) return 'CFO';
+  if (t === 'coo' || t.includes('chief operating')) return 'COO';
+  // VP must be checked before President because "Vice President" contains "president"
+  if (
+    t === 'vp' || t === 'svp' || t === 'evp' ||
+    t.includes('vice president')
+  ) return 'VP';
+  if (t === 'president' || t.includes('president')) return 'President';
+  if (
+    t === 'director' ||
+    t === 'board member' ||
+    t === 'board director' ||
+    t.includes('independent director') ||
+    t.includes('non-executive director')
+  ) return 'Director';
+
+  return 'Other';
+}
+
+/**
+ * Whitelist filter: only P (open-market purchase) and S (open-market sale).
+ * @param {Array} transactions
+ * @returns {Array}
+ */
+function filterScorable(transactions) {
+  return transactions.filter((t) => t.transactionCode === 'P' || t.transactionCode === 'S');
+}
+
+/**
+ * Check if a transaction XML block contains a 10b5-1 plan flag.
+ * Handles both legacy (rule10b5One) and modern (rule10b51Transaction) schemas.
+ * @param {string} xmlBlock
+ * @returns {boolean}
+ */
+function calculate10b5Plan(xmlBlock) {
+  const patterns = [
+    /<rule10b5One>[\s\S]*?<value>(.*?)<\/value>/i,
+    /<rule10b51Transaction>[\s\S]*?<value>(.*?)<\/value>/i,
+  ];
+  for (const re of patterns) {
+    const m = xmlBlock.match(re);
+    if (m) {
+      const val = m[1].trim().toLowerCase();
+      if (val === '1' || val === 'true') return true;
+    }
+  }
+  return false;
+}
 
 // ─── Exports ───────────────────────────────────────────────────────────────────
 
@@ -455,6 +533,11 @@ module.exports = {
   buildForm4XmlUrl,
   fetchForm4Xml,
   parseForm4Xml,
+  // Section 3
+  classifyTransaction,
+  classifyInsiderRole,
+  filterScorable,
+  calculate10b5Plan,
   // Test helpers
   _resetFailureCount: () => { failureCount = 0; },
   _getFailureCount: () => failureCount,
