'use strict';
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = __dirname;

function loadTemplate(type) {
  const filePath = path.join(TEMPLATES_DIR, `${type}.html`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Template not found: ${type}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function populateTemplate(html, data) {
  let result = html;
  for (const [key, value] of Object.entries(data)) {
    const placeholder = `{{${key}}}`;
    result = result.split(placeholder).join(value != null ? String(value) : '');
  }
  return result;
}

module.exports = { loadTemplate, populateTemplate };
