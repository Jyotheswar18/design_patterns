/**
 * ============================================================================
 * GOF DESIGN PATTERN: STATE PATTERN (Behavioral Pattern)
 * ============================================================================
 * Intent:
 *   "Allow an object to alter its behavior when its internal state changes.
 *    The object will appear to change its class."
 * 
 * Application Feature Built Using This Pattern:
 *   FEATURE: PATIENT VISIT CLINICAL LIFECYCLE MANAGEMENT
 *   - Models the sequential clinical workflow of a hospital visit:
 *       [Registered] -> [Awaiting Triage] -> [Waiting] -> [Called] -> [In Consultation]
 *                                                                            |
 *                            +-----------------------+-----------------------+
 *                            v                       v                       v
 *                      [Completed]              [Admitted]              [Referred]
 *                     (Discharged)              (Inpatient)             (Transfer)
 * 
 *   - Invariant Enforcement & Transition Guards:
 *     * Each state class encapsulates its valid transitions via `next(visit, action, payload)`.
 *     * Rejects illegal transitions (e.g. discharging a waiting patient without consultation).
 *     * Terminal states freeze the clinical record against further modifications.
 * 
 * Participants:
 *   - Context: PatientVisit (delegates state-dependent logic to `this.currentState`)
 *   - Abstract State: VisitState (`getStateName()`, `next()`, `isTerminal()`)
 *   - Concrete States: RegisteredState, AwaitingTriageState, WaitingState, CalledState,
 *                      InConsultationState, CompletedState, AdmittedState, ReferredState
 *   - Flyweight Registry: StateFactory (caches singleton instances of each state)
/**
 * ============================================================================
 * FEATURE 2.1: Patient Visit Clinical Lifecycle Tracking
 * GOF CONTEXT CLASS: PatientVisit
 * The entity whose clinical behavior alters as its state transitions.
 * Maintains a reference to the currentState and delegates transition checks.
 * ============================================================================
 */
class PatientVisit {
  constructor({
    id,
    patientId,
    registrationTimestamp = null,
    currentState = 'Registered',
    triageAssessmentId = null,
    queueEntryId = null,
    assignedDoctorId = null,
    consultationNotes = '',
    visitOutcome = null,
    allocatedBedId = null,
    referralDetails = null,
    completionTimestamp = null,
    stateHistory = [],
    logs = []
  }) {
    this.id = id;
    this.patientId = patientId;
    this.registrationTimestamp = registrationTimestamp || new Date().toISOString();
    this.currentState = currentState;
    this.triageAssessmentId = triageAssessmentId;
    this.queueEntryId = queueEntryId;
    this.assignedDoctorId = assignedDoctorId;
    this.consultationNotes = consultationNotes || '';
    this.visitOutcome = visitOutcome;
    this.allocatedBedId = allocatedBedId;
    this.referralDetails = referralDetails;
    this.completionTimestamp = completionTimestamp;
    this.stateHistory = stateHistory.length > 0 ? stateHistory : [
      {
        fromState: null,
        toState: this.currentState,
        timestamp: this.registrationTimestamp,
        action: 'VISIT_CREATED',
        note: 'Patient visit initiated.'
      }
    ];
    this.logs = logs.length > 0 ? logs : [
      `[${this.registrationTimestamp}] Visit ${this.id} created in ${this.currentState} state.`
    ];
  }

  getCurrentStateObject() {
    return StateFactory.getState(this.currentState);
  }

  transitionTo(newState, action = 'TRANSITION', note = '') {
    const timestamp = new Date().toISOString();
    const fromState = this.currentState;
    this.currentState = newState;
    
    this.stateHistory.push({
      fromState,
      toState: newState,
      timestamp,
      action,
      note
    });

    this.logs.push(`[${timestamp}] State changed from ${fromState} to ${newState}. ${note}`.trim());
  }

  performTransition(action, payload = {}) {
    return StateFactory.transition(this, action, payload);
  }

