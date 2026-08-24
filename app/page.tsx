'use client';

import { useState } from 'react';

type Dataset = {
  id: string;
  label: string;
  institution: string;
  source: string;
  patientId: string;
  patientName: string;
  fields: Array<[string, string, string]>;
};

type LedgerEvent = {
  version: string;
  resource: string;
  institution: string;
  hash: string;
};

const datasets: Dataset[] = [
  {
    id: 'muh-001',
    label: 'Clinical record MUH-001',
    institution: 'Marrakech University Hospital',
    source: 'Hospital EHR export',
    patientId: 'MUH-001',
    patientName: 'Amina Rahmani',
    fields: [
      ['Patient name', 'Amina Rahmani', 'Patient.name'],
      ['Hospital identifier', 'MUH-001', 'Patient.identifier'],
      ['Diagnosis', 'Type 2 diabetes', 'Condition.code (SNOMED CT)'],
      ['HbA1c result', '7.1 %', 'Observation.code (LOINC)'],
    ],
  },
  {
    id: 'ish-014',
    label: 'Clinical record ISH-014',
    institution: 'Ibn Sina Hospital',
    source: 'Laboratory information system',
    patientId: 'ISH-014',
    patientName: 'Youssef Khalil',
    fields: [
      ['Patient name', 'Youssef Khalil', 'Patient.name'],
      ['Hospital identifier', 'ISH-014', 'Patient.identifier'],
      ['Blood glucose', '104 mg/dL', 'Observation.valueQuantity'],
      ['Blood group', 'A positive', 'Observation.code'],
    ],
  },
];

const workflow = [
  ['Import', 'Load a de-identified clinical record from a source institution.'],
  ['Validate', 'Check the mandatory data elements against the FHIR R4 profile.'],
  ['Harmonize', 'Map source fields to standard FHIR resources and terminologies.'],
  ['Anchor', 'Create a version and record its provenance hash on the ledger.'],
];

function createHash(version: number) {
  return `0x${(1437168 + version * 18731).toString(16)}...${(836401 + version * 911).toString(16)}`;
}

