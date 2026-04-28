'use strict';

// uuid v14 ships native ESM (`export` keyword in dist-node), which Jest's CJS
// runtime cannot load. The override pin in package.json keeps the patched
// version on disk for runtime use; this shim keeps unit tests working by
// reimplementing the surface we (and transitive deps like bull/exceljs) touch.

const { randomUUID } = require('crypto');

const NIL = '00000000-0000-0000-0000-000000000000';
const MAX = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

const gen = () => randomUUID();

const uuid = {
  v1: gen,
  v3: gen,
  v4: gen,
  v5: gen,
  v6: gen,
  v7: gen,
  validate: value =>
    typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value),
  version: () => 4,
  parse: value => Buffer.from(value.replace(/-/g, ''), 'hex'),
  stringify: buf => Buffer.from(buf).toString('hex'),
  NIL,
  MAX,
};

module.exports = uuid;
module.exports.default = uuid;
