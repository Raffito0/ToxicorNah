// W14 SEO Monitoring -- Google Search Console tracking and alerts
// n8n Code Node (CommonJS)

var POSITION_CHANGE_THRESHOLD = 5;

/**
 * Build Google Search Console searchAnalytics.query request body.
 * @param {string} siteUrl - e.g. 'https://insiderbuying.ai'
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {object} GSC API request body
 */
function buildGSCRequest(siteUrl, startDate, endDate) {
  return {
    startDate: startDate,
    endDate: endDate,
    dimensions: ['query', 'page'],
    rowLimit: 1000,
    startRow: 0,
    dataState: 'final',
  };
}

/**
 * Parse GSC API response into normalized ranking rows.
 * @param {object} data - GSC searchAnalytics.query response
 * @returns {{ query: string, page: string, position: number, clicks: number, impressions: number, ctr: number }[]}
 */
function parseGSCResponse(data) {
  if (!data || !data.rows) return [];

  return data.rows.map(function (row) {
    var keys = row.keys || [];
    return {
      query: keys[0] || '',
      page: keys[1] || '',
      position: Math.round((row.position || 0) * 10) / 10,
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: Math.round((row.ctr || 0) * 10000) / 10000,
    };
  });
}

/**
 * Compare two ranking snapshots and detect meaningful changes.
 * @param {object[]} current - current rankings
 * @param {object[]} previous - previous rankings
 * @returns {{ improvements: object[], drops: object[], newRankings: object[], top10Entries: object[] }}
 */
function detectChanges(current, previous) {
  // Index previous by query+page
  var prevMap = {};
  (previous || []).forEach(function (r) {
    var key = (r.query || '') + '||' + (r.page || '');
    prevMap[key] = r;
  });

  var improvements = [];
  var drops = [];
  var newRankings = [];
  var top10Entries = [];

  (current || []).forEach(function (cur) {
    var key = (cur.query || '') + '||' + (cur.page || '');
    var prev = prevMap[key];

    if (!prev) {
      newRankings.push({
        query: cur.query,
        page: cur.page,
        position: cur.position,
        clicks: cur.clicks,
      });

      if (cur.position <= 10) {
        top10Entries.push({
          query: cur.query,
          page: cur.page,
          position: cur.position,
          previousPosition: null,
          clicks: cur.clicks,
        });
      }
      return;
    }

    var diff = prev.position - cur.position; // positive = improved (lower position number)

    if (diff >= POSITION_CHANGE_THRESHOLD) {
      improvements.push({
        query: cur.query,
        page: cur.page,
        position: cur.position,
        previousPosition: prev.position,
        change: diff,
        clicks: cur.clicks,
      });
    } else if (diff <= -POSITION_CHANGE_THRESHOLD) {
      drops.push({
        query: cur.query,
        page: cur.page,
        position: cur.position,
        previousPosition: prev.position,
        change: diff,
        clicks: cur.clicks,
      });
    }

    // Entered top 10 (was > 10, now <= 10)
    if (cur.position <= 10 && prev.position > 10) {
      top10Entries.push({
        query: cur.query,
        page: cur.page,
        position: cur.position,
        previousPosition: prev.position,
        clicks: cur.clicks,
      });
    }
  });

  return {
    improvements: improvements,
    drops: drops,
    newRankings: newRankings,
    top10Entries: top10Entries,
  };
}

/**
 * Format ranking changes into a Telegram alert message.
 * @param {object} changes - output from detectChanges()
 * @returns {string}
 */
