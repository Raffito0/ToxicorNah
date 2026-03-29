'use strict';

/**
 * Visual Engine — unified export for all EarlyInsider visual generation modules.
 *
 * Usage from n8n Code nodes:
 *   const { charts, templates, covers, identity } = require('./visual-engine');
 *   const buffer = await charts.renderBarChart(opts, helpers);
 *   const url = await templates.renderTemplate(1, data, { upload: true }, helpers);
 *   const logoUrl = await identity.getCompanyLogo('nvidia.com', 'NVDA', helpers);
 */
module.exports = {
  charts:    require('./generate-chart'),
  templates: require('./visual-templates'),
  covers:    require('./report-covers'),
  identity:  require('./identity-assets'),
};
