// NODE: Set Produce Context (merge node -- standardizes data from both trigger paths)
// Manual /produce: Telegram Trigger -> Parse Message -> Route Message -> this
// Auto-produce: Webhook -> this
// Downstream nodes reference $('Set Produce Context') instead of $('Parse Message')
//
// WIRING: Route Message (output 3) -> this | Auto Produce Webhook -> this -> Ack Produce

let chatId, scenarioName, timeOfDay, isAuto;

try {
  // Manual /produce path: Parse Message was executed in this run
  const pm = $('Parse Message').first().json;
  chatId = pm.chatId || '';
  scenarioName = pm.scenarioName || '';
  timeOfDay = pm.timeOfDay || 'day';
  isAuto = false;
} catch (e) {
  // Auto-produce path: data comes from webhook body via $input
  const input = $input.first().json;
  // Webhook v2 nests POST body under .body
  chatId = (input.body && input.body.chatId) || input.chatId || '';
  scenarioName = (input.body && input.body.scenarioName) || input.scenarioName || '';
  timeOfDay = (input.body && input.body.timeOfDay) || input.timeOfDay || 'day';
  isAuto = true;
}

return [{ json: { chatId, scenarioName, timeOfDay, isAuto } }];