  serialize() {
    return {
      id: this.id,
      patientId: this.patientId,
      registrationTimestamp: this.registrationTimestamp,
      currentState: this.currentState,
      triageAssessmentId: this.triageAssessmentId,
      queueEntryId: this.queueEntryId,
      assignedDoctorId: this.assignedDoctorId,
      consultationNotes: this.consultationNotes,
      visitOutcome: this.visitOutcome,
      allocatedBedId: this.allocatedBedId,
      referralDetails: this.referralDetails,
      completionTimestamp: this.completionTimestamp,
      stateHistory: this.stateHistory,
      logs: this.logs
    };
  }
}

/**
 * ============================================================================
 * GOF ABSTRACT STATE: VisitState
 * Defines the common state contract and default handlers.
 * ============================================================================
 */
class VisitState {
  getStateName() {
    throw new Error('getStateName() must be implemented.');
  }

  /**
   * --------------------------------------------------------------------------
   * FEATURE 2.2: Guarded Transitions & Error Prevention
   * Each concrete state enforces permissible actions and throws errors on invalid transitions.
   * --------------------------------------------------------------------------
   */
  next(visit, action, payload = {}) {
    throw new Error(`Action '${action}' is not supported in state '${this.getStateName()}'.`);
  }

  isTerminal() {
    return false;
  }

  handleEscalation(patientOrVisit) {
    return 'No escalation action needed.';
  }
}

/**
 * 1. RegisteredState
 * Patient record is registered, awaiting clinical intake triage.
 */
class RegisteredState extends VisitState {
  getStateName() {
    return 'Registered';
  }

  next(visit, action, payload = {}) {
    if (action === 'start_triage' || action === 'await_triage' || action === 'triage') {
      visit.transitionTo('Awaiting Triage', action, payload.note || 'Patient sent to nursing triage station.');
      return StateFactory.getState('Awaiting Triage');
    }

    if (action === 'admit') {
      if (!payload.bedId) {
        throw new Error('Cannot admit patient: An allocated bed ID is required.');
      }
      visit.allocatedBedId = payload.bedId;
      visit.consultationNotes = payload.notes || visit.consultationNotes;
      visit.visitOutcome = 'Admitted';
      visit.completionTimestamp = new Date().toISOString();
      visit.transitionTo('Admitted', action, `Direct emergency inpatient admission to Bed ${payload.bedId} (${payload.ward || 'Inpatient'}).`);
      return StateFactory.getState('Admitted');
    }

    throw new Error(`Invalid transition from Registered state via action '${action}'. Permitted actions: 'await_triage', 'admit'.`);
  }
}

/**
 * 2. AwaitingTriageState
 * Patient is at triage desk having vital signs and complaint assessed.
 */
class AwaitingTriageState extends VisitState {
  getStateName() {
    return 'Awaiting Triage';
  }

  next(visit, action, payload = {}) {
    if (action === 'complete_triage') {
      if (!payload.assessmentId) {
        throw new Error('Cannot complete triage without an assessment ID.');
      }
      visit.triageAssessmentId = payload.assessmentId;

      // Emergency fast-track check: If immediate resuscitation is required
      if (payload.isImmediateResuscitation && payload.doctorId) {
        visit.assignedDoctorId = payload.doctorId;
        visit.transitionTo('In Consultation', action, 'Emergency Red Flag: immediate resuscitation in progress.');
        return StateFactory.getState('In Consultation');
      }

      visit.transitionTo('Waiting', action, payload.note || `Triage completed (Category: ${payload.category || 'Standard'}). Placed in priority queue.`);
      return StateFactory.getState('Waiting');
    }

    if (action === 'admit') {
      if (!payload.bedId) {
        throw new Error('Cannot admit patient: An allocated bed ID is required.');
      }
      visit.allocatedBedId = payload.bedId;
      visit.consultationNotes = payload.notes || visit.consultationNotes;
      visit.visitOutcome = 'Admitted';
      visit.completionTimestamp = new Date().toISOString();
      visit.transitionTo('Admitted', action, `Direct inpatient admission from triage to Bed ${payload.bedId} (${payload.ward || 'Inpatient'}).`);
      return StateFactory.getState('Admitted');
    }

    throw new Error(`Invalid transition from Awaiting Triage state via action '${action}'. Permitted actions: 'complete_triage', 'admit'.`);
  }
}

