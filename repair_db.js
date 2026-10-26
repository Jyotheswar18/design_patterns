const DatabaseEngine = require('./server/db');

async function repair() {
  console.log('====================================================');
  console.log('   HOSPITAL QUEUE MANAGEMENT SYSTEM - DATABASE REPAIR');
  console.log('====================================================');

  const db = DatabaseEngine.getInstance();
  let fixCount = 0;

  // 1. Ensure root array structure
  const collections = ['patients', 'patientVisits', 'triageAssessments', 'queueEntries', 'doctors', 'beds'];
  for (const coll of collections) {
    if (!Array.isArray(db.data[coll])) {
      console.log(`[Fix] Missing array for ${coll}. Initializing empty array.`);
      db.data[coll] = [];
      fixCount++;
    }
  }

  const patientIds = new Set(db.data.patients.map(p => p.id));
  const visitIds = new Set(db.data.patientVisits.map(v => v.id));

  // 2. Validate visits reference valid patients
  db.data.patientVisits.forEach(v => {
    if (!patientIds.has(v.patientId)) {
      console.warn(`[Warning] Visit ${v.id} references non-existent patient ${v.patientId}.`);
    }
  });

  // 3. De-duplicate active queue entries for same visit
  const activeVisitsInQueue = new Map();
  db.data.queueEntries.forEach(q => {
    if (['Waiting', 'Called'].includes(q.queueStatus)) {
      if (activeVisitsInQueue.has(q.patientVisitId)) {
        console.log(`[Fix] Duplicate active queue entry ${q.id} found for visit ${q.patientVisitId}. Marking as 'Removed'.`);
        q.queueStatus = 'Removed';
        fixCount++;
      } else {
        activeVisitsInQueue.set(q.patientVisitId, q.id);
      }
    }
  });

  // 4. Synchronize doctor availability with active visits
  db.data.doctors.forEach(d => {
    if (d.currentVisitId) {
      const visit = db.data.patientVisits.find(v => v.id === d.currentVisitId);
      if (!visit || ['Completed', 'Admitted', 'Referred'].includes(visit.currentState)) {
        console.log(`[Fix] Doctor ${d.name} (${d.id}) has stale currentVisitId (${d.currentVisitId}). Resetting to 'Available'.`);
        d.availabilityStatus = 'Available';
        d.currentVisitId = null;
        fixCount++;
      }
    }
  });

  // 5. Synchronize bed availability with admitted visits
  db.data.beds.forEach(b => {
    if (b.allocatedVisitId) {
      const visit = db.data.patientVisits.find(v => v.id === b.allocatedVisitId);
      if (!visit || visit.currentState !== 'Admitted') {
        console.log(`[Fix] Bed ${b.id} (${b.ward}) has stale allocatedVisitId (${b.allocatedVisitId}). Resetting to 'Available'.`);
        b.availabilityStatus = 'Available';
        b.allocatedVisitId = null;
        fixCount++;
      }
    }
  });

  if (fixCount > 0) {
    await db.persist();
    console.log(`\nRepair completed successfully. Repaired ${fixCount} inconsistencies.`);
  } else {
    console.log('\nIntegrity check passed. Database is consistent with 0 errors.');
  }
  console.log('====================================================\n');
}

repair();
