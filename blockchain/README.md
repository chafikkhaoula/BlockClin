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
2. On Windows, open **Git Bash** (not PowerShell). Fabric's `network.sh` is a Bash script, so running it directly from PowerShell can finish without showing the Fabric logs.
3. From the directory that contains `fabric-samples`, download the Fabric binaries and Docker images. The existing `fabric-samples` folder is retained:

```bash
cd /c/Users/khcha/Documents/Codex/2026-08-24/mn/work
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh docker binary
```

This step creates the required `fabric-samples/bin` and `fabric-samples/config` directories and downloads the Fabric container images.

4. Run the BlockClin Windows helper. It prevents Git Bash from rewriting Fabric's Docker socket path, downloads `jq` if it is missing, starts the BlockClin network, creates the channel, and deploys the provenance chaincode:

```bash
cd /c/Users/khcha/Documents/Codex/2026-08-24/mn/blockclin-app
bash ./blockchain/scripts/start-fabric-windows.sh
```

5. On Linux or WSL, start a two-organization test channel manually:

```bash
./network.sh up createChannel -c blockclinchannel
```

6. Deploy the BlockClin chaincode with a path to `chaincode-provenance`:

```bash
./network.sh deployCC -c blockclinchannel -ccn provenance -ccp /absolute/path/to/blockclin-app/blockchain/chaincode-provenance -ccl javascript
```

7. Copy `.env.example` to a local environment file, set `FABRIC_SAMPLES_PATH`, then start the gateway:

```bash
cd blockchain/gateway
npm start
```

The BlockClin gateway listens on `http://127.0.0.1:8082` by default. Port 8081 is reserved by an existing local IPFS service.

8. Start BlockClin and run the normal import workflow. At the Anchor stage the application calls the local gateway, which invokes `CreateProvenance` on Fabric and returns the committed Fabric transaction ID.

## Research evidence

Use the application's **Experiment mode** to run de-identified benchmark sizes of 1, 10, 50, and 100 records. Every benchmark record follows the same validation, FHIR transformation, SHA-256, Fabric commitment, and receiver-delivery path as a manual import.

The application records the following measurements for each run and exports them as CSV:

- requested, completed, and failed record counts;
- generated FHIR resource count;
- record preparation, validation, transformation, hashing, Fabric commit, and receiver delivery durations;
- total duration and achieved throughput;
- Fabric transaction IDs and any failure message.

For the paper, perform a warm-up run first, then repeat each benchmark size at least three times. Report both successful runs and any failure explicitly; never remove failed results from the evidence log.
