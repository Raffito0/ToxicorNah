diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/data-study.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/data-study.js
index a838279..08dee8a 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/data-study.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/data-study.js
@@ -1,4 +1,7 @@
 'use strict';
+// DISABLED: superseded by the monthly backtest lead magnet (unit 17 A1).
+module.exports.DISABLED = true;
+
 const _https = require('https');
 const _http = require('http');
 const { URL } = require('url');
@@ -307,6 +310,7 @@ function buildStudyRecord(title, analysis, chartsData) {
 }
 
 module.exports = {
+  DISABLED: true,
   STUDY_TOPICS: STUDY_TOPICS,
   selectStudyTopic: selectStudyTopic,
   aggregateData: aggregateData,
