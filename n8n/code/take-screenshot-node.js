// NODE: Prepare Screenshot Request
// Prepares the scenario JSON for the screenshot HTTP server
// Mode: Run Once for All Items

const scenarioJson = $('Validate Scenario').first().json.scenario;
const scenarioName = $('Select Concept').first().json.scenarioName;

return [{
  json: {
    scenarioJson,
    scenarioName
  }
}];