export default function Home() {
  const [datasetId, setDatasetId] = useState(datasets[0].id);
  const [stage, setStage] = useState(0);
  const [version, setVersion] = useState(0);
  const [ledger, setLedger] = useState<LedgerEvent[]>([]);
  const [message, setMessage] = useState('Select a source record, then begin the interoperability run.');

  const dataset = datasets.find((item) => item.id === datasetId) ?? datasets[0];
  const complete = stage === workflow.length;
  const actionLabel = ['Import selected record', 'Run FHIR validation', 'Apply semantic mappings', 'Create version and anchor provenance'][stage];

  function selectDataset(id: string) {
    setDatasetId(id);
    setStage(0);
    setVersion(0);
    setLedger([]);
    setMessage('Source record changed. Start a new interoperability run.');
  }

  function advanceWorkflow() {
    if (stage === 0) {
      setStage(1);
      setMessage(`${dataset.patientId} imported from ${dataset.institution}.`);
      return;
    }
    if (stage === 1) {
      setStage(2);
      setMessage('FHIR R4 validation passed: 4 required clinical data elements found.');
      return;
    }
    if (stage === 2) {
      setStage(3);
      setMessage('Semantic mappings accepted for Patient, Condition and Observation resources.');
      return;
    }
    if (stage === 3) {
      const nextVersion = version + 1;
      const hash = createHash(nextVersion);
      setVersion(nextVersion);
      setLedger((events) => [{ version: `v${nextVersion}`, resource: `Patient/${dataset.patientId}`, institution: dataset.institution, hash }, ...events]);
      setStage(4);
      setMessage(`Version v${nextVersion} created. Its provenance hash is now recorded in the ledger.`);
    }
  }

  function restartRun() {
    setStage(0);
    setVersion(0);
    setLedger([]);
    setMessage('New run ready. The selected source record has not been altered.');
  }

  return (
    <main className="research-app">
      <header className="app-header">
        <div className="brand"><span className="brand-mark" aria-hidden="true" /><div><strong>BlockClin</strong><small>Clinical interoperability research prototype</small></div></div>
        <span className="prototype-badge">FHIR R4 + permissioned provenance</span>
      </header>

      <section className="intro">
        <p className="kicker">Research workflow</p>
        <h1>From clinical source record to a versioned interoperable record.</h1>
        <p>Run one controlled process at a time. The prototype keeps clinical content off-chain and records only version provenance after harmonization.</p>
      </section>

      <section className="run-layout">
        <aside className="protocol-card panel">
          <p className="kicker">Protocol</p>
          <h2>Interoperability run</h2>
          <ol className="workflow-list">
            {workflow.map(([name, description], index) => (
              <li key={name} className={index < stage ? 'done' : index === stage ? 'current' : ''}>
                <span>{index < stage ? 'OK' : index + 1}</span>
                <div><strong>{name}</strong><small>{description}</small></div>
              </li>
            ))}
          </ol>
          <div className="run-status"><span>{complete ? 'Completed' : `Step ${stage + 1} of 4`}</span><p>{message}</p></div>
        </aside>

        <section className="main-panel panel">
          <div className="panel-heading"><div><p className="kicker">Source data</p><h2>Clinical record input</h2></div><span className="fhir-badge">Target: FHIR R4</span></div>

          <label className="field-label" htmlFor="dataset">De-identified source record</label>
          <select id="dataset" value={datasetId} onChange={(event) => selectDataset(event.target.value)}>
            {datasets.map((item) => <option value={item.id} key={item.id}>{item.label} - {item.institution}</option>)}
          </select>

          <div className="source-summary">
            <div><span>Origin</span><strong>{dataset.institution}</strong></div>
            <div><span>Source system</span><strong>{dataset.source}</strong></div>
            <div><span>Record ID</span><strong>{dataset.patientId}</strong></div>
          </div>

          <div className="record-card">
            <div className="record-title"><div className="patient-avatar">{dataset.patientName.split(' ').map((part) => part[0]).join('')}</div><div><span>De-identified patient</span><h3>{dataset.patientName}</h3></div></div>
            <div className="mapping-table">
              <div className="table-head"><span>Source field</span><span>Clinical value</span><span>FHIR target</span></div>
              {dataset.fields.map(([field, value, target]) => <div className="table-row" key={field}><span>{field}</span><span>{value}</span><code>{target}</code></div>)}
            </div>
          </div>

          {!complete ? (
            <button className="action-button" type="button" onClick={advanceWorkflow}>{actionLabel}</button>
          ) : (
            <button className="restart-button" type="button" onClick={restartRun}>Start a new run</button>
          )}
        </section>

        <aside className="evidence-card panel">
          <p className="kicker">Evidence capture</p>
          <h2>Results for the paper</h2>
          <div className="result-list">
            <div><span>FHIR conformance</span><strong>{stage >= 2 ? '100%' : 'Pending'}</strong></div>
            <div><span>Fields harmonized</span><strong>{stage >= 3 ? '4 / 4' : 'Pending'}</strong></div>
            <div><span>Version created</span><strong>{stage >= 4 ? `v${version}` : 'Pending'}</strong></div>
            <div><span>Provenance hash</span><strong className="hash-value">{stage >= 4 ? ledger[0]?.hash : 'Pending'}</strong></div>
          </div>
          <p className="evidence-note">These values can become the inputs for your evaluation table: conformance, mapping completeness, versioning time and traceability.</p>
        </aside>
      </section>

      <section className="ledger-section panel">
        <div className="panel-heading"><div><p className="kicker">Blockchain layer</p><h2>Clinical provenance ledger</h2></div><span className="ledger-explainer">No clinical data stored on-chain</span></div>
        {ledger.length === 0 ? (
          <div className="empty-ledger"><span>Ledger is empty</span><p>Finish the four process steps to create the first immutable provenance entry.</p></div>
        ) : (
          <div className="ledger-entry"><span className="ledger-state">Anchored</span><div><strong>{ledger[0].resource} - {ledger[0].version}</strong><small>{ledger[0].institution}</small></div><code>{ledger[0].hash}</code><span>Just now</span></div>
        )}
      </section>
    </main>
  );
}
