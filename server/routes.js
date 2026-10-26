const express = require('express');
const router = express.Router();
const HospitalQueueFacade = require('./patterns/facade');
const { StateFactory } = require('./patterns/state');
const { PatientFactory } = require('./patterns/factory');
const DatabaseEngine = require('./db');

const db = DatabaseEngine.getInstance();
const facade = new HospitalQueueFacade(db);
const admissionFacade = new HospitalQueueFacade.AdmissionFacade(db);

/**
 * 1. Dashboard Statistics
 */
router.get('/dashboard/stats', async (req, res) => {
  try {
    const stats = await facade.getDashboardStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 2. Patient Registration & Search
 */
router.post('/patients/register', async (req, res) => {
  try {
    if (req.body.type || req.body.triageType) {
      const p = PatientFactory.createPatient(
        req.body.id || `PAT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        req.body.name,
        req.body.age,
        req.body.type || req.body.triageType,
        req.body.severityScore || 1,
        req.body.symptoms || []
      );
      await db.savePatient(p);
      return res.status(201).json({ success: true, data: p.serialize ? p.serialize() : p });
    }

    const patient = await facade.registerPatient(req.body);
    res.status(201).json({ success: true, data: patient });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/patients', (req, res) => {
  try {
    const query = req.query.q || '';
    const patients = db.findPatients(query);
    res.json({ success: true, data: patients });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/patients/:id', (req, res) => {
  try {
    const patient = db.getPatientById(req.params.id);
    if (!patient) {
      return res.status(404).json({ success: false, error: `Patient '${req.params.id}' not found.` });
    }
    const visits = db.getVisitsByPatientId(req.params.id);
    res.json({ success: true, data: { ...patient, visits } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 3. Visits
 */
router.post('/visits/create', async (req, res) => {
  try {
    const { patientId, ...details } = req.body;
    if (!patientId) {
      return res.status(400).json({ success: false, error: 'patientId is required to create a visit.' });
    }
    const visit = await facade.createVisit(patientId, details);
    res.status(201).json({ success: true, data: visit });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/visits', (req, res) => {
  try {
    let visits = db.getVisits();
    if (req.query.state) {
      visits = visits.filter(v => v.currentState === req.query.state);
    }
    if (req.query.patientId) {
      visits = visits.filter(v => v.patientId === req.query.patientId);
    }
    res.json({ success: true, data: visits });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/visits/:id', (req, res) => {
  try {
    const visit = db.getVisitById(req.params.id);
    if (!visit) {
      return res.status(404).json({ success: false, error: `Visit '${req.params.id}' not found.` });
    }

    const patient = db.getPatientById(visit.patientId);
    const assessment = visit.triageAssessmentId ? db.getAssessmentById(visit.triageAssessmentId) : null;
    const queueEntry = db.getQueueEntryByVisitId(visit.id);
    const doctor = visit.assignedDoctorId ? db.getDoctorById(visit.assignedDoctorId) : null;
    const bed = visit.allocatedBedId ? db.getBedById(visit.allocatedBedId) : null;

    res.json({
      success: true,
      data: {
        ...visit,
        patient,
        assessment,
        queueEntry,
        doctor,
        bed
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 4. Clinical Triage Assessment
 */
router.post('/triage/assess', async (req, res) => {
  try {
    const { visitId, staffId, ...triageData } = req.body;
    if (!visitId) {
      return res.status(400).json({ success: false, error: 'visitId is required for triage assessment.' });
    }
    const result = await facade.completeTriage(visitId, triageData, staffId);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * Automatic Triage Assessment via Factory Pattern
 * POST /api/triage/auto-assess
 */
router.post('/triage/auto-assess', async (req, res) => {
  try {
    const { TriageFactory } = require('./patterns/factory');
    const assessment = TriageFactory.createFromVitals(req.body);

    // Auto-allot specialist doctor and department from demographics, complaints, and vitals
    let allottedDoctor = null;
    try {
      const patientData = { age: req.body.age };
      allottedDoctor = await facade.doctorScheduler.autoAllotDoctor(patientData, {
        ...assessment,
        chiefComplaint: req.body.chiefComplaint || req.body.complaint || '',
        department: req.body.department,
        assignedDoctorId: req.body.assignedDoctorId
      });
    } catch (_) {}

    res.json({
      success: true,
      data: {
        ...(assessment.serialize ? assessment.serialize() : assessment),
        allottedDoctor: allottedDoctor ? allottedDoctor.serialize() : null,
        suggestedDepartment: allottedDoctor ? allottedDoctor.specialty : 'General Medicine'
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/triage/intake-new', async (req, res) => {
  try {
    const {
      name, age, gender, contactNumber, medicalAlerts,
      chiefComplaint, symptoms, temperature, heartRate, bloodPressure, respiratoryRate, oxygenSaturation,
      triageCategory, clinicalNotes, staffId, assignedDoctorId, department
    } = req.body;

    // 1. Register patient
    const patient = await facade.registerPatient({
      name,
      age,
      gender,
      contactNumber,
      medicalAlerts
    });

    // 2. Create visit
    const visit = await facade.createVisit(patient.id, { reason: chiefComplaint });

    // 3. Complete triage with auto or explicit doctor allotment
    const triageResult = await facade.completeTriage(visit.id, {
      chiefComplaint,
      symptoms,
      temperature,
      heartRate,
      bloodPressure,
      respiratoryRate,
      oxygenSaturation,
      triageCategory,
      clinicalNotes,
      assignedDoctorId,
      department
    }, staffId || 'STAFF-TRIAGE');

    res.status(201).json({
      success: true,
      data: {
        patient,
        visit: triageResult.visit,
        assessment: triageResult.assessment,
        queueEntry: triageResult.queueEntry,
        allottedDoctor: triageResult.visit.assignedDoctorId ? db.getDoctorById(triageResult.visit.assignedDoctorId) : null
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/triage/:id', (req, res) => {
  try {
    const assessment = db.getAssessmentById(req.params.id);
    if (!assessment) {
      return res.status(404).json({ success: false, error: `Assessment '${req.params.id}' not found.` });
    }
    res.json({ success: true, data: assessment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 5. Priority Queue
 */
router.get('/queue', async (req, res) => {
  try {
    const queue = await facade.getPriorityQueue(req.query);
    res.json({ success: true, data: queue });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/queue/call-next', async (req, res) => {
  try {
    const { doctorId, visitId } = req.body;
    if (!doctorId) {
      return res.status(400).json({ success: false, error: 'doctorId is required to call next patient.' });
    }
    const result = await facade.callNextPatient(doctorId, { visitId });
    if (!result.success) {
      return res.status(200).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/queue/requeue', async (req, res) => {
  try {
    const { visitId, reason } = req.body;
    if (!visitId) {
      return res.status(400).json({ success: false, error: 'visitId is required to requeue.' });
    }
    const result = await facade.requeuePatient(visitId, reason);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * 6. Consultations
 */
router.post('/consultations/start', async (req, res) => {
  try {
    const { visitId, doctorId } = req.body;
    if (!visitId) {
      return res.status(400).json({ success: false, error: 'visitId is required to start consultation.' });
    }
    const result = await facade.startConsultation(visitId, doctorId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/consultations/complete', async (req, res) => {
  try {
    const { visitId, notes } = req.body;
    if (!visitId) {
      return res.status(400).json({ success: false, error: 'visitId is required to complete consultation.' });
    }
    const result = await facade.completeVisit(visitId, notes);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/consultations/admit', async (req, res) => {
  try {
    const { visitId, bedId, ward, durationDays, ...details } = req.body;
    if (!visitId) {
      return res.status(400).json({ success: false, error: 'visitId is required for patient admission.' });
    }
    const result = await facade.admitPatient(visitId, bedId || ward, {
      ...details,
      durationDays: durationDays ? parseInt(durationDays, 10) : 3
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/consultations/refer', async (req, res) => {
  try {
    const { visitId, facility, referralFacility, reason, notes } = req.body;
    if (!visitId) {
      return res.status(400).json({ success: false, error: 'visitId is required to refer patient.' });
    }
    const result = await facade.referPatient(visitId, {
      facility: facility || referralFacility,
      reason,
      notes
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * PDF Route Specification: State Pattern Clinical Escalation (Page 5 & 8)
 * POST /api/consultations/escalate
 */
router.post('/consultations/escalate', (req, res) => {
  try {
    const { visitId, patientId } = req.body;
    let visit = null;
    let severityScore = 1;

    if (visitId) {
      visit = db.getVisitById(visitId);
    } else if (patientId) {
      const visits = db.getVisitsByPatientId(patientId);
      visit = visits[visits.length - 1];
    }

    if (!visit) {
      return res.status(404).json({ success: false, error: 'Active patient visit not found for escalation.' });
    }

    if (visit.triageAssessmentId) {
      const assessment = db.getAssessmentById(visit.triageAssessmentId);
      if (assessment) severityScore = assessment.severityScore;
    }

    const state = StateFactory.getState(visit.currentState || 'In Consultation');
    const directive = state.handleEscalation({ ...visit, severityScore });

    visit.logs = visit.logs || [];
    visit.logs.push(`[Triage Escalation Directive] ${directive}`);
    db.saveVisit(visit);

    res.json({
      success: true,
      directive,
      severityScore,
      currentState: visit.currentState
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * PDF Route Specification: AdmissionFacade Entrypoints (Page 1 & 3)
 * POST /api/admissions/admit & POST /api/admissions/discharge
 */
router.post('/admissions/admit', async (req, res) => {
  try {
    const { patientId, visitId, wardCategory, bedCategory, durationDays } = req.body;
    const target = visitId ? db.getVisitById(visitId) : (patientId ? db.getPatientById(patientId) : req.body);
    const result = await admissionFacade.admitPatient(
      target || req.body,
      bedCategory || wardCategory || 'General Ward',
      durationDays || 3
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/admissions/discharge', async (req, res) => {
  try {
    const { patientId, visitId } = req.body;
    const target = visitId ? db.getVisitById(visitId) : (patientId ? db.getPatientById(patientId) : req.body);
    const result = await admissionFacade.dischargePatient(target || req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * 7. Doctors
 */
router.get('/doctors', (req, res) => {
  try {
    const doctors = db.getDoctors();
    res.json({ success: true, data: doctors });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/doctors/status', async (req, res) => {
  try {
    const { doctorId, status } = req.body;
    if (!doctorId || !status) {
      return res.status(400).json({ success: false, error: 'doctorId and status are required.' });
    }
    const doctor = db.getDoctorById(doctorId);
    if (!doctor) {
      return res.status(404).json({ success: false, error: `Doctor '${doctorId}' not found.` });
    }
    doctor.availabilityStatus = status;
    await db.saveDoctor(doctor);
    res.json({ success: true, data: doctor });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * 8. Beds
 */
router.get('/beds', (req, res) => {
  try {
    const beds = db.getBeds();
    res.json({ success: true, data: beds });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/beds/allocate', async (req, res) => {
  try {
    const { bedId, visitId, notes } = req.body;
    if (!bedId || !visitId) {
      return res.status(400).json({ success: false, error: 'bedId and visitId are required for bed allocation.' });
    }
    const result = await facade.admitPatient(visitId, bedId, { notes: notes || 'Direct bed allocation from Bed Management.' });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/beds/release/:bedId', async (req, res) => {
  try {
    const result = await facade.releaseBed(req.params.bedId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * 9. Visit History
 */
router.get('/history', (req, res) => {
  try {
    const visits = db.getVisits();
    const resolvedStates = ['Completed', 'Admitted', 'Referred'];
    const query = (req.query.q || '').toLowerCase().trim();

    const history = visits
      .filter(v => resolvedStates.includes(v.currentState))
      .map(v => {
        const patient = db.getPatientById(v.patientId);
        const assessment = v.triageAssessmentId ? db.getAssessmentById(v.triageAssessmentId) : null;
        const doctor = v.assignedDoctorId ? db.getDoctorById(v.assignedDoctorId) : null;
        const bed = v.allocatedBedId ? db.getBedById(v.allocatedBedId) : null;

        return {
          visitId: v.id,
          patientId: v.patientId,
          patientName: patient ? patient.name : 'Unknown',
          patientContact: patient ? patient.contactNumber : '',
          currentState: v.currentState,
          visitOutcome: v.visitOutcome || v.currentState,
          registrationTimestamp: v.registrationTimestamp,
          completionTimestamp: v.completionTimestamp,
          triageCategory: assessment ? assessment.triageCategory : 'Standard',
          chiefComplaint: assessment ? assessment.chiefComplaint : '',
          assignedDoctorName: doctor ? doctor.name : 'None',
          allocatedBed: bed ? `${bed.id} (${bed.ward})` : null,
          referralFacility: v.referralDetails ? v.referralDetails.facility : null,
          consultationNotes: v.consultationNotes,
          stateHistory: v.stateHistory
        };
      })
      .filter(item => {
        if (!query) return true;
        return (
          item.visitId.toLowerCase().includes(query) ||
          item.patientId.toLowerCase().includes(query) ||
          item.patientName.toLowerCase().includes(query) ||
          item.chiefComplaint.toLowerCase().includes(query)
        );
      });

    res.json({ success: true, data: history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 10. Billing & Tariff System (Façade Pattern Subsystem 3)
 */
router.get('/billing/bills', (req, res) => {
  try {
    const bills = db.getBills();
    const visits = db.getVisits();
    const patients = db.getPatients();

    // Hydrate bills with patient names
    const hydratedBills = bills.map(b => {
      const visit = visits.find(v => v.id === b.visitId);
      const patient = visit
        ? patients.find(p => p.id === visit.patientId)
        : patients.find(p => p.id === b.patientId);
      return {
        ...b,
        patientName: patient ? patient.name : 'Unknown Patient',
        patientContact: patient ? patient.contactNumber : ''
      };
    });

    const totalInvoiced = bills.reduce((sum, b) => sum + (Number(b.totalPayable) || 0), 0);
    const totalSubsidies = bills.reduce((sum, b) => sum + (Number(b.subsidyDiscount) || 0), 0);
    const settledCount = bills.filter(b => b.status === 'Paid' || b.status === 'Settled').length;
    const pendingCount = bills.filter(b => b.status !== 'Paid' && b.status !== 'Settled').length;

    res.json({
      success: true,
      data: {
        bills: hydratedBills,
        metrics: {
          totalInvoiced,
          totalSubsidies,
          totalBills: bills.length,
          settledCount,
          pendingCount
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/billing/calculate', (req, res) => {
  try {
    const { ward, durationDays } = req.body;
    const tariff = facade.billing.calculateRoomTariff(ward || 'General Ward', durationDays || 1);
    const consultation = facade.billing.consultationFee;
    const pharmacy = facade.billing.pharmacyBase;
    const subtotal = tariff.roomTotal + consultation + pharmacy;
    const subsidy = Math.round(subtotal * facade.billing.insuranceSubsidyRate);
    const netTotal = subtotal - subsidy;

    res.json({
      success: true,
      data: {
        ward: tariff.ward,
        dailyRate: tariff.dailyRate,
        durationDays: tariff.durationDays,
        roomTotal: tariff.roomTotal,
        consultationFee: consultation,
        pharmacyBase: pharmacy,
        subtotal,
        subsidyDiscount: subsidy,
        netTotal
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/billing/invoice/:visitId', (req, res) => {
  try {
    const bill = db.getBillByVisitId(req.params.visitId);
    if (!bill) {
      return res.status(404).json({ success: false, error: `No invoice found for visit '${req.params.visitId}'.` });
    }
    const visit = db.getVisitById(bill.visitId);
    const patient = visit ? db.getPatientById(visit.patientId) : db.getPatientById(bill.patientId);

    res.json({
      success: true,
      data: {
        bill,
        visit,
        patient
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/billing/settle', async (req, res) => {
  try {
    const { billId, paymentMethod } = req.body;
    const bill = db.getBillById(billId);
    if (!bill) {
      return res.status(404).json({ success: false, error: `Invoice '${billId}' not found.` });
    }
    bill.status = 'Paid';
    bill.paymentMethod = paymentMethod || bill.paymentMethod || 'Settled at Desk';
    bill.settledAt = new Date().toISOString();
    await db.saveBill(bill);
    res.json({ success: true, data: bill });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