/**
 * 3. WaitingState
 * Patient is actively in the waiting area, ordered by triage priority.
 */
class WaitingState extends VisitState {
  getStateName() {
    return 'Waiting';
  }

  next(visit, action, payload = {}) {
    if (action === 'call_patient') {
      if (!payload.doctorId) {
        throw new Error('Cannot call patient: A doctor must be designated to call.');
      }
      visit.assignedDoctorId = payload.doctorId;
      visit.transitionTo('Called', action, `Called to consultation room by ${payload.doctorName || payload.doctorId}.`);
      return StateFactory.getState('Called');
    }

    // PDF Spec compatibility: next(patient, option) advancing Waiting -> Consultation
    if (action === 'consult' || action === 'consultation' || !action) {
      if (!visit.assignedDoctor && !visit.assignedDoctorId && !payload.doctorId) {
        throw new Error('Cannot begin consultation: No doctor has been assigned yet.');
      }
      const doc = visit.assignedDoctor || payload.doctorName || visit.assignedDoctorId || payload.doctorId;
      if (visit.stateName !== undefined) visit.stateName = 'Consultation';
      if (visit.currentState !== undefined) {
        visit.assignedDoctorId = payload.doctorId || visit.assignedDoctorId;
        visit.transitionTo('In Consultation', 'consult', `Advanced from Waiting to Consultation with ${doc}.`);
      }
      if (visit.logs) visit.logs.push(`[State Transition] Advanced from Waiting to Consultation with ${doc}.`);
      return StateFactory.getState('In Consultation');
    }

    if (action === 'admit') {
      if (!payload.bedId && !visit.bedNumber) {
        throw new Error('Cannot admit patient: An allocated bed ID is required.');
      }
      visit.allocatedBedId = payload.bedId || visit.bedNumber;
      visit.consultationNotes = payload.notes || visit.consultationNotes;
      visit.visitOutcome = 'Admitted';
      visit.completionTimestamp = new Date().toISOString();
      if (visit.stateName !== undefined) visit.stateName = 'Admitted';
      if (visit.transitionTo) visit.transitionTo('Admitted', action, `Direct inpatient admission from queue to Bed ${visit.allocatedBedId} (${payload.ward || 'Inpatient'}).`);
      return StateFactory.getState('Admitted');
    }

    throw new Error(`Invalid transition from Waiting state via action '${action}'. Permitted actions: 'call_patient', 'admit'.`);
  }
}

/**
 * 4. CalledState
 * Patient has been called from queue and is arriving to the consultation room.
 */
class CalledState extends VisitState {
  getStateName() {
    return 'Called';
  }

  next(visit, action, payload = {}) {
    if (action === 'start_consultation') {
      if (!visit.assignedDoctorId && !payload.doctorId) {
        throw new Error('Cannot begin consultation: No doctor has been assigned.');
      }
      if (payload.doctorId) {
        visit.assignedDoctorId = payload.doctorId;
      }
      visit.transitionTo('In Consultation', action, `Consultation started with ${payload.doctorName || visit.assignedDoctorId}.`);
      return StateFactory.getState('In Consultation');
    }

    /**
     * ------------------------------------------------------------------------
     * FEATURE 2.3: Missed-Call & Re-Queueing Policy
     * If patient does not respond to room call, re-queues them back to Waiting.
     * ------------------------------------------------------------------------
     */
    if (action === 'requeue' || action === 'missed_call') {
      visit.transitionTo('Waiting', action, payload.note || 'Patient did not respond to call; re-queued to waiting queue.');
      return StateFactory.getState('Waiting');
    }

    if (action === 'admit') {
      if (!payload.bedId && !visit.bedNumber) {
        throw new Error('Cannot admit patient: An allocated bed ID is required.');
      }
      visit.allocatedBedId = payload.bedId || visit.bedNumber;
      visit.consultationNotes = payload.notes || visit.consultationNotes;
      visit.visitOutcome = 'Admitted';
      visit.completionTimestamp = new Date().toISOString();
      visit.transitionTo('Admitted', action, `Direct inpatient admission to Bed ${visit.allocatedBedId} (${payload.ward || 'Inpatient'}).`);
      return StateFactory.getState('Admitted');
    }

    throw new Error(`Invalid transition from Called state via action '${action}'. Permitted actions: 'start_consultation', 'requeue', 'admit'.`);
  }
}

