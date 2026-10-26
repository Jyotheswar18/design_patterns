const DatabaseEngine = require('./server/db');

function inspect() {
  const db = DatabaseEngine.getInstance();
  const patients = db.getPatients();
  const visits = db.getVisits();
  const assessments = db.getAssessments();
  const queue = db.getQueueEntries();
  const doctors = db.getDoctors();
  const beds = db.getBeds();

  console.log('====================================================');
  console.log('   HOSPITAL QUEUE MANAGEMENT SYSTEM - DATABASE INSPECTION');
  console.log('====================================================');
  console.log(`Patients:          ${patients.length}`);
  console.log(`Visits:            ${visits.length}`);
  console.log(`Triage Assessments:${assessments.length}`);
  console.log(`Queue Entries:     ${queue.length} (Active: ${queue.filter(q => ['Waiting', 'Called'].includes(q.queueStatus)).length})`);
  console.log(`Doctors:           ${doctors.length} (Available: ${doctors.filter(d => d.availabilityStatus === 'Available').length})`);
  console.log(`Beds:              ${beds.length} (Available: ${beds.filter(b => b.availabilityStatus === 'Available').length})`);
  console.log('----------------------------------------------------');

  if (queue.length > 0) {
    console.log('\n[Active Priority Queue Summary]');
    const active = queue.filter(q => ['Waiting', 'Called'].includes(q.queueStatus));
    if (active.length === 0) {
      console.log('  No patients currently in active queue.');
    } else {
      active.forEach(entry => {
        console.log(`  - Entry: ${entry.id} | Visit: ${entry.patientVisitId} | Priority: ${entry.triagePriority} | Status: ${entry.queueStatus} | Entered: ${entry.queueEntryTimestamp}`);
      });
    }
  }

  console.log('\n[Doctor Roster]');
  doctors.forEach(d => {
    console.log(`  - ${d.id}: ${d.name} (${d.specialty}) -> [${d.availabilityStatus}] ${d.currentVisitId ? `Visit: ${d.currentVisitId}` : ''}`);
  });

  console.log('\n[Bed Allocation Summary]');
  beds.forEach(b => {
    console.log(`  - ${b.id} (${b.ward}): [${b.availabilityStatus}] ${b.allocatedVisitId ? `Allocated: ${b.allocatedVisitId}` : ''}`);
  });

  console.log('====================================================\n');
}

inspect();
