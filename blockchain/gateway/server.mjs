import * as grpc from '@grpc/grpc-js';
import { connect, hash, signers } from '@hyperledger/fabric-gateway';
import { createServer } from 'node:http';
import { createPrivateKey } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const fabricSamplesPath = process.env.FABRIC_SAMPLES_PATH || path.resolve(moduleDirectory, '..', '..', '..', 'work', 'fabric-samples');
const channelName = process.env.FABRIC_CHANNEL || 'blockclinchannel';
const chaincodeName = process.env.FABRIC_CHAINCODE || 'provenance';
const mspId = process.env.FABRIC_MSP_ID || 'Org1MSP';
const peerEndpoint = process.env.FABRIC_PEER_ENDPOINT || 'localhost:7051';
const peerHostAlias = process.env.FABRIC_PEER_HOST_ALIAS || 'peer0.org1.example.com';
const cryptoPath = process.env.FABRIC_CRYPTO_PATH || path.join(fabricSamplesPath, 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com');
const keyDirectoryPath = process.env.FABRIC_KEY_DIRECTORY || path.join(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore');
const certDirectoryPath = process.env.FABRIC_CERT_DIRECTORY || path.join(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'signcerts');
const tlsCertPath = process.env.FABRIC_TLS_CERT || path.join(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');
const port = Number(process.env.PORT || 8081);
const decoder = new TextDecoder();

async function getFirstFile(directory) {
  const files = await fs.readdir(directory);
  if (!files[0]) throw new Error(`No identity file found in ${directory}`);
  return path.join(directory, files[0]);
}

async function createGatewayConnection() {
  const tlsRootCert = await fs.readFile(tlsCertPath);
  const client = new grpc.Client(peerEndpoint, grpc.credentials.createSsl(tlsRootCert), {
    'grpc.ssl_target_name_override': peerHostAlias,
  });
  const certificate = await fs.readFile(await getFirstFile(certDirectoryPath));
  const privateKey = createPrivateKey(await fs.readFile(await getFirstFile(keyDirectoryPath)));
  const gateway = connect({
    client,
    identity: { mspId, credentials: certificate },
    signer: signers.newPrivateKeySigner(privateKey),
    hash: hash.sha256,
    evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
    endorseOptions: () => ({ deadline: Date.now() + 15000 }),
    submitOptions: () => ({ deadline: Date.now() + 5000 }),
    commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
  });
  return { client, gateway };
}

async function submitProvenance({ recordKey, bundleHash, resourceCount, sourceSystem }) {
  const { client, gateway } = await createGatewayConnection();
  try {
    const contract = gateway.getNetwork(channelName).getContract(chaincodeName, 'ProvenanceContract');
    const result = await contract.submitTransaction('CreateProvenance', recordKey, bundleHash, String(resourceCount), sourceSystem);
    return JSON.parse(decoder.decode(result));
  } finally {
    gateway.close();
    client.close();
  }
}

function writeJson(response, status, body) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': 'http://localhost:3000',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const parts = [];
  for await (const part of request) parts.push(part);
  const text = Buffer.concat(parts).toString('utf8');
  if (!text || text.length > 65536) throw new Error('Request body is missing or too large');
  return JSON.parse(text);
}

function validateRequest(body) {
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(body.recordKey || '')) throw new Error('recordKey must be a pseudonymized identifier');
  if (!/^[a-fA-F0-9]{64}$/.test(body.bundleHash || '')) throw new Error('bundleHash must be a SHA-256 hexadecimal digest');
  if (!Number.isInteger(body.resourceCount) || body.resourceCount < 1) throw new Error('resourceCount must be a positive integer');
  if (typeof body.sourceSystem !== 'string' || !body.sourceSystem.trim()) throw new Error('sourceSystem is required');
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return writeJson(response, 204, {});
  if (request.method === 'GET' && request.url === '/health') {
    return writeJson(response, 200, { status: 'ready', channelName, chaincodeName, peerEndpoint });
  }
  if (request.method !== 'POST' || request.url !== '/provenance') return writeJson(response, 404, { error: 'Route not found' });

  try {
    const body = await readJson(request);
    validateRequest(body);
    const provenance = await submitProvenance(body);
    return writeJson(response, 201, { ...provenance, committed: true });
  } catch (error) {
    return writeJson(response, 503, { error: error instanceof Error ? error.message : 'Fabric transaction failed' });
  }
});

server.listen(port, () => {
  console.log(`BlockClin Fabric Gateway is listening on http://127.0.0.1:${port}`);
});