function buildAlertMessage(changes) {
  var lines = ['SEO Ranking Alert - InsiderBuying.ai', ''];

  if (changes.top10Entries.length > 0) {
    lines.push('-- TOP 10 ENTRIES --');
    changes.top10Entries.forEach(function (e) {
      var from = e.previousPosition ? ' (was #' + e.previousPosition + ')' : ' (NEW)';
      lines.push('[+] "' + e.query + '" -> #' + e.position + from);
    });
    lines.push('');
  }

  if (changes.improvements.length > 0) {
    lines.push('-- IMPROVEMENTS --');
    changes.improvements.forEach(function (e) {
      lines.push(
        '[+] "' + e.query + '" #' + e.previousPosition + ' -> #' + e.position +
        ' (+' + e.change + ')'
      );
    });
    lines.push('');
  }

  if (changes.drops.length > 0) {
    lines.push('-- DROPS --');
    changes.drops.forEach(function (e) {
      lines.push(
        '[-] "' + e.query + '" #' + e.previousPosition + ' -> #' + e.position +
        ' (' + e.change + ')'
      );
    });
    lines.push('');
  }

  if (changes.newRankings.length > 0) {
    lines.push('-- NEW RANKINGS --');
    changes.newRankings.slice(0, 10).forEach(function (e) {
      lines.push('[*] "' + e.query + '" at #' + e.position);
    });
    if (changes.newRankings.length > 10) {
      lines.push('... and ' + (changes.newRankings.length - 10) + ' more');
    }
    lines.push('');
  }

  var total =
    changes.improvements.length +
    changes.drops.length +
    changes.newRankings.length +
    changes.top10Entries.length;

  if (total === 0) {
    lines.push('No significant ranking changes detected.');
  }

  return lines.join('\n');
}

/**
 * Build weekly SEO summary text.
 * @param {object[]} rankings - current ranking data
 * @returns {string}
 */
function buildWeeklySummary(rankings) {
  if (!rankings || rankings.length === 0) {
    return 'Weekly SEO Summary: No ranking data available.';
  }

  // Total clicks
  var totalClicks = 0;
  rankings.forEach(function (r) {
    totalClicks += r.clicks || 0;
  });

  // Top 10 by clicks
  var sorted = rankings.slice().sort(function (a, b) {
    return (b.clicks || 0) - (a.clicks || 0);
  });
  var top10 = sorted.slice(0, 10);

  // Biggest movers (lowest position number = best)
  var bestPositions = rankings.slice().sort(function (a, b) {
    return (a.position || 999) - (b.position || 999);
  });

  // Opportunity keywords (positions 11-20)
  var opportunities = rankings.filter(function (r) {
    return r.position > 10 && r.position <= 20;
  });
  opportunities.sort(function (a, b) {
    return (a.position || 999) - (b.position || 999);
  });

  var lines = [
    'Weekly SEO Summary - InsiderBuying.ai',
    '=====================================',
    '',
    'Total Clicks: ' + totalClicks,
    'Tracked Keywords: ' + rankings.length,
    '',
    '-- TOP 10 KEYWORDS BY CLICKS --',
  ];

  top10.forEach(function (r, i) {
    lines.push(
      (i + 1) + '. "' + r.query + '" - ' + r.clicks + ' clicks (pos #' + r.position + ')'
    );
  });

  lines.push('');
  lines.push('-- BEST POSITIONS --');
  bestPositions.slice(0, 5).forEach(function (r) {
    lines.push('"' + r.query + '" at #' + r.position);
  });

  if (opportunities.length > 0) {
    lines.push('');
    lines.push('-- OPPORTUNITY KEYWORDS (positions 11-20) --');
    opportunities.slice(0, 10).forEach(function (r) {
      lines.push(
        '"' + r.query + '" at #' + r.position +
        ' (' + r.impressions + ' impressions, ' + r.clicks + ' clicks)'
      );
    });
  }

  return lines.join('\n');
}

/**
 * Build a NocoDB SEO_Rankings record.
 * @param {string} query
 * @param {string} page
 * @param {number} position
 * @param {number} clicks
 * @param {number} impressions
 * @param {number} ctr
 * @returns {object} record ready for NocoDB insert
 */
function buildRankingRecord(query, page, position, clicks, impressions, ctr) {
  return {
    query: query,
    page: page,
    position: position,
    clicks: clicks,
    impressions: impressions,
    ctr: ctr,
    recorded_at: new Date().toISOString(),
  };
}

module.exports = {
  buildGSCRequest: buildGSCRequest,
  parseGSCResponse: parseGSCResponse,
  detectChanges: detectChanges,
  buildAlertMessage: buildAlertMessage,
  buildWeeklySummary: buildWeeklySummary,
  buildRankingRecord: buildRankingRecord,
};
