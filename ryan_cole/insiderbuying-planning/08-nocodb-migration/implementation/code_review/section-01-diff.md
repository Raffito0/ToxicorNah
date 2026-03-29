diff --git a/insiderbuying-site/n8n/code/insiderbuying/nocodb-client.js b/insiderbuying-site/n8n/code/insiderbuying/nocodb-client.js
new file mode 100644
index 0000000..c6a47db
--- /dev/null
+++ b/insiderbuying-site/n8n/code/insiderbuying/nocodb-client.js
@@ -0,0 +1,222 @@
+'use strict';
+
+/**
+ * NocoDB REST client — shared helper for all migrated workflow files.
+ *
+ * Caller pattern (inside n8n Code node):
+ *   const nocodb = new NocoDB(env.NOCODB_BASE_URL, env.NOCODB_API_TOKEN,
+ *                             env.NOCODB_PROJECT_ID, (url, opts) => fetch(url, opts));
+ */
+class NocoDB {
+  /**
+   * @param {string} baseUrl     e.g. "http://localhost:8080"
+   * @param {string} token       NocoDB API token (xc-token)
+   * @param {string} projectId   NocoDB project/base ID
+   * @param {Function} fetchFn   fetch-compatible function (url, opts) => Promise<Response>
+   */
+  constructor(baseUrl, token, projectId, fetchFn) {
+    this.baseUrl = baseUrl;
+    this.token = token;
+    this.projectId = projectId;
+    this.fetchFn = fetchFn;
+  }
+
+  // ---------------------------------------------------------------------------
+  // Private helper
+  // ---------------------------------------------------------------------------
+
+  /**
+   * Core HTTP helper with retry on 5xx.
+   *
+   * @param {string} method   HTTP verb (GET, POST, PATCH, DELETE)
+   * @param {string} path     URL path starting with /api/...
+   * @param {object} [opts]
+   * @param {object} [opts.body]    Request body (will be JSON-serialized)
+   * @param {string} [opts.query]  Pre-built query string (without leading ?)
+   * @returns {Promise<object>} Parsed JSON response body
+   */
+  async _req(method, path, opts = {}) {
+    const url = `${this.baseUrl}${path}${opts.query ? '?' + opts.query : ''}`;
+    const reqOpts = {
+      method,
+      headers: {
+        'Content-Type': 'application/json',
+        'xc-token': this.token,
+      },
+    };
+    if (opts.body !== undefined) {
+      reqOpts.body = JSON.stringify(opts.body);
+    }
+
+    const RETRY_DELAYS = [100, 300, 1000];
+    let lastErr;
+
+    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
+      const res = await this.fetchFn(url, reqOpts);
+
+      if (res.ok) {
+        return res.json();
+      }
+
+      // 404 is special — used by get() to return null; surface immediately
+      // 4xx (non-404) are caller errors — do NOT retry
+      if (res.status !== 500 && res.status !== 503) {
+        const body = await res.text();
+        throw new Error(
+          `NocoDB ${method} ${path} => ${res.status}: ${body}`
+        );
+      }
+
+      // 500 or 503 — retry if we have attempts left
+      if (attempt < RETRY_DELAYS.length) {
+        await _sleep(RETRY_DELAYS[attempt]);
+      } else {
+        const body = await res.text();
+        lastErr = new Error(
+          `NocoDB ${method} ${path} => ${res.status}: ${body}`
+        );
+      }
+    }
+
+    throw lastErr;
+  }
+
+  // ---------------------------------------------------------------------------
+  // Public methods
+  // ---------------------------------------------------------------------------
+
+  /**
+   * List records from a table.
+   *
+   * @param {string} table
+   * @param {object} [opts]
+   * @param {string}  [opts.where]   NocoDB where clause e.g. "(status,eq,active)"
+   * @param {number}  [opts.limit]
+   * @param {number}  [opts.offset]
+   * @param {string}  [opts.sort]    e.g. "-Id" for descending
+   * @param {string}  [opts.fields]  comma-separated field names
+   * @returns {Promise<{ list: object[], pageInfo: object }>}
+   */
+  async list(table, opts = {}) {
+    const params = new URLSearchParams();
+    if (opts.where !== undefined) params.set('where', opts.where);
+    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
+    if (opts.offset !== undefined) params.set('offset', String(opts.offset));
+    if (opts.sort !== undefined) params.set('sort', opts.sort);
+    if (opts.fields !== undefined) params.set('fields', opts.fields);
+    const query = params.toString();
+    const path = `/api/v1/db/data/noco/${this.projectId}/${table}`;
+    return this._req('GET', path, query ? { query } : {});
+  }
+
+  /**
+   * Get a single record by integer ID.
+   * Returns null if not found (404) — does NOT throw.
+   *
+   * @param {string} table
+   * @param {number} id
+   * @returns {Promise<object|null>}
+   */
+  async get(table, id) {
+    const path = `/api/v1/db/data/noco/${this.projectId}/${table}/${id}`;
+    try {
+      return await this._req('GET', path);
+    } catch (err) {
+      if (err.message && err.message.includes('=> 404:')) {
+        return null;
+      }
+      throw err;
+    }
+  }
+
+  /**
+   * Create a record with a flat data object (no { fields: {} } wrapper).
+   *
+   * @param {string} table
+   * @param {object} data  Flat key/value pairs matching NocoDB column names
+   * @returns {Promise<object>} Created record including integer Id
+   */
+  async create(table, data) {
+    const path = `/api/v1/db/data/noco/${this.projectId}/${table}`;
+    return this._req('POST', path, { body: data });
+  }
+
+  /**
+   * Partially update a record.
+   * Pass ONLY the fields to change — do not spread a full record (system
+   * fields like Id and created_at will cause Postgres errors).
+   *
+   * @param {string} table
+   * @param {number} id
+   * @param {object} data  Partial update fields
+   * @returns {Promise<object>} Updated record
+   */
+  async update(table, id, data) {
+    const path = `/api/v1/db/data/noco/${this.projectId}/${table}/${id}`;
+    return this._req('PATCH', path, { body: data });
+  }
+
+  /**
+   * Delete a record by ID.
+   *
+   * @param {string} table
+   * @param {number} id
+   * @returns {Promise<object>} Success response
+   */
+  async delete(table, id) {
+    const path = `/api/v1/db/data/noco/${this.projectId}/${table}/${id}`;
+    return this._req('DELETE', path);
+  }
+
+  /**
+   * Bulk-create records. Chunks into batches of 200 (sequential) to avoid
+   * Postgres parameter-limit errors.
+   *
+   * Bulk endpoint URL differs from single-record URL:
+   *   /api/v1/db/data/bulk/noco/{projectId}/{tableName}/  (note /bulk/ and trailing slash)
+   *
+   * @param {string}   table
+   * @param {object[]} records  Array of flat record objects
+   * @returns {Promise<object[]>} Flattened array of all created records
+   */
+  async bulkCreate(table, records) {
+    const CHUNK_SIZE = 200;
+    const path = `/api/v1/db/data/bulk/noco/${this.projectId}/${table}/`;
+    const results = [];
+
+    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
+      const chunk = records.slice(i, i + CHUNK_SIZE);
+      const created = await this._req('POST', path, { body: chunk });
+      if (Array.isArray(created)) {
+        results.push(...created);
+      }
+    }
+
+    return results;
+  }
+
+  /**
+   * Count records matching an optional where clause.
+   *
+   * @param {string} table
+   * @param {string} [where]  NocoDB where clause
+   * @returns {Promise<number>} Integer count (unwrapped from { count: N })
+   */
+  async count(table, where) {
+    const path = `/api/v1/db/data/noco/${this.projectId}/${table}/count`;
+    const params = new URLSearchParams();
+    if (where) params.set('where', where);
+    const query = params.toString();
+    const result = await this._req('GET', path, query ? { query } : {});
+    return result.count;
+  }
+}
+
+// ---------------------------------------------------------------------------
+// Internal sleep (not exported — only used by _req retry logic)
+// ---------------------------------------------------------------------------
+function _sleep(ms) {
+  return new Promise((resolve) => setTimeout(resolve, ms));
+}
+
+module.exports = { NocoDB };
diff --git a/insiderbuying-site/tests/insiderbuying/nocodb-client.test.js b/insiderbuying-site/tests/insiderbuying/nocodb-client.test.js
new file mode 100644
index 0000000..cacb358
--- /dev/null
+++ b/insiderbuying-site/tests/insiderbuying/nocodb-client.test.js
@@ -0,0 +1,385 @@
+'use strict';
+
+const { NocoDB } = require('../../n8n/code/insiderbuying/nocodb-client');
+
+// --- helpers -----------------------------------------------------------------
+
+function makeFetch(response, ok = true, status = 200) {
+  return jest.fn().mockResolvedValue({
+    ok,
+    status,
+    statusText: ok ? 'OK' : 'Error',
+    json: async () => response,
+    text: async () => JSON.stringify(response),
+  });
+}
+
+function makeFetchSeq(...calls) {
+  const fn = jest.fn();
+  calls.forEach(({ response, ok = true, status = 200 }) => {
+    fn.mockResolvedValueOnce({
+      ok,
+      status,
+      statusText: ok ? 'OK' : 'Error',
+      json: async () => response,
+      text: async () => JSON.stringify(response),
+    });
+  });
+  return fn;
+}
+
+const BASE_URL = 'http://localhost:8080';
+const TOKEN = 'test-token';
+const PROJECT_ID = 'proj123';
+
+function makeClient(fetchFn) {
+  return new NocoDB(BASE_URL, TOKEN, PROJECT_ID, fetchFn);
+}
+
+// --- constructor -------------------------------------------------------------
+
+describe('NocoDB constructor', () => {
+  test('stores baseUrl, token, projectId, fetchFn', () => {
+    const fn = jest.fn();
+    const db = new NocoDB(BASE_URL, TOKEN, PROJECT_ID, fn);
+    expect(db.baseUrl).toBe(BASE_URL);
+    expect(db.token).toBe(TOKEN);
+    expect(db.projectId).toBe(PROJECT_ID);
+    expect(db.fetchFn).toBe(fn);
+  });
+});
+
+// --- list() ------------------------------------------------------------------
+
+describe('list()', () => {
+  test('calls GET with correct URL path', async () => {
+    const fetchFn = makeFetch({ list: [], pageInfo: { isLastPage: true } });
+    const db = makeClient(fetchFn);
+    await db.list('Alerts');
+    const [url] = fetchFn.mock.calls[0];
+    expect(url).toContain('/api/v1/db/data/noco/proj123/Alerts');
+    expect(fetchFn.mock.calls[0][1].method).toBe('GET');
+  });
+
+  test('passes where, limit, offset, sort, fields as query params', async () => {
+    const fetchFn = makeFetch({ list: [], pageInfo: { isLastPage: true } });
+    const db = makeClient(fetchFn);
+    await db.list('Alerts', { where: '(status,eq,active)', limit: 50, offset: 100, sort: '-Id', fields: 'id,name' });
+    const [url] = fetchFn.mock.calls[0];
+    expect(url).toContain('where=%28status%2Ceq%2Cactive%29');
+    expect(url).toContain('limit=50');
+    expect(url).toContain('offset=100');
+    expect(url).toContain('sort=-Id');
+    expect(url).toContain('fields=id%2Cname');
+  });
+
+  test('omits query params when opts is empty', async () => {
+    const fetchFn = makeFetch({ list: [], pageInfo: { isLastPage: true } });
+    const db = makeClient(fetchFn);
+    await db.list('Alerts', {});
+    const [url] = fetchFn.mock.calls[0];
+    expect(url).not.toContain('?');
+  });
+
+  test('returns { list, pageInfo } shape', async () => {
+    const mockList = [{ Id: 1, name: 'test' }];
+    const mockPageInfo = { isLastPage: false, page: 1, pageSize: 25, totalRows: 50 };
+    const fetchFn = makeFetch({ list: mockList, pageInfo: mockPageInfo });
+    const db = makeClient(fetchFn);
+    const result = await db.list('Alerts');
+    expect(result.list).toEqual(mockList);
+    expect(result.pageInfo).toEqual(mockPageInfo);
+  });
+
+  test('handles empty list', async () => {
+    const fetchFn = makeFetch({ list: [], pageInfo: { isLastPage: true } });
+    const db = makeClient(fetchFn);
+    const result = await db.list('Alerts');
+    expect(result.list).toEqual([]);
+    expect(result.pageInfo.isLastPage).toBe(true);
+  });
+
+  test('includes xc-token header', async () => {
+    const fetchFn = makeFetch({ list: [], pageInfo: { isLastPage: true } });
+    const db = makeClient(fetchFn);
+    await db.list('Alerts');
+    const headers = fetchFn.mock.calls[0][1].headers;
+    expect(headers['xc-token']).toBe(TOKEN);
+  });
+});
+
+// --- get() -------------------------------------------------------------------
+
+describe('get()', () => {
+  test('calls GET with URL ending in tableName/42', async () => {
+    const record = { Id: 42, name: 'test' };
+    const fetchFn = makeFetch(record);
+    const db = makeClient(fetchFn);
+    await db.get('Alerts', 42);
+    const [url] = fetchFn.mock.calls[0];
+    expect(url).toContain('/api/v1/db/data/noco/proj123/Alerts/42');
+    expect(fetchFn.mock.calls[0][1].method).toBe('GET');
+  });
+
+  test('returns flat record object on success', async () => {
+    const record = { Id: 42, name: 'test', status: 'active' };
+    const fetchFn = makeFetch(record);
+    const db = makeClient(fetchFn);
+    const result = await db.get('Alerts', 42);
+    expect(result).toEqual(record);
+  });
+
+  test('returns null when server responds 404', async () => {
+    const fetchFn = makeFetch({ msg: 'Not Found' }, false, 404);
+    const db = makeClient(fetchFn);
+    const result = await db.get('Alerts', 99);
+    expect(result).toBeNull();
+  });
+
+  test('throws descriptive error on 500', async () => {
+    const fetchFn = makeFetch({ msg: 'Internal Server Error' }, false, 500);
+    const db = makeClient(fetchFn);
+    // get() retries on 500, so provide enough 500s to exhaust retries
+    const retryFn = makeFetchSeq(
+      { response: { msg: 'err' }, ok: false, status: 500 },
+      { response: { msg: 'err' }, ok: false, status: 500 },
+      { response: { msg: 'err' }, ok: false, status: 500 },
+      { response: { msg: 'err' }, ok: false, status: 500 }
+    );
+    const db2 = makeClient(retryFn);
+    await expect(db2.get('Alerts', 1)).rejects.toThrow(/500/);
+  });
+});
+
+// --- create() ----------------------------------------------------------------
+
+describe('create()', () => {
+  test('calls POST with flat JSON body (no fields wrapper)', async () => {
+    const createdRecord = { Id: 10, ticker: 'AAPL', status: 'pending' };
+    const fetchFn = makeFetch(createdRecord);
+    const db = makeClient(fetchFn);
+    await db.create('Alerts', { ticker: 'AAPL', status: 'pending' });
+    const call = fetchFn.mock.calls[0];
+    expect(call[1].method).toBe('POST');
+    const body = JSON.parse(call[1].body);
+    expect(body).toEqual({ ticker: 'AAPL', status: 'pending' });
+    expect(body.fields).toBeUndefined();
+  });
+
+  test('returns created record with Id', async () => {
+    const createdRecord = { Id: 10, ticker: 'AAPL' };
+    const fetchFn = makeFetch(createdRecord);
+    const db = makeClient(fetchFn);
+    const result = await db.create('Alerts', { ticker: 'AAPL' });
+    expect(result.Id).toBe(10);
+  });
+
+  test('throws with method + URL + status on non-2xx', async () => {
+    const fetchFn = makeFetch({ msg: 'Bad Request' }, false, 400);
+    const db = makeClient(fetchFn);
+    await expect(db.create('Alerts', {})).rejects.toThrow(/POST.*400/);
+  });
+});
+
+// --- update() ----------------------------------------------------------------
+
+describe('update()', () => {
+  test('calls PATCH to tableName/42 with partial data', async () => {
+    const updatedRecord = { Id: 42, status: 'sent' };
+    const fetchFn = makeFetch(updatedRecord);
+    const db = makeClient(fetchFn);
+    await db.update('Alerts', 42, { status: 'sent' });
+    const call = fetchFn.mock.calls[0];
+    expect(call[1].method).toBe('PATCH');
+    const [url] = call;
+    expect(url).toContain('/Alerts/42');
+    const body = JSON.parse(call[1].body);
+    expect(body).toEqual({ status: 'sent' });
+  });
+
+  test('does not include Id or system fields if caller did not pass them', async () => {
+    const fetchFn = makeFetch({ Id: 42, status: 'sent' });
+    const db = makeClient(fetchFn);
+    await db.update('Alerts', 42, { status: 'sent' });
+    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
+    expect(body.Id).toBeUndefined();
+  });
+});
+
+// --- delete() ----------------------------------------------------------------
+
+describe('delete()', () => {
+  test('calls DELETE to tableName/42', async () => {
+    const fetchFn = makeFetch({ msg: 'The record has been deleted successfully' });
+    const db = makeClient(fetchFn);
+    await db.delete('Alerts', 42);
+    const call = fetchFn.mock.calls[0];
+    expect(call[1].method).toBe('DELETE');
+    expect(call[0]).toContain('/Alerts/42');
+  });
+
+  test('returns success response', async () => {
+    const successResp = { msg: 'The record has been deleted successfully' };
+    const fetchFn = makeFetch(successResp);
+    const db = makeClient(fetchFn);
+    const result = await db.delete('Alerts', 42);
+    expect(result).toEqual(successResp);
+  });
+});
+
+// --- bulkCreate() ------------------------------------------------------------
+
+describe('bulkCreate()', () => {
+  test('calls POST to bulk endpoint', async () => {
+    const records = [{ ticker: 'AAPL' }, { ticker: 'MSFT' }];
+    const fetchFn = makeFetch(records);
+    const db = makeClient(fetchFn);
+    await db.bulkCreate('Alerts', records);
+    const [url] = fetchFn.mock.calls[0];
+    expect(url).toContain('/api/v1/db/data/bulk/noco/proj123/Alerts/');
+    expect(fetchFn.mock.calls[0][1].method).toBe('POST');
+  });
+
+  test('sends full array in single call when records count <= 200', async () => {
+    const records = Array.from({ length: 5 }, (_, i) => ({ ticker: `T${i}` }));
+    const fetchFn = makeFetch(records);
+    const db = makeClient(fetchFn);
+    await db.bulkCreate('Alerts', records);
+    expect(fetchFn).toHaveBeenCalledTimes(1);
+    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
+    expect(body).toHaveLength(5);
+  });
+
+  test('chunks into two POST calls when records count > 200', async () => {
+    const records = Array.from({ length: 250 }, (_, i) => ({ ticker: `T${i}` }));
+    const batch1 = records.slice(0, 200);
+    const batch2 = records.slice(200);
+    const fetchFn = makeFetchSeq(
+      { response: batch1, ok: true, status: 200 },
+      { response: batch2, ok: true, status: 200 }
+    );
+    const db = makeClient(fetchFn);
+    await db.bulkCreate('Alerts', records);
+    expect(fetchFn).toHaveBeenCalledTimes(2);
+    const body1 = JSON.parse(fetchFn.mock.calls[0][1].body);
+    const body2 = JSON.parse(fetchFn.mock.calls[1][1].body);
+    expect(body1).toHaveLength(200);
+    expect(body2).toHaveLength(50);
+  });
+
+  test('returns flattened array of all created records', async () => {
+    const records = Array.from({ length: 250 }, (_, i) => ({ Id: i + 1, ticker: `T${i}` }));
+    const batch1 = records.slice(0, 200);
+    const batch2 = records.slice(200);
+    const fetchFn = makeFetchSeq(
+      { response: batch1, ok: true, status: 200 },
+      { response: batch2, ok: true, status: 200 }
+    );
+    const db = makeClient(fetchFn);
+    const result = await db.bulkCreate('Alerts', records);
+    expect(result).toHaveLength(250);
+    expect(result[0].Id).toBe(1);
+    expect(result[249].Id).toBe(250);
+  });
+});
+
+// --- count() -----------------------------------------------------------------
+
+describe('count()', () => {
+  test('calls GET to tableName/count', async () => {
+    const fetchFn = makeFetch({ count: 42 });
+    const db = makeClient(fetchFn);
+    await db.count('Alerts', '(status,eq,active)');
+    const [url] = fetchFn.mock.calls[0];
+    expect(url).toContain('/Alerts/count');
+    expect(fetchFn.mock.calls[0][1].method).toBe('GET');
+  });
+
+  test('passes where as query param when provided', async () => {
+    const fetchFn = makeFetch({ count: 7 });
+    const db = makeClient(fetchFn);
+    await db.count('Alerts', '(status,eq,active)');
+    const [url] = fetchFn.mock.calls[0];
+    expect(url).toContain('where=');
+  });
+
+  test('returns the integer from response.count', async () => {
+    const fetchFn = makeFetch({ count: 42 });
+    const db = makeClient(fetchFn);
+    const result = await db.count('Alerts', '');
+    expect(result).toBe(42);
+  });
+
+  test('returns 0 when where filter matches nothing', async () => {
+    const fetchFn = makeFetch({ count: 0 });
+    const db = makeClient(fetchFn);
+    const result = await db.count('Alerts', '(ticker,eq,NOMATCH)');
+    expect(result).toBe(0);
+  });
+});
+
+// --- error handling / retry --------------------------------------------------
+
+describe('_req() retry and error handling', () => {
+  test('retries on 500 and succeeds on third call', async () => {
+    const goodRecord = { Id: 1, ticker: 'AAPL' };
+    const fetchFn = makeFetchSeq(
+      { response: { msg: 'err' }, ok: false, status: 500 },
+      { response: { msg: 'err' }, ok: false, status: 500 },
+      { response: goodRecord, ok: true, status: 200 }
+    );
+    const db = makeClient(fetchFn);
+    const result = await db.get('Alerts', 1);
+    expect(fetchFn).toHaveBeenCalledTimes(3);
+    expect(result).toEqual(goodRecord);
+  });
+
+  test('does NOT retry on 404 — throws immediately', async () => {
+    const fetchFn = makeFetchSeq(
+      { response: { msg: 'Not Found' }, ok: false, status: 404 }
+    );
+    const db = makeClient(fetchFn);
+    // list() should throw on 404 without retry
+    await expect(db.list('Alerts')).rejects.toThrow(/404/);
+    expect(fetchFn).toHaveBeenCalledTimes(1);
+  });
+
+  test('does NOT retry on 400 — throws immediately', async () => {
+    const fetchFn = makeFetchSeq(
+      { response: { msg: 'Bad Request' }, ok: false, status: 400 }
+    );
+    const db = makeClient(fetchFn);
+    await expect(db.create('Alerts', {})).rejects.toThrow(/400/);
+    expect(fetchFn).toHaveBeenCalledTimes(1);
+  });
+
+  test('error message includes HTTP method, URL path, and status code', async () => {
+    const fetchFn = makeFetchSeq(
+      { response: { msg: 'Bad Request' }, ok: false, status: 400 }
+    );
+    const db = makeClient(fetchFn);
+    let err;
+    try {
+      await db.create('Alerts', {});
+    } catch (e) {
+      err = e;
+    }
+    expect(err.message).toMatch(/POST/);
+    expect(err.message).toMatch(/\/api\/v1\/db\/data\/noco\/proj123\/Alerts/);
+    expect(err.message).toMatch(/400/);
+  });
+
+  test('error message does NOT contain the xc-token value', async () => {
+    const fetchFn = makeFetchSeq(
+      { response: { msg: 'Bad Request' }, ok: false, status: 400 }
+    );
+    const db = makeClient(fetchFn);
+    let err;
+    try {
+      await db.create('Alerts', {});
+    } catch (e) {
+      err = e;
+    }
+    expect(err.message).not.toContain(TOKEN);
+  });
+});
