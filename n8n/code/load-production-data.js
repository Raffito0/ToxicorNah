// NODE: Load Production Data
// Parses /produce command and builds Airtable filter for scenario lookup
// /produce → picks next ready scenario (oldest first)
// /produce scenario_name → finds specific scenario
// Mode: Run Once for All Items
//
// WIRING: Route Message (Produce) → this Code node → Find Produce Scenario (Airtable Search)

const input = $input.first().json;
const scenarioName = input.scenarioName || '';
const chatId = input.chatId || '';

if (!scenarioName) {
  // No scenario name → pick next ready scenario
  return [{
    json: {
      scenarioName: '',
      chatId,
      scenarioFilter: '{status} = "ready"',
    }
  }];
}

// Specific scenario
return [{
  json: {
    scenarioName,
    chatId,
    scenarioFilter: 'AND({scenario_name} = "' + scenarioName + '", {status} = "ready")',
  }
}];
