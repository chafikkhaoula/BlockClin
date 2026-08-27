'use client';

import { useEffect, useState, type ChangeEvent } from 'react';

type Observation = {
  label: string;
  value: string;
  unit?: string;
  code?: string;
  system?: string;
};

type Condition = {
  display: string;
  code?: string;
  system?: string;
};

type ClinicalRecord = {
  patientId: string;
  patientName: string;
  facility: string;
  sourceSystem: string;
  condition?: Condition;
  observations: Observation[];
};

type FhirBundle = {
  resourceType: 'Bundle';
  type: 'collection';
  timestamp: string;
  entry: Array<{ fullUrl: string; resource: Record<string, unknown> }>;
};

type LedgerEntry = {
  resource: string;
  hash: string;
  transactionId: string;
  createdAt: string;
};

type Delivery = {
  receipt: string;
  receivedAt: string;
  resourceCount: number;
};

type Validation = {
  valid: boolean;
  issues: string[];
  mappedFields: number;
};

type ExperimentProgress = {
  completed: number;
  total: number;
  phase: string;
};

type ExperimentRun = {
  id: string;
  startedAt: string;
  requestedRecords: number;
  completedRecords: number;
  failedRecords: number;
  resourceCount: number;
  preparationMs: number;
  validationMs: number;
  transformationMs: number;
  hashingMs: number;
  fabricMs: number;
  deliveryMs: number;
  totalMs: number;
  transactionIds: string[];
  status: 'completed' | 'failed';
  failure?: string;
};

const protocol = [
  ['Import', 'Read a de-identified JSON or CSV clinical record.'],
  ['Validate', 'Check mandatory elements for the target FHIR profile.'],
  ['Transform', 'Generate a FHIR R4 Bundle from the imported record.'],
  ['Anchor', 'Submit the SHA-256 fingerprint to the Hyperledger Fabric network.'],
  ['Send', 'POST the FHIR Bundle to the prototype receiving endpoint.'],
];