/**
 * ============================================================================
 * FEATURE 2.4: Branching Consultation Outcomes
 * InConsultationState handles the 3 terminal doctor resolutions:
 * 1. Discharge / Complete (Outpatient resolved)
 * 2. Inpatient Admission (Bed allocation)
 * 3. External Facility Referral
 * ============================================================================
 */
class InConsultationState extends VisitState {
  getStateName() {
    return 'In Consultation';
  }

  next(visit, action, payload = {}) {
    if (action === 'complete' || action === 'discharge') {
      visit.consultationNotes = payload.notes || visit.consultationNotes;
      visit.visitOutcome = 'Completed';
      visit.completionTimestamp = new Date().toISOString();
      if (visit.stateName !== undefined) visit.stateName = 'Discharged';
      if (visit.transitionTo) visit.transitionTo('Completed', action, payload.note || 'Consultation completed; resolved as outpatient.');
      if (visit.logs) visit.logs.push(`[State Transition] Advanced from Consultation to Discharged (Outpatient resolved).`);
      return StateFactory.getState('Completed');
    }

    if (action === 'admit') {
      if (visit.currentState !== undefined && !payload.bedId && !visit.bedNumber && !visit.allocatedBedId) {
        throw new Error('Cannot admit patient: An allocated bed ID is required.');
      }
      visit.consultationNotes = payload.notes || visit.consultationNotes;
      visit.allocatedBedId = payload.bedId || visit.bedNumber || visit.allocatedBedId || null;
      visit.visitOutcome = 'Admitted';
      visit.completionTimestamp = new Date().toISOString();
      if (visit.stateName !== undefined) visit.stateName = 'Admitted';
      if (visit.transitionTo) visit.transitionTo('Admitted', action, `Patient admitted to Bed ${visit.allocatedBedId || 'Inpatient'} (${payload.ward || 'Inpatient'}).`);
      if (visit.logs) visit.logs.push(`[State Transition] Advanced from Consultation to Admitted for inpatient care.`);
      return StateFactory.getState('Admitted');
    }

    if (action === 'refer') {
      if (!payload.referralFacility && !payload.facility) {
        throw new Error('Cannot refer patient: Target referral facility or specialist is required.');
      }
      visit.consultationNotes = payload.notes || visit.consultationNotes;
      visit.referralDetails = {
        facility: payload.referralFacility || payload.facility,
        reason: payload.reason || '',
        referredAt: new Date().toISOString()
      };
      visit.visitOutcome = 'Referred';
      visit.completionTimestamp = new Date().toISOString();
      visit.transitionTo('Referred', action, `Patient referred to ${visit.referralDetails.facility}.`);
      return StateFactory.getState('Referred');
    }

    throw new Error(`Invalid transition from In Consultation state via action '${action}'. Permitted actions: 'complete', 'admit', 'refer'.`);
  }

