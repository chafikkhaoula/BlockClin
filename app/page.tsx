'use client';

import { useState } from 'react';

type LedgerEvent = {
  action: string;
  resource: string;
  version: string;
  institution: string;
  time: string;
  hash: string;
  status: 'Verified' | 'Anchored';
};

const patients = [
  { id: 'P-001', initials: 'AR', name: 'Amina Rahmani', hospital: 'Marrakech University Hospital', updated: '4 min ago', status: 'Ready' },
  { id: 'P-002', initials: 'YK', name: 'Youssef Khalil', hospital: 'Ibn Sina Hospital', updated: '22 min ago', status: 'Needs mapping' },
  { id: 'P-003', initials: 'SB', name: 'Salma Bennani', hospital: 'Cheikh Khalifa Hospital', updated: '1 h ago', status: 'Ready' },
  { id: 'P-004', initials: 'OM', name: 'Omar Mernissi', hospital: 'Marrakech University Hospital', updated: '2 h ago', status: 'Ready' },
];

const sourceFields = [
  ['Patient name', 'Amina Rahmani', 'Patient.name'],
  ['Blood group', 'A positive', 'Observation.code'],
  ['Glucose level', '104 mg/dL', 'Observation.valueQuantity'],
  ['Diagnosis', 'Type 2 diabetes', 'Condition.code'],
];

const initialLedger: LedgerEvent[] = [
  { action: 'FHIR resource updated', resource: 'Observation/glucose', version: 'v3', institution: 'Marrakech University Hospital', time: 'Today, 09:42', hash: '0x83a1...f21c', status: 'Verified' },
  { action: 'Semantic mapping approved', resource: 'Condition/diabetes', version: 'v2', institution: 'Ibn Sina Hospital', time: 'Yesterday, 16:08', hash: '0x4be9...d607', status: 'Verified' },
  { action: 'Clinical record imported', resource: 'Patient/P-001', version: 'v1', institution: 'Marrakech University Hospital', time: '12 Aug, 10:31', hash: '0xac72...94ef', status: 'Anchored' },
];

