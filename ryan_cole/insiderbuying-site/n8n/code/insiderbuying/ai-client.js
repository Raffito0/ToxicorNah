'use strict';

/**
 * ai-client.js — Provider abstraction for Claude and DeepSeek in n8n Code nodes.
 *
 * Usage:
 *   const { createClaudeClient, createDeepSeekClient } = require('./ai-client');
 *   const client = createClaudeClient($env['ANTHROPIC_API_KEY']);
 *   const { content } = await client.complete(systemPrompt, userPrompt);
 *   const { toolResult } = await client.completeToolUse(sys, user, tools, toolChoice);
 */

class AIClient {
  constructor(fetchFn, config) {
    this._fetchFn = fetchFn;
    this._config = { ...config };
    this._sleep = config._sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async complete(systemPrompt, userPrompt, opts = {}) {
    const body = this._buildBody(systemPrompt, userPrompt, opts);
    return this._call(body, (data) => this._parseTextResponse(data));
  }

  async completeWithCache(systemPrompt, userPrompt, opts = {}) {
    const body = this._buildBody(systemPrompt, userPrompt, opts);
    body.cache_control = { type: 'ephemeral' };
    return this._call(body, (data) => this._parseTextResponse(data));
  }

  async completeToolUse(systemPrompt, userPrompt, tools, toolChoice, opts = {}) {
    if (this._config.provider !== 'claude') {
      throw new Error('Tool use is only supported for the Claude provider');
    }
    const body = this._buildBody(systemPrompt, userPrompt, opts);
    body.tools = tools;
    if (toolChoice != null) body.tool_choice = toolChoice;
    if (opts.cache) body.cache_control = { type: 'ephemeral' };
    return this._call(body, (data) => this._parseToolUseResponse(data));
  }

  // ---------------------------------------------------------------------------
  // Body / headers
  // ---------------------------------------------------------------------------

  _buildBody(systemPrompt, userPrompt, opts = {}) {
    const cfg = this._config;
    const body = {
      model: opts.model || cfg.model,
      max_tokens: opts.max_tokens != null ? opts.max_tokens : (opts.maxTokens != null ? opts.maxTokens : cfg.maxTokens),
      temperature: opts.temperature !== undefined ? opts.temperature : cfg.temperature,
    };

    if (opts.response_format != null) {
      body.response_format = opts.response_format;
    }

    if (cfg.provider === 'claude') {
      if (systemPrompt != null) body.system = systemPrompt;
      body.messages = [{ role: 'user', content: userPrompt }];
    } else {
      const messages = [];
      if (systemPrompt != null) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: userPrompt });
      body.messages = messages;
      body.stream = false;
    }

