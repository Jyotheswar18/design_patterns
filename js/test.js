const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Set test database path to avoid polluting production database.json
const testDbPath = path.join(__dirname, 'test_database.json');
process.env.DB_FILE_PATH = testDbPath;

const DatabaseEngine = require('../server/db');
const { TriageAssessment, TriageFactory } = require('../server/patterns/factory');
const { PatientVisit, StateFactory } = require('../server/patterns/state');
const HospitalQueueFacade = require('../server/patterns/facade');
const { Patient, Doctor, Bed, QueueEntry } = HospitalQueueFacade;

let passedTests = 0;
let totalTests = 13;

function runTest(name, fn) {
  try {
    process.stdout.write(`Running Test: ${name}... `);
    fn();
    console.log('PASSED');
    passedTests++;
  } catch (err) {
    console.log('FAILED');
    console.error(err);
    process.exitCode = 1;
  }
}

async function runAsyncTest(name, fn) {
  try {
    process.stdout.write(`Running Test: ${name}... `);
    await fn();
    console.log('PASSED');
    passedTests++;
  } catch (err) {
    console.log('FAILED');
    console.error(err);
    process.exitCode = 1;
  }
}

async function runAllTests() {
  console.log('========================================================');
  console.log(' HOSPITAL QUEUE MANAGEMENT SYSTEM — FULL TEST SUITE');
  console.log(' Testing 6 Models, 3 Design Patterns, and 13 Workflows');
  console.log('========================================================\n');

  // Prepare clean test database
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  const db = DatabaseEngine.getInstance(testDbPath);
  await db.resetData({
    patients: [],
    patientVisits: [],
    triageAssessments: [],
    queueEntries: [],
    doctors: [
      { id: 'DOC-01', name: 'Dr. Jane Miller', specialty: 'Emergency Medicine', availabilityStatus: 'Available', currentVisitId: null },
      { id: 'DOC-02', name: 'Dr. John Watson', specialty: 'General Practice', availabilityStatus: 'Available', currentVisitId: null }
    ],
    beds: [
      { id: 'BED-ICU-01', ward: 'ICU', availabilityStatus: 'Available', allocatedVisitId: null, dailyRate: 2500 },
      { id: 'BED-GW-01', ward: 'General Ward', availabilityStatus: 'Available', allocatedVisitId: null, dailyRate: 600 }
    ]
  });

  const facade = new HospitalQueueFacade(db);

  // 1. Patient Registration
  let testPatient1, testPatient2;
  await runAsyncTest('1. Patient Registration & Validation', async () => {
    // Valid patient registration
    testPatient1 = await facade.registerPatient({
      name: 'Alice Henderson',
      age: 42,
      gender: 'Female',
      contactNumber: '555-0199',
      medicalAlerts: 'Penicillin allergy'
    });
    assert(testPatient1.id.startsWith('PAT-'), 'Patient ID should be generated');
    assert.strictEqual(testPatient1.name, 'Alice Henderson');

    // Second patient
    testPatient2 = await facade.registerPatient({
      name: 'Robert Davis',
      age: 68,
      gender: 'Male',
      contactNumber: '555-0288',
      medicalAlerts: 'Hypertension, Diabetic'
    });

    // Verification from DB
    const fetched = db.getPatientById(testPatient1.id);
    assert.strictEqual(fetched.name, 'Alice Henderson');
  });

  // 2. Visit creation for a patient
  let testVisit1, testVisit2;
  await runAsyncTest('2. Visit Creation for Registered Patient', async () => {
    testVisit1 = await facade.createVisit(testPatient1.id, { reason: 'Severe chest discomfort' });
    assert(testVisit1.id.startsWith('VIS-'), 'Visit ID should be generated');
    assert.strictEqual(testVisit1.patientId, testPatient1.id);
    assert.strictEqual(testVisit1.currentState, 'Awaiting Triage');

    testVisit2 = await facade.createVisit(testPatient2.id, { reason: 'Routine prescription renewal' });
    assert.strictEqual(testVisit2.currentState, 'Awaiting Triage');
  });

  // 3. Creation of a triage assessment through TriageFactory
  let emergencyAssessment, routineAssessment;
  runTest('3. Triage Assessment Creation through TriageFactory', () => {
    // Emergency category
    emergencyAssessment = TriageFactory.createAssessment({
      visitId: testVisit1.id,
      chiefComplaint: 'Acute chest pain radiating to left arm',
      symptoms: ['Chest pain', 'Shortness of breath', 'Diaphoresis'],
      temperature: 37.1,
      heartRate: 118,
      bloodPressure: '165/100',
      respiratoryRate: 24,
      oxygenSaturation: 91,
      triageCategory: 'Emergency',
      severityScore: 9,
      clinicalNotes: 'Suspected acute coronary syndrome'
    });

    assert.strictEqual(emergencyAssessment.triageCategory, 'Emergency');
    assert.strictEqual(emergencyAssessment.getPriorityLevel(), 1, 'Emergency category must be Priority 1');
    assert(emergencyAssessment.severityScore >= 7, 'Emergency severity score must floor at 7');
    assert(emergencyAssessment.getClinicalAlerts().length > 0, 'Should detect abnormal vital sign alerts');

    // Routine category
    routineAssessment = TriageFactory.createAssessment({
      visitId: testVisit2.id,
      chiefComplaint: 'Follow-up blood sugar check',
      symptoms: ['Mild fatigue'],
      temperature: 36.8,
      heartRate: 72,
      bloodPressure: '125/82',
      respiratoryRate: 16,
      oxygenSaturation: 98,
      triageCategory: 'Non-Urgent',
      severityScore: 2,
      clinicalNotes: 'Routine medication review'
    });

    assert.strictEqual(routineAssessment.triageCategory, 'Non-Urgent');
    assert.strictEqual(routineAssessment.getPriorityLevel(), 4, 'Non-Urgent must be Priority 4');
  });

  // 4. Queue entry creation
  let triageResult1, triageResult2;
  await runAsyncTest('4. Queue Entry Creation via Facade', async () => {
    triageResult1 = await facade.completeTriage(testVisit1.id, {
      chiefComplaint: emergencyAssessment.chiefComplaint,
      symptoms: emergencyAssessment.symptoms,
      temperature: emergencyAssessment.temperature,
      heartRate: emergencyAssessment.heartRate,
      bloodPressure: emergencyAssessment.bloodPressure,
      respiratoryRate: emergencyAssessment.respiratoryRate,
      oxygenSaturation: emergencyAssessment.oxygenSaturation,
      triageCategory: emergencyAssessment.triageCategory,
      severityScore: emergencyAssessment.severityScore
    });

    assert(triageResult1.queueEntry, 'Queue entry must be returned');
    assert.strictEqual(triageResult1.queueEntry.triagePriority, 1);
    assert.strictEqual(triageResult1.visit.currentState, 'Waiting');

    triageResult2 = await facade.completeTriage(testVisit2.id, {
      chiefComplaint: routineAssessment.chiefComplaint,
      symptoms: routineAssessment.symptoms,
      temperature: routineAssessment.temperature,
      heartRate: routineAssessment.heartRate,
      bloodPressure: routineAssessment.bloodPressure,
      respiratoryRate: routineAssessment.respiratoryRate,
      oxygenSaturation: routineAssessment.oxygenSaturation,
      triageCategory: routineAssessment.triageCategory,
      severityScore: routineAssessment.severityScore
    });

    assert.strictEqual(triageResult2.queueEntry.triagePriority, 4);
    assert.strictEqual(triageResult2.visit.currentState, 'Waiting');
  });

  // 5. Priority-based queue ordering
  await runAsyncTest('5. Priority-Based Queue Ordering (Clinical Urgency & Tie-Breaker)', async () => {
    const queue = await facade.getPriorityQueue();
    assert.strictEqual(queue.length, 2, 'Should have 2 waiting patients');

    // Priority 1 (Emergency) must be FIRST even if registered around the same time
    assert.strictEqual(queue[0].triagePriority, 1, 'First in queue must be Priority 1');
    assert.strictEqual(queue[0].patientVisitId, testVisit1.id);
    assert.strictEqual(queue[1].triagePriority, 4, 'Second in queue must be Priority 4');

    // Test tie-breaker: Two patients with SAME priority
    const earlier = new QueueEntry({
      id: 'Q-EARLY',
      patientVisitId: 'VIS-E',
      triagePriority: 2,
      queueEntryTimestamp: new Date(Date.now() - 20000).toISOString()
    });
    const later = new QueueEntry({
      id: 'Q-LATE',
      patientVisitId: 'VIS-L',
      triagePriority: 2,
      queueEntryTimestamp: new Date(Date.now() - 5000).toISOString()
    });

    assert(QueueEntry.compare(earlier, later) < 0, 'Earlier timestamp must sort before later timestamp for same priority');
  });

  // 6. Valid and invalid State Pattern transitions
  runTest('6. State Pattern Lifecycle Invariants & Invalid Transition Guards', () => {
    const mockVisit = new PatientVisit({ id: 'VIS-TEST', patientId: 'PAT-TEST', currentState: 'Registered' });

    // Valid: Registered -> Awaiting Triage
    StateFactory.transition(mockVisit, 'await_triage');
    assert.strictEqual(mockVisit.currentState, 'Awaiting Triage');

    // Invalid: Attempting to jump directly from Awaiting Triage to Completed without triage/consultation
    assert.throws(() => {
      StateFactory.transition(mockVisit, 'complete');
    }, /Invalid transition/, 'Direct transition from Awaiting Triage to Completed must throw');

    // Invalid: Attempting to call patient without specifying a doctor
    const mockWaiting = new PatientVisit({ id: 'VIS-TEST2', patientId: 'PAT-TEST', currentState: 'Waiting' });
    assert.throws(() => {
      StateFactory.transition(mockWaiting, 'call_patient', {});
    }, /A doctor must be designated/, 'Calling patient without doctor must throw');

    // Terminal state protection: Completed visit cannot transition again
    const completedVisit = new PatientVisit({ id: 'VIS-DONE', patientId: 'PAT-TEST', currentState: 'Completed' });
    assert.throws(() => {
      StateFactory.transition(completedVisit, 'await_triage');
    }, /Cannot transition from 'Completed' state/, 'Terminal states must reject any further transitions');
  });

  // 7. Calling the next eligible patient
  let callResult;
  await runAsyncTest('7. Calling the Next Eligible Patient', async () => {
    callResult = await facade.callNextPatient('DOC-01');
    assert(callResult.success, 'Call next patient must succeed');
    assert.strictEqual(callResult.calledPatient.visitId, testVisit1.id, 'Must call highest priority patient (Priority 1)');

    // Verify visit state moved to 'Called'
    const updatedVisit = db.getVisitById(testVisit1.id);
    assert.strictEqual(updatedVisit.currentState, 'Called');

    // Verify doctor assignment
    assert.strictEqual(updatedVisit.assignedDoctorId, 'DOC-01');
  });

  // 8. Starting a consultation
  await runAsyncTest('8. Starting a Consultation with Assigned Doctor', async () => {
    const startResult = await facade.startConsultation(testVisit1.id, 'DOC-01');
    assert(startResult.success);
    assert.strictEqual(startResult.visit.currentState, 'In Consultation');

    // Verify doctor status is now In Consultation
    const doctorData = db.getDoctorById('DOC-01');
    const doctor = new Doctor(doctorData);
    assert.strictEqual(doctor.availabilityStatus, 'In Consultation');
    assert.strictEqual(doctor.currentVisitId, testVisit1.id);

    // Verify unavailable doctor cannot be assigned to another routine consultation
    assert.strictEqual(doctor.canAcceptConsultation(), false);
    await assert.rejects(async () => {
      await facade.callNextPatient('DOC-01');
    }, /cannot call the next patient|cannot accept/, 'Unavailable doctor should be rejected');
  });

  // 9. Completing, admitting, and referring a visit
  await runAsyncTest('9. Completing, Admitting, and Referring Workflows', async () => {
    // 9a. Inpatient Admission to Bed for Visit 1 (ICU admission)
    const admitResult = await facade.admitPatient(testVisit1.id, 'BED-ICU-01', {
      notes: 'Patient stabilized. Transferred to ICU Bed 1 for continuous cardiac monitoring.'
    });
    assert.strictEqual(admitResult.outcome, 'Admitted');
    assert.strictEqual(admitResult.visit.currentState, 'Admitted');
    assert.strictEqual(admitResult.bed.id, 'BED-ICU-01');
    assert.strictEqual(admitResult.bed.availabilityStatus, 'Occupied');

    // Verify Doctor DOC-01 was freed
    const doc1 = db.getDoctorById('DOC-01');
    assert.strictEqual(doc1.availabilityStatus, 'Available');

    // 9b. Call, Consult, and Complete Outpatient Visit 2
    await facade.callNextPatient('DOC-02');
    await facade.startConsultation(testVisit2.id, 'DOC-02');
    const completeResult = await facade.completeVisit(testVisit2.id, 'Metformin prescription renewed for 90 days. Diet plan reviewed.');
    assert.strictEqual(completeResult.outcome, 'Completed');
    assert.strictEqual(completeResult.visit.currentState, 'Completed');

    // 9c. Create Visit 3 for Referral
    const patient3 = await facade.registerPatient({
      name: 'Samuel Clemens',
      age: 55,
      contactNumber: '555-0377'
    });
    const visit3 = await facade.createVisit(patient3.id);
    await facade.completeTriage(visit3.id, {
      chiefComplaint: 'Suspected retinal detachment',
      triageCategory: 'Urgent',
      severityScore: 6
    });
    await facade.callNextPatient('DOC-01');
    await facade.startConsultation(visit3.id, 'DOC-01');
    const referResult = await facade.referPatient(visit3.id, {
      facility: 'Regional Eye Care Institute',
      reason: 'Urgent laser photocoagulation requirement.'
    });
    assert.strictEqual(referResult.outcome, 'Referred');
    assert.strictEqual(referResult.visit.currentState, 'Referred');
  });

  // 10. Bed allocation and release (preventing double allocation)
  await runAsyncTest('10. Bed Allocation, Release, and Double Allocation Prevention', async () => {
    // Bed 'BED-ICU-01' is currently occupied by Visit 1.
    // Attempting to allocate BED-ICU-01 to another visit must fail
    await assert.rejects(async () => {
      const bed = new Bed(db.getBedById('BED-ICU-01'));
      bed.allocate('ANOTHER-VISIT');
    }, /Cannot double-allocate|not available/);

    // Release the bed
    const releaseResult = await facade.releaseBed('BED-ICU-01');
    assert.strictEqual(releaseResult.bed.availabilityStatus, 'Available');
    assert.strictEqual(releaseResult.bed.allocatedVisitId, null);

    // Now the bed can be re-allocated safely
    const reallocatedBed = new Bed(db.getBedById('BED-ICU-01'));
    reallocatedBed.allocate('NEW-VISIT-TEST');
    assert.strictEqual(reallocatedBed.availabilityStatus, 'Occupied');
  });

  // 11. Prevention of duplicate queue entries
  await runAsyncTest('11. Prevention of Duplicate Queue Entries for Same Visit', async () => {
    const patient4 = await facade.registerPatient({
      name: 'Grace Hopper',
      age: 38,
      contactNumber: '555-0466'
    });
    const visit4 = await facade.createVisit(patient4.id);
    await facade.completeTriage(visit4.id, {
      chiefComplaint: 'Mild headache',
      triageCategory: 'Standard'
    });

    // Attempting second triage for the same visit while queue entry is active must fail
    await assert.rejects(async () => {
      await facade.completeTriage(visit4.id, {
        chiefComplaint: 'Duplicate triage attempt',
        triageCategory: 'Standard'
      });
    }, /already has an active queue entry|Duplicate queue entries are prevented/);
  });

  // 12. Validation errors and unauthorized / invalid transitions
  runTest('12. Validation Errors and Domain Constraints', () => {
    // Invalid patient validation (missing name and phone)
    const invalidPatient = Patient.validate({ name: '', contactNumber: '' });
    assert.strictEqual(invalidPatient.isValid, false);
    assert(invalidPatient.errors.length >= 2);

    // Invalid triage assessment (invalid heart rate and body temp)
    const invalidVitals = TriageAssessment.validate({
      visitId: 'VIS-X',
      chiefComplaint: 'Fever',
      triageCategory: 'Standard',
      heartRate: 400, // Impossibly high
      temperature: 55 // Impossibly high
    });
    assert.strictEqual(invalidVitals.isValid, false);
    assert(invalidVitals.errors.some(e => e.includes('heart rate')));
    assert(invalidVitals.errors.some(e => e.includes('temperature')));

    // Unsupported triage category in factory
    assert.throws(() => {
      TriageFactory.createAssessment({
        visitId: 'VIS-X',
        chiefComplaint: 'Test',
        triageCategory: 'ExperimentalCategory'
      });
    }, /Unsupported triage category/);
  });

  // 13. Full workflow from registration through consultation outcome
  await runAsyncTest('13. End-to-End Workflow (Registration -> Triage -> Queue -> Consultation -> Outcome)', async () => {
    // A. Registration
    const patient = await facade.registerPatient({
      name: 'Timothy Vance',
      age: 29,
      gender: 'Male',
      contactNumber: '555-0555',
      medicalAlerts: 'No known drug allergies'
    });
    assert(patient.id);

    // B. Visit Creation
    const visit = await facade.createVisit(patient.id, { reason: 'Severe sprained ankle' });
    assert.strictEqual(visit.currentState, 'Awaiting Triage');

    // C. Clinical Triage via TriageFactory
    const triage = await facade.completeTriage(visit.id, {
      chiefComplaint: 'Right ankle trauma with swelling and inability to bear weight',
      symptoms: ['Localized pain', 'Significant edema', 'Limited range of motion'],
      temperature: 36.6,
      heartRate: 84,
      bloodPressure: '128/80',
      respiratoryRate: 16,
      oxygenSaturation: 99,
      triageCategory: 'Urgent',
      severityScore: 5,
      clinicalNotes: 'Staff nurse applied cold compress; requires urgent radiological assessment.'
    });
    assert.strictEqual(triage.visit.currentState, 'Waiting');

    // D. Check Priority Queue Placement
    const queue = await facade.getPriorityQueue();
    const entry = queue.find(q => q.patientVisitId === visit.id);
    assert(entry, 'Must be in active queue');
    assert.strictEqual(entry.triagePriority, 2);

    // E. Doctor Call Next
    const call = await facade.callNextPatient('DOC-01', { visitId: visit.id });
    assert(call.success);

    // F. Start Consultation
    const consult = await facade.startConsultation(visit.id, 'DOC-01');
    assert.strictEqual(consult.visit.currentState, 'In Consultation');

    // G. Conclude Consultation
    const outcome = await facade.completeVisit(visit.id, 'X-Ray confirmed grade II ligament sprain. Splint applied, NSAIDs prescribed.');
    assert.strictEqual(outcome.outcome, 'Completed');
    assert.strictEqual(outcome.visit.currentState, 'Completed');

    // H. Verify state history audit trail integrity
    const finalVisit = db.getVisitById(visit.id);
    assert(finalVisit.stateHistory.length >= 4, 'Audit trail must record all lifecycle stages');
    assert(finalVisit.logs.length >= 4, 'Logs must record state changes');
  });

  // Cleanup test database
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  console.log('\n========================================================');
  console.log(` ALL TESTS COMPLETED: ${passedTests} / ${totalTests} PASSED`);
  console.log('========================================================\n');
}

runAllTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