function valueFrom(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function parseCsvRow(row: string) {
  const cells: string[] = [];
  let cell = '';
  let insideQuotes = false;

  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (character === '"') {
      if (insideQuotes && row[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (character === ',' && !insideQuotes) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function csvToObject(text: string) {
  const rows = text.split(/\r?\n/).filter((row) => row.trim());
  if (rows.length < 2) throw new Error('CSV must contain a header and one clinical record.');
  const headings = parseCsvRow(rows[0]).map((heading) => heading.toLowerCase().replace(/\s+/g, '_'));
  const values = parseCsvRow(rows[1]);
  return Object.fromEntries(headings.map((heading, index) => [heading, values[index] ?? '']));
}

function readFhirBundle(input: Record<string, unknown>): ClinicalRecord | null {
  if (input.resourceType !== 'Bundle' || !Array.isArray(input.entry)) return null;
  const resources = input.entry
    .map((entry) => (entry && typeof entry === 'object' ? (entry as { resource?: Record<string, unknown> }).resource : undefined))
    .filter((resource): resource is Record<string, unknown> => Boolean(resource));
  const patient = resources.find((resource) => resource.resourceType === 'Patient');
  if (!patient) return null;

  const names = patient.name as Array<{ text?: string; given?: string[]; family?: string }> | undefined;
  const patientName = names?.[0]?.text || [names?.[0]?.given?.join(' '), names?.[0]?.family].filter(Boolean).join(' ');
  const identifiers = patient.identifier as Array<{ value?: string }> | undefined;
  const conditionResource = resources.find((resource) => resource.resourceType === 'Condition');
  const conditionCoding = conditionResource?.code as { text?: string; coding?: Array<{ display?: string; code?: string; system?: string }> } | undefined;
  const observations = resources
    .filter((resource) => resource.resourceType === 'Observation')
    .map((resource) => {
      const code = resource.code as { text?: string; coding?: Array<{ display?: string; code?: string; system?: string }> } | undefined;
      const quantity = resource.valueQuantity as { value?: number | string; unit?: string } | undefined;
      return {
        label: code?.text || code?.coding?.[0]?.display || 'Clinical observation',
        value: String(quantity?.value ?? resource.valueString ?? ''),
        unit: quantity?.unit,
        code: code?.coding?.[0]?.code,
        system: code?.coding?.[0]?.system,
      };
    })
    .filter((observation) => observation.value);

  return {
    patientId: patient.id as string || identifiers?.[0]?.value || '',
    patientName: patientName || '',
    facility: (patient.managingOrganization as { display?: string } | undefined)?.display || 'Imported FHIR source',
    sourceSystem: 'FHIR Bundle import',
    condition: conditionCoding?.text || conditionCoding?.coding?.[0]?.display
      ? { display: conditionCoding.text || conditionCoding.coding?.[0]?.display || '', code: conditionCoding.coding?.[0]?.code, system: conditionCoding.coding?.[0]?.system }
      : undefined,
    observations,
  };
}

function normalizeRecord(input: unknown): ClinicalRecord {
  if (!input || typeof input !== 'object') throw new Error('The file does not contain a readable clinical record.');
  const source = input as Record<string, unknown>;
  const fhirRecord = readFhirBundle(source);
  if (fhirRecord) return fhirRecord;

  const rawObservations = Array.isArray(source.observations) ? source.observations : [];
  const observations = rawObservations
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      label: valueFrom(item, ['label', 'name', 'test']) || 'Clinical observation',
      value: valueFrom(item, ['value', 'result']),
      unit: valueFrom(item, ['unit']),
      code: valueFrom(item, ['code']),
      system: valueFrom(item, ['system']),
    }))
    .filter((item) => item.value);

  const conditionInput = source.condition;
  const conditionObject = conditionInput && typeof conditionInput === 'object' ? conditionInput as Record<string, unknown> : undefined;
  const conditionText = typeof conditionInput === 'string'
    ? conditionInput
    : valueFrom(conditionObject ?? {}, ['display', 'name', 'diagnosis']) || valueFrom(source, ['diagnosis', 'condition_name']);
  const directGlucose = valueFrom(source, ['glucose', 'blood_glucose']);
  if (directGlucose && observations.length === 0) observations.push({ label: 'Blood glucose', value: directGlucose, unit: 'mg/dL', code: '2339-0', system: 'http://loinc.org' });

  return {
    patientId: valueFrom(source, ['patientId', 'patient_id', 'id', 'identifier']),
    patientName: valueFrom(source, ['patientName', 'patient_name', 'name']),
    facility: valueFrom(source, ['facility', 'institution', 'hospital']) || 'Unspecified source institution',
    sourceSystem: valueFrom(source, ['sourceSystem', 'source_system', 'source']) || 'Imported clinical file',
    condition: conditionText ? { display: conditionText, code: valueFrom(conditionObject ?? {}, ['code']), system: valueFrom(conditionObject ?? {}, ['system']) } : undefined,
    observations,
  };
}

function validateRecord(record: ClinicalRecord): Validation {
  const issues: string[] = [];
  if (!record.patientId) issues.push('Patient identifier is missing.');
  if (!record.patientName) issues.push('Patient name is missing.');
  if (!record.facility || record.facility === 'Unspecified source institution') issues.push('Source institution is missing.');
  if (!record.condition && record.observations.length === 0) issues.push('At least one clinical condition or observation is required.');
  return { valid: issues.length === 0, issues, mappedFields: 3 + (record.condition ? 1 : 0) + record.observations.length };
}

function buildBundle(record: ClinicalRecord): FhirBundle {
  const patient = {
    resourceType: 'Patient',
    id: record.patientId,
    identifier: [{ system: `urn:blockclin:${record.facility.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, value: record.patientId }],
    name: [{ text: record.patientName }],
    managingOrganization: { display: record.facility },
  };
  const entries: FhirBundle['entry'] = [{ fullUrl: `urn:uuid:patient-${record.patientId}`, resource: patient }];

  if (record.condition) {
    entries.push({
      fullUrl: `urn:uuid:condition-${record.patientId}`,
      resource: {
        resourceType: 'Condition',
        id: `condition-${record.patientId}`,
        subject: { reference: `Patient/${record.patientId}` },
        code: {
          text: record.condition.display,
          coding: record.condition.code ? [{ system: record.condition.system || 'http://snomed.info/sct', code: record.condition.code, display: record.condition.display }] : [],
        },
      },
    });
  }

  record.observations.forEach((observation, index) => {
    entries.push({
      fullUrl: `urn:uuid:observation-${record.patientId}-${index + 1}`,
      resource: {
        resourceType: 'Observation',
        id: `observation-${record.patientId}-${index + 1}`,
        status: 'final',
        subject: { reference: `Patient/${record.patientId}` },
        code: {
          text: observation.label,
          coding: observation.code ? [{ system: observation.system || 'http://loinc.org', code: observation.code, display: observation.label }] : [],
        },
        valueQuantity: { value: Number.isNaN(Number(observation.value)) ? observation.value : Number(observation.value), unit: observation.unit || undefined },
      },
    });
  });

  return { resourceType: 'Bundle', type: 'collection', timestamp: new Date().toISOString(), entry: entries };
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function displayHash(hash: string) {
  return `${hash.slice(0, 12)}...${hash.slice(-8)}`;
}

function formatMilliseconds(milliseconds: number) {
  if (milliseconds < 1000) return `${milliseconds.toFixed(0)} ms`;
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

function formatBenchmarkMilliseconds(milliseconds: number) {
  return `${milliseconds.toFixed(2)} ms`;
}

function formatBenchmarkSeconds(milliseconds: number) {
  return `${(milliseconds / 1000).toFixed(3)} s`;
}

function createBenchmarkRecord(runId: string, index: number) {
  const sequence = String(index + 1).padStart(3, '0');
  return {
    patient_id: `EXP-${runId}-${sequence}`,
    patient_name: `Study Patient ${sequence}`,
    hospital: 'BlockClin Evaluation Center',
    source_system: 'Synthetic de-identified benchmark',
    diagnosis: index % 2 === 0 ? 'Hypertension' : 'Type 2 diabetes mellitus',
    glucose: String(88 + (index % 34)),
  };
}

function csvValue(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export default function Home() {
  const [record, setRecord] = useState<ClinicalRecord | null>(null);
  const [fileName, setFileName] = useState('No file imported');
  const [stage, setStage] = useState(0);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [bundle, setBundle] = useState<FhirBundle | null>(null);
  const [hash, setHash] = useState('');
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [message, setMessage] = useState('Import a de-identified JSON, CSV, or FHIR Bundle file to begin.');
  const [busy, setBusy] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [experimentSize, setExperimentSize] = useState(10);
  const [experimentBusy, setExperimentBusy] = useState(false);
  const [experimentProgress, setExperimentProgress] = useState<ExperimentProgress | null>(null);
  const [experiments, setExperiments] = useState<ExperimentRun[]>([]);

  useEffect(() => {
    const savedLedger = localStorage.getItem('blockclin-ledger');
    const savedExperiments = localStorage.getItem('blockclin-experiments');
    const restoreTimer = window.setTimeout(() => {
      if (savedLedger) {
        try { setLedger(JSON.parse(savedLedger) as LedgerEntry[]); } catch { localStorage.removeItem('blockclin-ledger'); }
      }
      if (savedExperiments) {
        try { setExperiments(JSON.parse(savedExperiments) as ExperimentRun[]); } catch { localStorage.removeItem('blockclin-experiments'); }
      }
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    if (storageReady) localStorage.setItem('blockclin-ledger', JSON.stringify(ledger));
  }, [ledger, storageReady]);

  useEffect(() => {
    if (storageReady) localStorage.setItem('blockclin-experiments', JSON.stringify(experiments));
  }, [experiments, storageReady]);

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const contents = await file.text();
      const data = file.name.toLowerCase().endsWith('.csv') ? csvToObject(contents) : JSON.parse(contents);
      const imported = normalizeRecord(data);
      setRecord(imported);
      setFileName(file.name);
      setStage(1);
      setValidation(null);
      setBundle(null);
      setHash('');
      setDelivery(null);
      setMessage(`${file.name} was imported. Review the source record, then run validation.`);
    } catch (error) {
      setRecord(null);
      setStage(0);
      setMessage(error instanceof Error ? `Import failed: ${error.message}` : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  function runValidation() {
    if (!record) return;
    const result = validateRecord(record);
    setValidation(result);
    if (result.valid) {
      setStage(2);
      setMessage(`Validation passed. ${result.mappedFields} data elements are ready for FHIR transformation.`);
    } else {
      setMessage(`Validation found ${result.issues.length} issue(s). Correct the input file and import it again.`);
    }
  }

  function transformToFhir() {
    if (!record) return;
    const generatedBundle = buildBundle(record);
    setBundle(generatedBundle);
    setStage(3);
    setMessage(`FHIR Bundle generated with ${generatedBundle.entry.length} resources.`);
  }

  async function anchorWithFabric() {
    if (!bundle || !record) return;
    setBusy(true);
    try {
      const fingerprint = await sha256(JSON.stringify(bundle));
      setHash(fingerprint);
      const response = await fetch('/api/provenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordKey: record.patientId, bundleHash: fingerprint, resourceCount: bundle.entry.length, sourceSystem: record.sourceSystem }),
      });
      const result = await response.json() as { error?: string; transactionId?: string };
      if (!response.ok || !result.transactionId) throw new Error(result.error || 'Fabric did not return a transaction ID.');
      const entry: LedgerEntry = { resource: `Patient/${record.patientId}`, hash: fingerprint, transactionId: result.transactionId, createdAt: new Date().toLocaleString() };
      setLedger((entries) => [entry, ...entries]);
      setStage(4);
      setMessage(`Fabric committed transaction ${entry.transactionId}. The SHA-256 fingerprint is anchored on-chain.`);
    } catch (error) {
      setMessage(error instanceof Error ? `Fabric anchoring failed: ${error.message}` : 'Fabric anchoring failed.');
    } finally {
      setBusy(false);
    }
  }

  async function sendBundle() {
    if (!bundle) return;
    setBusy(true);
    try {
      const response = await fetch('/api/interop', { method: 'POST', headers: { 'Content-Type': 'application/fhir+json' }, body: JSON.stringify(bundle) });
      const result = await response.json() as Delivery & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Receiving endpoint rejected the FHIR Bundle.');
      setDelivery(result);
      setStage(5);
      setMessage(`Bundle received successfully. Receipt ${result.receipt} confirms the transfer.`);
    } catch (error) {
      setMessage(error instanceof Error ? `Send failed: ${error.message}` : 'Send failed.');
    } finally {
      setBusy(false);
    }
  }

  async function runExperiment() {
    setExperimentBusy(true);
    setExperimentProgress({ completed: 0, total: experimentSize, phase: 'Preparing benchmark records' });
    const startedAt = new Date().toISOString();
    const startedAtMs = performance.now();
    const runId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    let completedRecords = 0;
    let resourceCount = 0;
    let preparationMs = 0;
    let validationMs = 0;
    let transformationMs = 0;
    let hashingMs = 0;
    let fabricMs = 0;
    let deliveryMs = 0;
    const transactionIds: string[] = [];

    try {
      for (let index = 0; index < experimentSize; index += 1) {
        setExperimentProgress({ completed: index, total: experimentSize, phase: 'Preparing and validating FHIR record' });
        const preparationStart = performance.now();
        const benchmarkRecord = normalizeRecord(createBenchmarkRecord(runId, index));
        preparationMs += performance.now() - preparationStart;

        const validationStart = performance.now();
        const benchmarkValidation = validateRecord(benchmarkRecord);
        validationMs += performance.now() - validationStart;
        if (!benchmarkValidation.valid) throw new Error(`Benchmark validation failed for record ${index + 1}.`);

        setExperimentProgress({ completed: index, total: experimentSize, phase: 'Transforming FHIR Bundle' });
        const transformStart = performance.now();
        const benchmarkBundle = buildBundle(benchmarkRecord);
        transformationMs += performance.now() - transformStart;
        resourceCount += benchmarkBundle.entry.length;

        setExperimentProgress({ completed: index, total: experimentSize, phase: 'Hashing and committing to Fabric' });
        const hashStart = performance.now();
        const fingerprint = await sha256(JSON.stringify(benchmarkBundle));
        hashingMs += performance.now() - hashStart;

        const fabricStart = performance.now();
        const provenanceResponse = await fetch('/api/provenance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recordKey: benchmarkRecord.patientId,
            bundleHash: fingerprint,
            resourceCount: benchmarkBundle.entry.length,
            sourceSystem: benchmarkRecord.sourceSystem,
          }),
        });
        const provenanceResult = await provenanceResponse.json() as { error?: string; transactionId?: string };
        fabricMs += performance.now() - fabricStart;
        if (!provenanceResponse.ok || !provenanceResult.transactionId) throw new Error(provenanceResult.error || `Fabric did not commit record ${index + 1}.`);
        transactionIds.push(provenanceResult.transactionId);

        setExperimentProgress({ completed: index, total: experimentSize, phase: 'Sending Bundle to receiver' });
        const deliveryStart = performance.now();
        const deliveryResponse = await fetch('/api/interop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/fhir+json' },
          body: JSON.stringify(benchmarkBundle),
        });
        const deliveryResult = await deliveryResponse.json() as { error?: string };
        deliveryMs += performance.now() - deliveryStart;
        if (!deliveryResponse.ok) throw new Error(deliveryResult.error || `Receiver rejected record ${index + 1}.`);

        completedRecords += 1;
        setExperimentProgress({ completed: completedRecords, total: experimentSize, phase: 'Record completed' });
      }

      const completedRun: ExperimentRun = {
        id: runId,
        startedAt,
        requestedRecords: experimentSize,
        completedRecords,
        failedRecords: 0,
        resourceCount,
        preparationMs,
        validationMs,
        transformationMs,
        hashingMs,
        fabricMs,
        deliveryMs,
        totalMs: performance.now() - startedAtMs,
        transactionIds,
        status: 'completed',
      };
      setExperiments((runs) => [completedRun, ...runs].slice(0, 12));
      setMessage(`Experiment completed: ${completedRecords}/${experimentSize} records committed to Fabric and delivered.`);
    } catch (error) {
      const failedRun: ExperimentRun = {
        id: runId,
        startedAt,
        requestedRecords: experimentSize,
        completedRecords,
        failedRecords: experimentSize - completedRecords,
        resourceCount,
        preparationMs,
        validationMs,
        transformationMs,
        hashingMs,
        fabricMs,
        deliveryMs,
        totalMs: performance.now() - startedAtMs,
        transactionIds,
        status: 'failed',
        failure: error instanceof Error ? error.message : 'Unknown benchmark failure.',
      };
      setExperiments((runs) => [failedRun, ...runs].slice(0, 12));
      setMessage(`Experiment stopped after ${completedRecords}/${experimentSize} records. ${failedRun.failure}`);
    } finally {
      setExperimentProgress(null);
      setExperimentBusy(false);
    }
  }

  function downloadExperiments() {
    if (experiments.length === 0) return;
    const columns = ['run_id', 'started_at', 'status', 'requested_records', 'completed_records', 'failed_records', 'fhir_resources', 'preparation_ms', 'validation_ms', 'transformation_ms', 'hashing_ms', 'fabric_commit_ms', 'receiver_delivery_ms', 'total_ms', 'throughput_records_per_second', 'transaction_ids', 'failure'];
    const rows = experiments.map((run) => {
      const throughput = run.completedRecords === 0 ? 0 : run.completedRecords / (run.totalMs / 1000);
      return [run.id, run.startedAt, run.status, run.requestedRecords, run.completedRecords, run.failedRecords, run.resourceCount, run.preparationMs.toFixed(2), run.validationMs.toFixed(2), run.transformationMs.toFixed(2), run.hashingMs.toFixed(2), run.fabricMs.toFixed(2), run.deliveryMs.toFixed(2), run.totalMs.toFixed(2), throughput.toFixed(3), run.transactionIds.join('|'), run.failure || ''].map(csvValue).join(',');
    });
    const blob = new Blob([[columns.join(','), ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'blockclin-experiment-results.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadBundle() {
    if (!bundle) return;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${record?.patientId || 'clinical-record'}-fhir-bundle.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function resetRun() {
    setRecord(null);
    setFileName('No file imported');
    setStage(0);
    setValidation(null);
    setBundle(null);
    setHash('');
    setDelivery(null);
    setMessage('Ready for a new imported record.');
  }

  const action = stage === 1 ? { label: 'Run FHIR validation', handler: runValidation }
    : stage === 2 ? { label: 'Generate FHIR Bundle', handler: transformToFhir }
      : stage === 3 ? { label: 'Hash and submit to Fabric', handler: anchorWithFabric }
        : stage === 4 ? { label: 'Send FHIR Bundle to receiver', handler: sendBundle }
          : null;

  const sourceFields = record ? [
    ['Patient identifier', record.patientId, 'Patient.identifier'],
    ['Patient name', record.patientName, 'Patient.name'],
    ...(record.condition ? [['Diagnosis', record.condition.display, 'Condition.code']] : []),
    ...record.observations.map((observation) => [observation.label, `${observation.value}${observation.unit ? ` ${observation.unit}` : ''}`, 'Observation.valueQuantity']),
  ] : [];

  return (
    <main className="research-app">
      <header className="app-header">
        <div className="brand"><span className="brand-mark" aria-hidden="true" /><div><strong>BlockClin</strong><small>FHIR exchange and provenance prototype</small></div></div>
        <span className="prototype-badge">Local research environment</span>
      </header>

      <section className="intro">
        <p className="kicker">Executable research workflow</p>
        <h1>Import, transform, anchor, and transfer a clinical record.</h1>
        <p>The app reads an actual de-identified file, produces a FHIR Bundle, submits its SHA-256 fingerprint to Hyperledger Fabric, and sends the bundle to the prototype receiver.</p>
      </section>

      <section className="run-layout">
        <aside className="protocol-card panel">
          <p className="kicker">Protocol</p>
          <h2>Clinical data run</h2>
          <ol className="workflow-list">
            {protocol.map(([name, description], index) => <li key={name} className={index < stage ? 'done' : index === stage ? 'current' : ''}><span>{index < stage ? 'OK' : index + 1}</span><div><strong>{name}</strong><small>{description}</small></div></li>)}
          </ol>
          <div className="run-status"><span>{stage === 5 ? 'Transfer completed' : stage === 0 ? 'Waiting for import' : `Step ${stage + 1} of 5`}</span><p>{message}</p></div>
        </aside>

        <section className="main-panel panel">
          <div className="panel-heading"><div><p className="kicker">Input and transformation</p><h2>Clinical record</h2></div><span className="fhir-badge">FHIR R4 output</span></div>

          <div className="import-area">
            <label className="file-button" htmlFor="clinical-file">Choose JSON or CSV file</label>
            <input id="clinical-file" type="file" accept=".json,.csv,application/json,text/csv,application/fhir+json" onChange={importFile} />
            <span>{busy ? 'Processing file...' : fileName}</span>
            <a href="/sample-clinical-record.json" download>Download de-identified sample</a>
          </div>

          {record ? <>
            <div className="source-summary"><div><span>Origin</span><strong>{record.facility}</strong></div><div><span>Source system</span><strong>{record.sourceSystem}</strong></div><div><span>Patient ID</span><strong>{record.patientId}</strong></div></div>
            <div className="record-card">
              <div className="record-title"><div className="patient-avatar">{record.patientName.split(' ').map((part) => part[0]).join('')}</div><div><span>Imported patient record</span><h3>{record.patientName}</h3></div></div>
              <div className="mapping-table"><div className="table-head"><span>Source field</span><span>Clinical value</span><span>FHIR target</span></div>{sourceFields.map(([field, value, target]) => <div className="table-row" key={`${field}-${target}`}><span>{field}</span><span>{value}</span><code>{target}</code></div>)}</div>
            </div>
          </> : <div className="empty-record"><strong>No clinical file loaded</strong><p>Choose a JSON or CSV record. You can use the de-identified sample to test the complete process.</p></div>}

          {validation && !validation.valid && <div className="validation-errors"><strong>Validation issues</strong>{validation.issues.map((issue) => <span key={issue}>{issue}</span>)}</div>}
          {action && <button className="action-button" type="button" disabled={busy || experimentBusy} onClick={action.handler}>{busy ? 'Working...' : action.label}</button>}
          {bundle && <button className="secondary-button" type="button" onClick={downloadBundle}>Download generated FHIR Bundle</button>}
          {stage === 5 && <button className="restart-button" type="button" onClick={resetRun}>Start a new imported record</button>}
        </section>

        <aside className="evidence-card panel">
          <p className="kicker">Measured output</p>
          <h2>Evidence for evaluation</h2>
          <div className="result-list">
            <div><span>Imported file</span><strong>{record ? 'Loaded' : 'Pending'}</strong></div>
            <div><span>FHIR validation</span><strong>{validation?.valid ? 'Passed' : validation ? 'Failed' : 'Pending'}</strong></div>
            <div><span>FHIR resources</span><strong>{bundle ? bundle.entry.length : 'Pending'}</strong></div>
            <div><span>Fabric transaction</span><strong className="hash-value">{ledger[0]?.transactionId ? displayHash(ledger[0].transactionId) : 'Pending'}</strong></div>
            <div><span>Transfer receipt</span><strong>{delivery?.receipt || 'Pending'}</strong></div>
          </div>
          <p className="evidence-note">For the article, log validation outcome, transformation time, resource count, hash creation time, and delivery receipt for every run.</p>
        </aside>
      </section>

      <section className="ledger-section panel">
        <div className="panel-heading"><div><p className="kicker">Fabric transaction log</p><h2>Blockchain provenance</h2></div><span className="ledger-explainer">Only the fingerprint is stored on-chain</span></div>
        {ledger.length === 0 ? <div className="empty-ledger"><span>No Fabric transaction recorded</span><p>After transformation, the app calculates a SHA-256 hash and submits it through the Fabric Gateway.</p></div> : <div className="ledger-entry"><span className="ledger-state">Committed</span><div><strong>{ledger[0].resource}</strong><small>{ledger[0].createdAt}</small></div><code>{displayHash(ledger[0].hash)}</code><span>{displayHash(ledger[0].transactionId)}</span></div>}
      </section>

      <section className="experiment-section panel">
        <div className="panel-heading"><div><p className="kicker">Research evaluation</p><h2>Experiment mode</h2></div><span className="experiment-badge">Real Fabric commits</span></div>
        <p className="experiment-intro">Generate de-identified benchmark records and run the same validation, FHIR transformation, SHA-256, Fabric commitment, and receiver delivery workflow. Only fingerprints are submitted on-chain.</p>
        <div className="experiment-controls">
          <label><span>Benchmark size</span><select value={experimentSize} disabled={experimentBusy || busy} onChange={(event) => setExperimentSize(Number(event.target.value))}><option value={1}>1 record</option><option value={10}>10 records</option><option value={50}>50 records</option><option value={100}>100 records</option></select></label>
          <button className="experiment-run" type="button" disabled={experimentBusy || busy} onClick={runExperiment}>{experimentBusy ? 'Running real benchmark...' : 'Run benchmark'}</button>
        </div>
        <div className="experiment-status" aria-live="polite"><strong>{experimentBusy && experimentProgress ? `${experimentProgress.completed}/${experimentProgress.total} records` : 'Ready for evaluation'}</strong><span>{experimentBusy && experimentProgress ? experimentProgress.phase : 'Each selected record creates a real Fabric transaction and receiver receipt.'}</span></div>
        {experiments.length > 0 && <>
          <div className="experiment-summary">
            {(() => {
              const latest = experiments[0];
              const completed = Math.max(latest.completedRecords, 1);
              const throughput = latest.completedRecords === 0 ? 0 : latest.completedRecords / (latest.totalMs / 1000);
              return <><div><span>Latest run</span><strong>{latest.completedRecords}/{latest.requestedRecords}</strong></div><div><span>Fabric avg / record</span><strong>{formatMilliseconds(latest.fabricMs / completed)}</strong></div><div><span>Total time</span><strong>{formatMilliseconds(latest.totalMs)}</strong></div><div><span>Throughput</span><strong>{throughput.toFixed(2)} rec/s</strong></div></>;
            })()}
          </div>
          <div className="experiment-history"><div className="experiment-history-head"><span>Run</span><span>Records</span><span>FHIR</span><span>Fabric avg</span><span>Delivery avg</span><span>Total time</span><span>Status</span></div>{experiments.map((run) => { const completed = Math.max(run.completedRecords, 1); return <div className="experiment-history-row" key={run.id}><code>{run.id.slice(0, 12)}</code><span>{run.completedRecords}/{run.requestedRecords}</span><span>{run.resourceCount}</span><span>{formatBenchmarkSeconds(run.fabricMs / completed)}</span><span>{formatBenchmarkMilliseconds(run.deliveryMs / completed)}</span><span>{formatMilliseconds(run.totalMs)}</span><strong className={run.status === 'completed' ? 'experiment-complete' : 'experiment-failed'} title={run.failure}>{run.status}</strong></div>; })}</div>
          {experiments.find((run) => run.failure)?.failure && <p className="experiment-failure-note">Recorded failure: {experiments.find((run) => run.failure)?.failure}</p>}
          <button className="download-experiments" type="button" onClick={downloadExperiments}>Download experiment results CSV</button>
        </>}
      </section>
    </main>
  );
}