    return body;
  }

  _buildHeaders() {
    const cfg = this._config;
    if (cfg.provider === 'claude') {
      return {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      };
    }
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    };
  }

  // ---------------------------------------------------------------------------
  // Response parsing
  // ---------------------------------------------------------------------------

  _parseTextResponse(data) {
    const cfg = this._config;
    let text = '';
    let rawUsage = {};

    if (cfg.provider === 'claude') {
      if (data.content && data.content.length > 0) {
        const textBlock = data.content.find((b) => b.type === 'text');
        if (textBlock) text = textBlock.text;
      }
      rawUsage = data.usage || {};
    } else {
      if (data.choices && data.choices.length > 0 && data.choices[0].message) {
        text = data.choices[0].message.content || '';
      }
      rawUsage = data.usage || {};
    }

    const usage = this._normalizeUsage(rawUsage);
    const estimatedCost = this._computeCost(rawUsage);
    this._logCost(usage, estimatedCost);

    return {
      content: text,
      usage,
      cached: (usage.cacheReadTokens || 0) > 0,
      estimatedCost,
    };
  }

  _parseToolUseResponse(data) {
    const rawUsage = data.usage || {};
    const usage = this._normalizeUsage(rawUsage);
    const estimatedCost = this._computeCost(rawUsage);
    this._logCost(usage, estimatedCost);

    if (!data.content || data.content.length === 0) {
      throw new Error('Empty response: no content blocks returned');
    }

    const toolBlock = data.content.find((b) => b.type === 'tool_use');
    if (!toolBlock) {
      const textBlock = data.content.find((b) => b.type === 'text');
      throw new Error(textBlock ? textBlock.text : 'No tool_use block in response');
    }

    return {
      toolResult: toolBlock.input,
      usage,
      estimatedCost,
    };
  }

  // ---------------------------------------------------------------------------
  // Usage / cost
  // ---------------------------------------------------------------------------

  _normalizeUsage(rawUsage) {
    const cfg = this._config;
    if (cfg.provider === 'claude') {
      return {
        inputTokens: rawUsage.input_tokens || 0,
        outputTokens: rawUsage.output_tokens || 0,
        cacheReadTokens: rawUsage.cache_read_input_tokens || 0,
        cacheWriteTokens: rawUsage.cache_creation_input_tokens || 0,
      };
    }
    return {
      inputTokens: rawUsage.prompt_tokens || 0,
      outputTokens: rawUsage.completion_tokens || 0,
      cacheReadTokens: rawUsage.prompt_cache_hit_tokens || 0,
      cacheWriteTokens: 0,
    };
  }

  _computeCost(rawUsage) {
    const cfg = this._config;
    if (cfg.provider === 'claude') {
      const inputTokens = rawUsage.input_tokens || 0;
      const outputTokens = rawUsage.output_tokens || 0;
      const cacheRead = rawUsage.cache_read_input_tokens || 0;
      const cacheWrite = rawUsage.cache_creation_input_tokens || 0;
      return (
        (inputTokens * 3 / 1e6) +
        (outputTokens * 15 / 1e6) +
        (cacheRead * 0.30 / 1e6) +
        (cacheWrite * 3.75 / 1e6)
      );
    }
    const inputTokens = rawUsage.prompt_tokens || 0;
    const outputTokens = rawUsage.completion_tokens || 0;
    return (inputTokens * 0.27 / 1e6) + (outputTokens * 1.10 / 1e6);
  }

  _logCost(usage, estimatedCost) {
    const cfg = this._config;
    const cacheInfo = usage.cacheReadTokens > 0 ? ` cache:${usage.cacheReadTokens}r` : '';
    console.log(
      `[ai-client] ${cfg.provider} ${cfg.model} | in:${usage.inputTokens} out:${usage.outputTokens}${cacheInfo} | $${estimatedCost.toFixed(6)}`
    );
  }

  // ---------------------------------------------------------------------------
  // Retry loop
  // ---------------------------------------------------------------------------

  async _call(body, parseResponse) {
    const cfg = this._config;
    const maxAttempts = cfg.maxRetries + 1;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response;
      try {
        response = await this._fetchFn(cfg.url, {
          method: 'POST',
          headers: this._buildHeaders(),
          body: JSON.stringify(body),
        });
      } catch (networkErr) {
        lastError = networkErr;
        if (attempt < maxAttempts) {
          await this._sleep(this._calcDelay(attempt));
          continue;
        }
        throw networkErr;
      }

      if (response.ok) {
        const data = await response.json();
        return parseResponse(data);
      }

      const status = response.status;

      // Auth / client errors: throw immediately, no retry
      if (status === 400 || status === 401 || status === 402) {
        let errData = {};
        try { errData = await response.json(); } catch (_) { /* ignore */ }
        throw new Error(`HTTP ${status}: ${JSON.stringify(errData)}`);
      }

      // Retryable status
      if (cfg.retryableStatuses.includes(status)) {
        lastError = new Error(`HTTP ${status}`);
        if (attempt < maxAttempts) {
          await this._sleep(this._calcDelay(attempt));
          continue;
        }
        throw lastError;
      }

      // Non-retryable
      let errData = {};
      try { errData = await response.json(); } catch (_) { /* ignore */ }
      throw new Error(`HTTP ${status}: ${JSON.stringify(errData)}`);
    }

    throw lastError || new Error('All retry attempts failed');
  }

  _calcDelay(attempt) {
    const cfg = this._config;
    const base = Math.min(cfg.baseDelay * Math.pow(2, attempt - 1), cfg.maxDelay);
    return base + Math.random() * base;
  }
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

function createClaudeClient(fetchFn, apiKey, extraConfig = {}) {
  return new AIClient(fetchFn, {
    provider: 'claude',
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-6-20250514',
    temperature: 0.7,
    maxTokens: 4096,
    timeout: 30000,
    maxRetries: 2,
    baseDelay: 500,
    maxDelay: 10000,
    retryableStatuses: [429, 529],
    apiKey,
    ...extraConfig,
  });
}

function createDeepSeekClient(fetchFn, apiKey, extraConfig = {}) {
  return new AIClient(fetchFn, {
    provider: 'deepseek',
    url: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat',
    temperature: 0.3,
    maxTokens: 2048,
    timeout: 60000,
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    retryableStatuses: [429, 500, 503],
    apiKey,
    ...extraConfig,
  });
}

module.exports = { AIClient, createClaudeClient, createDeepSeekClient };
