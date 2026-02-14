// NODE: Format Telegram Message
// Builds the Telegram approval message + inline keyboard
// Mode: Run Once for All Items

const { concept, vibe, appStyle, scenarioName } = $('Select Concept').first().json;
const { scenario, copy } = $('Validate Copy').first().json;

const results = scenario.results;

// Toxic Score = inverted health (higher = more toxic)
const toxicScore = 100 - results.overallScore;

// Section name mapping for display
const SECTION_NAMES = {
  toxic_score: 'Toxic Score',
  soul_type: 'His Soul Type',
  wtf_happening: 'WTF Is Happening',
  between_the_lines: 'Between The Lines',
  souls_together: 'Your Souls Together'
};

// Build body clips section for caption
const bodyClipLines = copy.bodyClips.map((clip, i) => {
  const name = SECTION_NAMES[clip.section] || clip.section;
  return '\u{1F3AC} *Clip ' + (i + 1) + ': ' + name + '*\n'
    + '\u{1F4DD} Text: "' + clip.text + '"\n'
    + '\u{1F5E3} VO: "' + clip.vo + '"';
}).join('\n\n');

const caption = '\u{1F3AC} *NEW SCENARIO*\n\n'
  + '\u{1F4CB} *' + concept.concept_name + '*  |  ' + vibe.toUpperCase() + '  |  ' + appStyle + '\n'
  + '\u{1F194} ' + scenarioName + '\n\n'
  + '\u{1F4CA} *Toxic Score:* ' + toxicScore + '/100\n\n'
  + '\u{1F3AD} *Soul Types:*\n'
  + results.personName + ': ' + results.personSoulType + '\n'
  + 'User: ' + results.userSoulType + '\n\n'
  + '\u{1F3F7} *Profile:* ' + results.profileType + ' \u2014 "' + results.profileSubtitle + '"\n\n'
  + '\u26A1 *Dynamic:* ' + results.dynamic.name + '\n\n'
  + '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n'
  + '\u{1F3A4} *HOOK*\n'
  + '\u{1F4DD} Text: "' + copy.hookText + '"\n'
  + '\u{1F5E3} VO: "' + copy.hookVO + '"\n\n'
  + bodyClipLines + '\n\n'
  + '\u{1F3A4} *OUTRO*\n'
  + '\u{1F4DD} Text: "' + copy.outroText + '"\n'
  + '\u{1F5E3} VO: "' + copy.outroVO + '"';

// Inline keyboard for approval
const replyMarkup = {
  inline_keyboard: [
    [
      { text: '\u2705 Approve', callback_data: 'approve_' + scenarioName },
      { text: '\u{1F504} Redo', callback_data: 'redo_' + scenarioName },
      { text: '\u274C Skip', callback_data: 'skip_' + scenarioName }
    ]
  ]
};

// Pass through binary data from Take Screenshot node so Send Photo can access it
return [{
  json: {
    caption,
    replyMarkup,
    scenarioName,
    scenario,
    copy
  },
  binary: $input.first().binary
}];