export default function Home() {
  const [activeView, setActiveView] = useState('Workspace');
  const [selectedPatient, setSelectedPatient] = useState(patients[0]);
  const [recordVersion, setRecordVersion] = useState(3);
  const [ledger, setLedger] = useState(initialLedger);
  const [notice, setNotice] = useState('FHIR profile validated and ready for exchange.');

  function harmonizeRecord() {
    const nextVersion = recordVersion + 1;
    setRecordVersion(nextVersion);
    setLedger((events) => [
      {
        action: 'FHIR resource harmonized',
        resource: 'Patient/P-001',
        version: `v${nextVersion}`,
        institution: 'BlockClin semantic engine',
        time: 'Just now',
        hash: `0x${Math.random().toString(16).slice(2, 10)}...c14b`,
        status: 'Anchored',
      },
      ...events,
    ]);
    setNotice(`Version v${nextVersion} has been harmonized and anchored to the provenance ledger.`);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <div>
            <strong>BlockClin</strong>
            <small>Clinical data workspace</small>
          </div>
        </div>

        <nav aria-label="Main navigation">
          {['Workspace', 'Patients', 'Interoperability', 'Provenance ledger'].map((item) => (
            <button
              className={activeView === item ? 'nav-item active' : 'nav-item'}
              key={item}
              onClick={() => setActiveView(item)}
              type="button"
            >
              <span className="nav-dot" aria-hidden="true" />
              {item}
            </button>
          ))}
        </nav>

        <div className="side-note">
          <span className="eyebrow">Network</span>
          <strong>3 institutions</strong>
          <p>Permissioned provenance network</p>
          <div className="network-people" aria-label="Three connected institutions"><i>MU</i><i>IS</i><i>CK</i></div>
        </div>

        <div className="profile-mini">
          <div className="avatar dark">KA</div>
          <div><strong>Researcher</strong><small>Clinical informatics</small></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{activeView}</p>
            <h1>Clinical interoperability, made traceable.</h1>
          </div>
          <div className="header-actions">
            <span className="network-live"><b /> Network online</span>
            <button className="quiet-button" type="button" onClick={() => setNotice('New FHIR import workspace is ready.')}>+ Import clinical data</button>
          </div>
        </header>

        <section className="metrics" aria-label="Network summary">
          <article><span>Clinical records</span><strong>1,284</strong><small>+18 this week</small></article>
          <article><span>FHIR conformance</span><strong>96.8%</strong><small>Across connected sites</small></article>
          <article><span>Anchored versions</span><strong>{42 + recordVersion}</strong><small>Immutable provenance</small></article>
        </section>

        <div className="work-grid">
          <section className="patient-panel card">
            <div className="section-heading"><div><p className="eyebrow">Patients</p><h2>Shared clinical records</h2></div><button className="text-button" type="button">View all</button></div>
            <div className="patient-list">
              {patients.map((patient) => (
                <button
                  key={patient.id}
                  className={selectedPatient.id === patient.id ? 'patient-row selected' : 'patient-row'}
                  onClick={() => { setSelectedPatient(patient); setNotice(`${patient.name}'s FHIR record is loaded.`); }}
                  type="button"
                >
                  <div className="avatar">{patient.initials}</div>
                  <span className="patient-copy"><strong>{patient.name}</strong><small>{patient.hospital}</small></span>
                  <span className={patient.status === 'Ready' ? 'state ready' : 'state mapping'}>{patient.status}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="record-panel card">
            <div className="record-top">
              <div className="person-title"><div className="avatar large">{selectedPatient.initials}</div><div><p className="eyebrow">FHIR Patient / {selectedPatient.id}</p><h2>{selectedPatient.name}</h2><span>{selectedPatient.hospital} <b>•</b> Last updated {selectedPatient.updated}</span></div></div>
              <span className="version-pill">Version v{recordVersion}</span>
            </div>

            <div className="record-tabs"><button className="tab active" type="button">Clinical snapshot</button><button className="tab" type="button" onClick={() => setNotice('FHIR JSON is available in the research export.')}>FHIR structure</button><button className="tab" type="button" onClick={() => setNotice('All changes are listed in the provenance ledger.')}>Version history</button></div>

            <div className="clinical-cards">
              <article className="clinical-card primary"><p>Active condition</p><strong>Type 2 diabetes</strong><span>SNOMED CT: 44054006</span></article>
              <article className="clinical-card"><p>Latest glucose</p><strong>104 <small>mg/dL</small></strong><span>LOINC: 1558-6</span></article>
              <article className="clinical-card"><p>Blood group</p><strong>A positive</strong><span>FHIR Observation</span></article>
            </div>

            <div className="mapping-block">
              <div className="mapping-head"><div><p className="eyebrow">Semantic interoperability</p><h3>Source-to-FHIR mapping</h3></div><span className="validated">Validated</span></div>
              <div className="field-table">
                <div className="field-header"><span>Source field</span><span>Value</span><span>FHIR target</span></div>
                {sourceFields.map(([field, value, target]) => <div className="field-row" key={field}><span>{field}</span><span>{value}</span><code>{target}</code></div>)}
              </div>
              <button className="primary-button" type="button" onClick={harmonizeRecord}>Harmonize and anchor version</button>
            </div>
            <p className="record-notice" role="status">{notice}</p>
          </section>

          <aside className="ledger-panel card">
            <div className="section-heading"><div><p className="eyebrow">Blockchain provenance</p><h2>Version ledger</h2></div><span className="ledger-dot" aria-hidden="true" /></div>
            <p className="ledger-intro">Clinical files stay with institutions. Only the hash, version and provenance are anchored.</p>
            <div className="timeline">
              {ledger.map((event, index) => (
                <article className="ledger-event" key={`${event.hash}-${index}`}>
                  <span className="timeline-dot" aria-hidden="true" />
                  <div><strong>{event.action}</strong><code>{event.resource} · {event.version}</code><small>{event.institution}<br />{event.time}</small><div className="hash-row"><span>{event.hash}</span><b>{event.status}</b></div></div>
                </article>
              ))}
            </div>
            <button className="outline-button" type="button" onClick={() => setNotice('Ledger export prepared for evaluation results.')}>Export provenance log</button>
          </aside>
        </div>
      </section>
    </main>
  );
}
