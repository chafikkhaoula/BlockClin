'use strict';

const { Contract } = require('fabric-contract-api');
const stringify = require('json-stringify-deterministic');
const sortKeysRecursive = require('sort-keys-recursive');

class ProvenanceContract extends Contract {
  async CreateProvenance(ctx, recordKey, bundleHash, resourceCount, sourceSystem) {
    this.assertRecordKey(recordKey);
    this.assertHash(bundleHash);

    const count = Number(resourceCount);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error('resourceCount must be a positive integer');
    }

    const transactionId = ctx.stub.getTxID();
    const provenanceKey = ctx.stub.createCompositeKey('provenance', [recordKey, transactionId]);
    const exists = await this.ProvenanceExists(ctx, provenanceKey);
    if (exists) {
      throw new Error(`Provenance entry ${provenanceKey} already exists`);
    }

    const timestamp = ctx.stub.getTxTimestamp();
    const recordedAt = new Date(Number(timestamp.seconds.toString()) * 1000).toISOString();
    const provenance = {
      docType: 'clinicalProvenance',
      recordKey,
      bundleHash: bundleHash.toLowerCase(),
      resourceCount: count,
      sourceSystem: sourceSystem.trim(),
      transactionId,
      recordedAt,
    };

    await ctx.stub.putState(provenanceKey, Buffer.from(stringify(sortKeysRecursive(provenance))));
    ctx.stub.setEvent('ProvenanceAnchored', Buffer.from(stringify(provenance)));
    return stringify(provenance);
  }

  async ReadProvenance(ctx, recordKey, transactionId) {
    this.assertRecordKey(recordKey);
    const provenanceKey = ctx.stub.createCompositeKey('provenance', [recordKey, transactionId]);
    const provenanceJSON = await ctx.stub.getState(provenanceKey);
    if (!provenanceJSON || provenanceJSON.length === 0) {
      throw new Error(`No provenance exists for ${recordKey} and transaction ${transactionId}`);
    }
    return provenanceJSON.toString();
  }

  async GetRecordProvenance(ctx, recordKey) {
    this.assertRecordKey(recordKey);
    const iterator = await ctx.stub.getStateByPartialCompositeKey('provenance', [recordKey]);
    const entries = [];
    let result = await iterator.next();

    while (!result.done) {
      entries.push(JSON.parse(result.value.value.toString('utf8')));
      result = await iterator.next();
    }
    await iterator.close();
    return stringify(entries);
  }

  async ProvenanceExists(ctx, provenanceKey) {
    const data = await ctx.stub.getState(provenanceKey);
    return Boolean(data && data.length > 0);
  }

  assertRecordKey(recordKey) {
    if (!/^[A-Za-z0-9_-]{3,64}$/.test(recordKey)) {
      throw new Error('recordKey must be a 3-64 character pseudonymized identifier');
    }
  }

  assertHash(bundleHash) {
    if (!/^[a-fA-F0-9]{64}$/.test(bundleHash)) {
      throw new Error('bundleHash must be a SHA-256 hexadecimal digest');
    }
  }
}

module.exports = ProvenanceContract;
