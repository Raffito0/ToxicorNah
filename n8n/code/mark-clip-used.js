// NODE: Prepare Clip Mark (conditional gate for marking app store clips as used)
// Checks if an app store clip was used in this production.
// If yes: outputs the record ID for downstream Airtable Update.
// If no: returns empty array (stops this branch — no-op).
// Mode: Run Once for All Items
//
// WIRING: Send Final Video → this Code node → Mark App Store Clip Used (Airtable Update)

const outroData = $('Generate Outro').first().json;
const recordId = outroData.appStoreClipRecordId;

if (!recordId) {
  // No app store clip was used — stop this branch
  return [];
}

return [{
  json: {
    recordId,
    scenarioName: $('Prepare Production').first().json.scenarioName,
  }
}];
