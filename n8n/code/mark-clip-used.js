// NODE: Prepare Clip Mark (conditional gate for marking app store clips as used)
// Checks if an app store clip was used in this production.
// If yes: outputs the record ID for downstream Airtable Update.
// If no: returns empty array (stops this branch â€” no-op).
// Mode: Run Once for All Items
//
// WIRING: Send Final Video â†’ this Code node â†’ Mark App Store Clip Used (Airtable Update)

const outroData = $('Generate Outro').first().json;
const recordId = outroData.appStoreClipRecordId;

if (!recordId) {
  // No app store clip was used â€” stop this branch
  return [];
}

return [{
  json: {
    recordId,
    scenarioName: $('Prepare Production').first().json.scenarioName,
  }
}];