  /**
   * --------------------------------------------------------------------------
   * FEATURE 2.6: Clinical Escalation Rule Resolution
   * Suggests senior doctor or trauma review based on patient severity score.
   * --------------------------------------------------------------------------
   */
  handleEscalation(patientOrVisit = {}) {
    const severity = patientOrVisit.severityScore || (patientOrVisit.assessment ? patientOrVisit.assessment.severityScore : 1);
    if (severity >= 8) {
      return 'Critical Escalation: Transferred immediately to Chief of Surgery & Emergency Resuscitation Unit.';
    } else if (severity >= 5) {
      return 'Senior Consultation: Escalated to Senior Medical Specialist for advanced diagnostic imaging.';
    }
    return 'Junior Doctor resolved: Prescribed medication and ordered standard tests. Case closed.';
  }
}

/**
 * ============================================================================
 * FEATURE 2.5: Terminal State Freezing
 * Protects completed, admitted, or referred visits against illegal re-transitions.
 * ============================================================================
 */
class CompletedState extends VisitState {
  getStateName() {
    return 'Completed';
  }

  isTerminal() {
    return true;
  }

  next(visit, action, payload = {}) {
    throw new Error(`Cannot transition from 'Completed' state: Patient has already been Discharged (Terminal State).`);
  }
}

class AdmittedState extends VisitState {
  getStateName() {
    return 'Admitted';
  }

  isTerminal() {
    return true;
  }

  next(visit, action, payload = {}) {
    if (action === 'discharge' || action === 'complete') {
      if (visit.stateName !== undefined) visit.stateName = 'Discharged';
      if (visit.transitionTo) {
        visit.visitOutcome = 'Discharged';
        visit.completionTimestamp = new Date().toISOString();
        visit.transitionTo('Completed', action, payload.note || 'Patient completed inpatient care and is Discharged.');
      }
      if (visit.logs) visit.logs.push(`[State Transition] Patient completed inpatient care and is Discharged.`);
      return StateFactory.getState('Completed');
    }
    throw new Error(`Cannot transition from 'Admitted' state via '${action}': Inpatient care workflow active (Bed: ${visit.allocatedBedId || visit.bedNumber}). Only 'discharge' action is permitted.`);
  }
}

class ReferredState extends VisitState {
  getStateName() {
    return 'Referred';
  }

  isTerminal() {
    return true;
  }

  next(visit, action, payload = {}) {
    throw new Error(`Cannot transition from 'Referred' state: Patient has been transferred to external facility.`);
  }
}

/**
 * ============================================================================
 * FEATURE 2.7: Flyweight State Caching & Central Transition Dispatcher
 * ============================================================================
 */
class StateFactory {
  static states = {
    'Registered': new RegisteredState(),
    'Awaiting Triage': new AwaitingTriageState(),
    'Waiting': new WaitingState(),
    'Called': new CalledState(),
    'In Consultation': new InConsultationState(),
    'Consultation': new InConsultationState(),
    'Completed': new CompletedState(),
    'Discharged': new CompletedState(),
    'Admitted': new AdmittedState(),
    'Referred': new ReferredState()
  };

  static stateMap = StateFactory.states;

  static getState(stateName) {
    const state = this.states[stateName];
    if (!state) {
      throw new Error(`Unknown Visit State: '${stateName}'. Valid states are: ${Object.keys(this.states).join(', ')}`);
    }
    return state;
  }

  /**
   * Safe transition execution through state pattern
   */
  static transition(visit, action, payload = {}) {
    const currentStateObj = this.getState(visit.currentState);
    return currentStateObj.next(visit, action, payload);
  }
}

// Aliases matching PDF class names
const PatientState = VisitState;
const ConsultationState = InConsultationState;
const DischargedState = CompletedState;

module.exports = {
  // GoF Context Participant
  PatientVisit,

  // GoF State Participants
  VisitState,
  RegisteredState,
  AwaitingTriageState,
  WaitingState,
  CalledState,
  InConsultationState,
  CompletedState,
  AdmittedState,
  ReferredState,
  StateFactory,

  // Aliases for PDF compatibility
  PatientState,
  ConsultationState,
  DischargedState
};
