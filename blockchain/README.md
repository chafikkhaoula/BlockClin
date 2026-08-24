# BlockClin Hyperledger Fabric Integration

This folder contains the components that turn BlockClin provenance into a real permissioned-blockchain transaction.

## What is stored on chain

The `ProvenanceContract` stores only:

- a pseudonymized record key;
- the SHA-256 digest of the generated FHIR Bundle;
- the number of FHIR resources;
- the source-system name;
- the Fabric transaction ID and transaction timestamp.

The clinical record and FHIR Bundle remain off chain.

## Local test network

1. Start Docker Desktop and confirm that `docker info` succeeds.
2. Install the Fabric samples, binaries, and Docker images with the official Fabric install script.
3. From `fabric-samples/test-network`, start a two-organization test channel:

```bash
./network.sh up createChannel -c blockclinchannel
```

4. Deploy the BlockClin chaincode with a path to `chaincode-provenance`:

```bash
./network.sh deployCC -c blockclinchannel -ccn provenance -ccp /absolute/path/to/blockclin-app/blockchain/chaincode-provenance -ccl javascript
```

5. Copy `.env.example` to a local environment file, set `FABRIC_SAMPLES_PATH`, then start the gateway:

```bash
cd blockchain/gateway
npm start
```

6. Start BlockClin and run the normal import workflow. At the Anchor stage the application calls the local gateway, which invokes `CreateProvenance` on Fabric and returns the committed Fabric transaction ID.

## Research evidence

For each experiment, record FHIR validation status, transformation resource count, SHA-256 digest, Fabric transaction ID, commit timestamp, and receiver receipt.
