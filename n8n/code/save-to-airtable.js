// NODE: Prepare Airtable Save
// Formats the data for saving to the Scenarios table
// Mode: Run Once for All Items

const { concept, vibe, appStyle, scenarioName } = $('Select Concept').first().json;
const { scenario, copy } = $('Validate Copy').first().json;

return [{
  json: {
    scenario_name: scenarioName,
    concept_id: [concept.id],
    vibe: vibe,
    app_style: appStyle,
    scenario_json: JSON.stringify(scenario),
    generated_hook_text: copy.hookText,
    generated_outro_text: copy.outroText,
    generated_vo_script: JSON.stringify(copy.voScript),
    generated_caption_plan: JSON.stringify(copy.captionPlan),
    generated_social_caption: copy.socialCaption,
    status: 'approved'
  }
}];
