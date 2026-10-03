'use strict';

// Tests for qdrant.js. Qdrant itself is never contacted: a fake client is
// injected via qdrant._setClientForTests(), mirroring the injected-dependency
// pattern used elsewhere in this project (see compaction.js's `summarize`).
//
// EMBEDDING_DIM is read from process.env at require time, so tests that need
// a specific dimension set process.env.EMBEDDING_DIM and re-require the
// module (clearing require.cache) to get a fresh copy with that dimension.

const test = require('node:test');
const assert = require('node:assert/strict');

function freshQdrant() {
  delete require.cache[require.resolve('../qdrant')];
  return require('../qdrant');
}

function notFoundError() {
  return new Error('Not found: Collection `chat_messages` doesn\'t exist!');
}

test('upsertPoint recreates the collection and retries once after a missing-collection failure', async () => {
  const qdrant = freshQdrant();
  const dim = qdrant.EMBEDDING_DIM;

  let existsCalls = 0;
  let createCalls = 0;
  let upsertCalls = 0;

  const fake = {
    async collectionExists() {
      existsCalls += 1;
      // First check: gone. After recreation, present.
      return { exists: createCalls > 0 };
    },
    async createCollection() {
      createCalls += 1;
    },
    async getCollection() {
      return { config: { params: { vectors: { size: dim } } } };
    },
    async upsert() {
      upsertCalls += 1;
      if (upsertCalls === 1) throw notFoundError();
      return { status: 'completed' };
    },
    async search() {
      return [];
    },
  };

  qdrant._setClientForTests(fake);

  await qdrant.upsertPoint({ id: 1, vector: new Array(dim).fill(0.1), payload: { a: 1 } });

  assert.equal(upsertCalls, 2, 'upsert must be retried exactly once after failure');
  assert.equal(createCalls, 1, 'collection must be recreated after being found missing');
  assert.equal(existsCalls, 2, 'collection existence must be rechecked once during the retry');
});

test('upsertPoint surfaces the error when the retry also fails', async () => {
  const qdrant = freshQdrant();
  const dim = qdrant.EMBEDDING_DIM;

  const fake = {
    async collectionExists() {
      return { exists: false };
    },
    async createCollection() {},
    async getCollection() {
      return { config: { params: { vectors: { size: dim } } } };
    },
    async upsert() {
      throw notFoundError();
    },
    async search() {
      return [];
    },
  };

  qdrant._setClientForTests(fake);

  await assert.rejects(
    () => qdrant.upsertPoint({ id: 1, vector: new Array(dim).fill(0.1), payload: {} }),
    /doesn't exist/,
  );
});

test('ensureCollection throws a clear error on EMBEDDING_DIM / existing-collection mismatch', async () => {
  const prevDim = process.env.EMBEDDING_DIM;
  process.env.EMBEDDING_DIM = '256';
  const qdrant = freshQdrant();

  const fake = {
    async collectionExists() {
      return { exists: true };
    },
    async createCollection() {},
    async getCollection() {
      return { config: { params: { vectors: { size: 768 } } } };
    },
    async upsert() {
      return { status: 'completed' };
    },
    async search() {
      return [];
    },
  };
  qdrant._setClientForTests(fake);

  await assert.rejects(
    () => qdrant.ensureCollection(),
    /vector size 768.*EMBEDDING_DIM.*256/s,
  );

  if (prevDim === undefined) delete process.env.EMBEDDING_DIM;
  else process.env.EMBEDDING_DIM = prevDim;
});

test('upsertPoint throws a clear error when the vector length does not match EMBEDDING_DIM', async () => {
  const prevDim = process.env.EMBEDDING_DIM;
  process.env.EMBEDDING_DIM = '4';
  const qdrant = freshQdrant();

  const fake = {
    async collectionExists() {
      return { exists: true };
    },
    async createCollection() {},
    async getCollection() {
      return { config: { params: { vectors: { size: 4 } } } };
    },
    async upsert() {
      return { status: 'completed' };
    },
    async search() {
      return [];
    },
  };
  qdrant._setClientForTests(fake);

  await assert.rejects(
    () => qdrant.upsertPoint({ id: 1, vector: [0.1, 0.2, 0.3], payload: {} }),
    /dimension 3.*EMBEDDING_DIM=4/s,
  );

  if (prevDim === undefined) delete process.env.EMBEDDING_DIM;
  else process.env.EMBEDDING_DIM = prevDim;
});

test('searchByVector recovers via the same retry path and maps results to {id, score, payload}', async () => {
  const qdrant = freshQdrant();
  const dim = qdrant.EMBEDDING_DIM;

  let existsCalls = 0;
  let createCalls = 0;
  let searchCalls = 0;

  const fake = {
    async collectionExists() {
      existsCalls += 1;
      return { exists: createCalls > 0 };
    },
    async createCollection() {
      createCalls += 1;
    },
    async getCollection() {
      return { config: { params: { vectors: { size: dim } } } };
    },
    async upsert() {
      return { status: 'completed' };
    },
    async search() {
      searchCalls += 1;
      if (searchCalls === 1) throw notFoundError();
      return [{ id: 'p1', score: 0.9, payload: { text: 'hi' } }];
    },
  };

  qdrant._setClientForTests(fake);

  const results = await qdrant.searchByVector(new Array(dim).fill(0.1), { limit: 5 });

  assert.equal(searchCalls, 2, 'search must be retried exactly once after failure');
  assert.equal(createCalls, 1, 'collection must be recreated after being found missing');
  assert.equal(existsCalls, 2, 'collection existence must be rechecked once during the retry');
  assert.deepEqual(results, [{ id: 'p1', score: 0.9, payload: { text: 'hi' } }]);
});

// TODO 2.7's "Qdrant reconnection loop" flap: while Qdrant is down the caller
// sees the raw failure (server.js turns it into a 503 / fails open), and once
// it is back the very next request succeeds with no manual reset — the failed
// attempt leaves collectionReady false, so ensureCollection() re-runs. No
// reconnection loop or new code path is needed; this test pins that contract.
test('a Qdrant outage surfaces an error, and the next request recovers once it is back', async () => {
  const qdrant = freshQdrant();
  const dim = qdrant.EMBEDDING_DIM;

  let existsCalls = 0;
  let searchCalls = 0;

  const fake = {
    async collectionExists() {
      existsCalls += 1;
      if (existsCalls === 1) {
        throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6333'), { code: 'ECONNREFUSED' });
      }
      return { exists: true };
    },
    async createCollection() {
      throw new Error('createCollection must not be called during a pure outage/recovery flap');
    },
    async getCollection() {
      return { config: { params: { vectors: { size: dim } } } };
    },
    async upsert() {
      return { status: 'completed' };
    },
    async search() {
      searchCalls += 1;
      return [{ id: 'p1', score: 0.9, payload: { text: 'back online' } }];
    },
  };

  qdrant._setClientForTests(fake);

  await assert.rejects(
    () => qdrant.searchByVector(new Array(dim).fill(0.1), { limit: 5 }),
    /ECONNREFUSED/,
  );

  const results = await qdrant.searchByVector(new Array(dim).fill(0.1), { limit: 5 });
  assert.equal(searchCalls, 1, 'the recovery request must succeed on its first search');
  assert.deepEqual(results, [{ id: 'p1', score: 0.9, payload: { text: 'back online' } }]);
});
