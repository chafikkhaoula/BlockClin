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
  version: string;
  resource: string;
  hash: string;
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

const protocol = [
  ['Import', 'Read a de-identified JSON or CSV clinical record.'],
  ['Validate', 'Check mandatory elements for the target FHIR profile.'],
  ['Transform', 'Generate a FHIR R4 Bundle from the imported record.'],
  ['Anchor', 'Calculate SHA-256 and record the data version locally.'],
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
  const conditionText = typeof conditionInput === 'string' ? conditionInput : valueFrom(conditionObject ?? {}, ['display', 'name', 'diagnosis']);
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

  useEffect(() => {
    const savedLedger = localStorage.getItem('blockclin-ledger');
    if (savedLedger) {
      try { setLedger(JSON.parse(savedLedger) as LedgerEntry[]); } catch { localStorage.removeItem('blockclin-ledger'); }
    }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (storageReady) localStorage.setItem('blockclin-ledger', JSON.stringify(ledger));
  }, [ledger, storageReady]);

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

  async function anchorVersion() {
    if (!bundle || !record) return;
    setBusy(true);
    try {
      const fingerprint = await sha256(JSON.stringify(bundle));
      const entry: LedgerEntry = { version: `v${ledger.length + 1}`, resource: `Patient/${record.patientId}`, hash: fingerprint, createdAt: new Date().toLocaleString() };
      setLedger((entries) => [entry, ...entries]);
      setHash(fingerprint);
      setStage(4);
      setMessage(`Version ${entry.version} anchored with a SHA-256 provenance hash.`);
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
      : stage === 3 ? { label: 'Hash and record provenance', handler: anchorVersion }
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
        <p>The app reads an actual de-identified file, produces a FHIR Bundle, calculates a SHA-256 fingerprint, and sends the bundle to the prototype receiver.</p>
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
          {action && <button className="action-button" type="button" disabled={busy} onClick={action.handler}>{busy ? 'Working...' : action.label}</button>}
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
            <div><span>SHA-256 hash</span><strong className="hash-value">{hash ? displayHash(hash) : 'Pending'}</strong></div>
            <div><span>Transfer receipt</span><strong>{delivery?.receipt || 'Pending'}</strong></div>
          </div>
          <p className="evidence-note">For the article, log validation outcome, transformation time, resource count, hash creation time, and delivery receipt for every run.</p>
        </aside>
      </section>

      <section className="ledger-section panel">
        <div className="panel-heading"><div><p className="kicker">Version and delivery log</p><h2>Local provenance ledger</h2></div><span className="ledger-explainer">Only the fingerprint is recorded</span></div>
        {ledger.length === 0 ? <div className="empty-ledger"><span>No versions recorded</span><p>After transformation, the app calculates a SHA-256 hash and saves a version entry on this device.</p></div> : <div className="ledger-entry"><span className="ledger-state">Anchored</span><div><strong>{ledger[0].resource} - {ledger[0].version}</strong><small>{ledger[0].createdAt}</small></div><code>{displayHash(ledger[0].hash)}</code><span>{delivery ? `Delivered: ${delivery.receipt}` : 'Not sent yet'}</span></div>}
      </section>
    </main>
  );
}
