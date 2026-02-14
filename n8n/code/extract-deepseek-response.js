// NODE: Extract DeepSeek Response [DEPRECATED]
// This file is no longer needed. The workflow now uses n8n's Basic LLM Chain
// node with Google Gemini, which automatically extracts the response text.
// The LLM Chain outputs { text: "..." } directly.
//
// Kept for reference only. Not used in the current workflow.

const response = $input.first().json;

// DeepSeek API returns: { choices: [{ message: { content: "..." } }] }
const text = response.choices
  && response.choices[0]
  && response.choices[0].message
  && response.choices[0].message.content;

if (!text) {
  throw new Error('No content in response: ' + JSON.stringify(response).substring(0, 500));
}

return [{
  json: { text }
}];
