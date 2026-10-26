// State Management
let currentView = 'dashboard';
let cachedDoctors = [];
let cachedBeds = [];
let cachedVisits = [];
let cachedQueueEntries = [];
let activeConsultationVisit = null;
let triageMode = 'new'; // 'new' (intake new patient) or 'existing' (triage pending visit)

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupEventListeners();
  updateClock();
  setInterval(updateClock, 1000);
  setTriageMode('new');

  // Initial load
  loadDashboardData();
  setupPolling();
});

function updateClock() {
  const now = new Date();
  const timeElem = document.getElementById('current-time');
  if (timeElem) {
    timeElem.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}

function setupPolling() {
  setInterval(() => {
    if (currentView === 'dashboard') loadDashboardData();
    else if (currentView === 'queue') loadQueueData();
  }, 10000);
}

// Navigation
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetView = item.getAttribute('data-view');
      switchView(targetView);
    });
  });
}

function switchView(viewName) {
  currentView = viewName;

  // Update nav item active state
  document.querySelectorAll('.nav-item').forEach(item => {
    if (item.getAttribute('data-view') === viewName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Update view sections
  document.querySelectorAll('.view-section').forEach(section => {
    section.classList.remove('active');
  });

  const activeSection = document.getElementById(`view-${viewName}`);
  if (activeSection) {
    activeSection.classList.add('active');
  }

  // Update header title
  const titleMap = {
    dashboard: 'Dashboard Overview',
    triage: 'Clinical Triage & Patient Intake',
    queue: 'Clinical Priority Queue',
    consultation: 'Doctor Consultation Desk',
    resources: 'Physician Roster & Inpatient Beds',
    history: 'Resolved Hospital Visits & History',
    billing: 'Hospital Billing & Tariff Operations'
  };
  document.getElementById('top-page-title').textContent = titleMap[viewName] || 'Hospital Management';

  // Trigger view specific load
  if (viewName === 'dashboard') loadDashboardData();
  else if (viewName === 'queue') loadQueueData();
  else if (viewName === 'consultation') loadConsultationView();
  else if (viewName === 'resources') loadResourcesData();
  else if (viewName === 'history') loadHistoryData();
  else if (viewName === 'billing') loadBillingView();
}

// Notifications
function showNotification(message, type = 'info', duration = 5000) {
  const banner = document.getElementById('notification-banner');
  banner.className = `alert-box ${type}`;
  banner.innerHTML = `<div>${message}</div>`;
  banner.style.display = 'flex';

  setTimeout(() => {
    banner.style.display = 'none';
  }, duration);
}

// Modal handling
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('open');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('open');
}

// ========================================================
// 1. DASHBOARD
// ========================================================
async function loadDashboardData() {
  try {
    const [statsRes, queueRes, docRes, bedRes] = await Promise.all([
      fetch('/api/dashboard/stats'),
      fetch('/api/queue'),
      fetch('/api/doctors'),
      fetch('/api/beds')
    ]);

    const statsData = await statsRes.json();
    const queueData = await queueRes.json();
    const docData = await docRes.json();
    const bedData = await bedRes.json();

    if (statsData.success) {
      const s = statsData.data;
      document.getElementById('stat-active-visits').textContent = s.activeVisits;
      document.getElementById('stat-awaiting-triage').textContent = s.awaitingTriage;
      document.getElementById('stat-waiting-consult').textContent = s.waitingConsultation;
      document.getElementById('stat-in-consult').textContent = s.inConsultation;
      document.getElementById('stat-emergency').textContent = s.emergencyPriority1;
      document.getElementById('stat-doctors-avail').textContent = `${s.availableDoctors} / ${s.totalDoctors}`;
      document.getElementById('stat-beds-avail').textContent = `${s.availableBeds} / ${s.totalBeds}`;
    }

    if (queueData.success) {
      renderDashboardQueuePreview(queueData.data);
    }

    if (docData.success) {
      cachedDoctors = docData.data;
      renderDashboardDoctors(docData.data);
      renderTriageDoctorRoster(docData.data);
    }

    if (bedData.success) {
      cachedBeds = bedData.data;
      renderDashboardBedSummary(bedData.data);
    }
  } catch (err) {
    console.error('Error loading dashboard data:', err);
  }
}

function renderDashboardQueuePreview(queue) {
  const tbody = document.querySelector('#dash-queue-table tbody');
  if (!queue || queue.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-placeholder">No patients currently waiting in queue.</td></tr>';
    return;
  }

  tbody.innerHTML = queue.slice(0, 5).map(item => `
    <tr>
      <td><span class="badge badge-p${item.triagePriority}">Priority ${item.triagePriority}</span></td>
      <td><strong>${escapeHtml(item.patientName)}</strong></td>
      <td>${escapeHtml(item.chiefComplaint || 'N/A')}</td>
      <td>${item.waitMinutes}m</td>
      <td><span class="badge badge-status-${item.queueStatus.toLowerCase().replace(' ', '')}">${item.queueStatus}</span></td>
    </tr>
  `).join('');
}

function renderDashboardDoctors(doctors) {
  const tbody = document.querySelector('#dash-doctor-table tbody');
  if (!tbody) return;
  tbody.innerHTML = doctors.map(d => `
    <tr>
      <td><strong>${escapeHtml(d.name)}</strong></td>
      <td><span class="badge" style="background: var(--bg-hover); font-size: 11px;">${escapeHtml(d.specialty)}</span></td>
      <td>
        <span class="badge ${d.availabilityStatus === 'Available' ? 'badge-status-completed' : 'badge-p2'}">
          ${d.availabilityStatus}
        </span>
      </td>
    </tr>
  `).join('');
}

function renderTriageDoctorRoster(doctors) {
  const container = document.getElementById('triage-roster-cards');
  if (!container || !doctors) return;
  const currentDocId = document.getElementById('triage-doctor-id') ? document.getElementById('triage-doctor-id').value : '';

  container.innerHTML = doctors.map(d => {
    const isSelected = d.id === currentDocId;
    return `
      <div class="doctor-card-item ${isSelected ? 'selected' : ''}" data-doc-id="${d.id}" data-specialty="${escapeHtml(d.specialty)}" data-name="${escapeHtml(d.name)}"
           style="padding: 10px; border-radius: var(--border-radius); border: 2px solid ${isSelected ? 'var(--primary)' : 'var(--border-color)'}; background: ${isSelected ? 'var(--bg-hover)' : 'var(--bg-surface)'}; cursor: pointer; transition: all 0.2s ease;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
          <span style="font-size: 11px; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.5px;">${escapeHtml(d.specialty)}</span>
          <span class="badge ${d.availabilityStatus === 'Available' ? 'badge-status-completed' : 'badge-p2'}" style="font-size: 9px; padding: 1px 6px;">
            ${d.availabilityStatus}
          </span>
        </div>
        <div style="font-size: 13px; font-weight: 600; color: var(--text-main);">${escapeHtml(d.name)}</div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">ID: ${d.id} • ${d.availabilityStatus === 'Available' ? 'Ready for Consultation' : 'In Service'}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.doctor-card-item').forEach(card => {
    card.addEventListener('click', () => {
      const docId = card.getAttribute('data-doc-id');
      const specialty = card.getAttribute('data-specialty');
      const name = card.getAttribute('data-name');
      selectRosterDoctor(docId, specialty, name);
    });
  });
}

function selectRosterDoctor(docId, specialty, name) {
  const docIdInput = document.getElementById('triage-doctor-id');
  if (docIdInput) docIdInput.value = docId;
  const deptInput = document.getElementById('triage-dept-display');
  if (deptInput) deptInput.value = specialty;
  const docText = document.getElementById('triage-allotted-doctor-text');
  if (docText) docText.textContent = `${name} (${specialty})`;
  const docBadge = document.getElementById('triage-doctor-badge');
  if (docBadge) {
    docBadge.textContent = 'Selected Specialist';
    docBadge.className = 'badge badge-primary';
  }
  highlightRosterDoctor(docId);
}

function highlightRosterDoctor(docId) {
  const cards = document.querySelectorAll('#triage-roster-cards .doctor-card-item');
  cards.forEach(card => {
    const isMatch = card.getAttribute('data-doc-id') === docId;
    card.style.borderColor = isMatch ? 'var(--primary)' : 'var(--border-color)';
    card.style.background = isMatch ? 'var(--bg-hover)' : 'var(--bg-surface)';
  });
}

function renderDashboardBedSummary(beds) {
  const tbody = document.querySelector('#dash-bed-summary-table tbody');
  const wards = {};
  beds.forEach(b => {
    if (!wards[b.ward]) wards[b.ward] = { total: 0, available: 0 };
    wards[b.ward].total++;
    if (b.availabilityStatus === 'Available') wards[b.ward].available++;
  });

  tbody.innerHTML = Object.entries(wards).map(([ward, counts]) => `
    <tr>
      <td><strong>${escapeHtml(ward)}</strong></td>
      <td>${counts.available} free</td>
      <td>${counts.total} beds</td>
    </tr>
  `).join('');
}

// ========================================================
// 2. PATIENT REGISTRATION & VISIT INTAKE
// ========================================================
function setTriageMode(mode) {
  // Single unified new patient intake & triage flow
}

function setupEventListeners() {
  document.getElementById('btn-refresh-global').addEventListener('click', () => {
    if (currentView === 'dashboard') loadDashboardData();
    else if (currentView === 'queue') loadQueueData();
    else if (currentView === 'consultation') loadConsultationView();
    else if (currentView === 'resources') loadResourcesData();
    else if (currentView === 'history') loadHistoryData();
  });

  // Patient Intake & Clinical Triage Form (Single Unified Flow)
  const triageForm = document.getElementById('form-triage');
  if (triageForm) {
    triageForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = document.getElementById('triage-name').value.trim();
      const age = document.getElementById('triage-age').value;
      const gender = document.getElementById('triage-gender').value;
      const contactInput = document.getElementById('triage-contact');
      const contactNumber = (contactInput && contactInput.value.trim()) || `98${Math.floor(10000000 + Math.random() * 90000000)}`;

      const chiefComplaint = document.getElementById('triage-complaint').value.trim();
      const symptoms = [chiefComplaint];
      const temperature = document.getElementById('triage-temp').value;
      const heartRate = document.getElementById('triage-hr').value;
      const bloodPressure = document.getElementById('triage-bp').value;
      const respiratoryRate = document.getElementById('triage-rr').value;
      const oxygenSaturation = document.getElementById('triage-spo2').value;
      const triageCategory = document.getElementById('triage-category').value;
      const assignedDoctorId = document.getElementById('triage-doctor-id') ? document.getElementById('triage-doctor-id').value : '';
      const department = document.getElementById('triage-dept-display') ? document.getElementById('triage-dept-display').value : '';
      const staffId = 'NURSE-TRIAGE';

      if (!name || !age || !chiefComplaint) {
        showNotification('Please fill in patient name, age, and chief complaint / symptoms.', 'warning');
        return;
      }

      try {
        const res = await fetch('/api/triage/intake-new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            age,
            gender,
            contactNumber,
            medicalAlerts: '',
            chiefComplaint,
            symptoms,
            temperature,
            heartRate,
            bloodPressure,
            respiratoryRate,
            oxygenSaturation,
            triageCategory,
            assignedDoctorId,
            department,
            clinicalNotes: '',
            staffId
          })
        });

        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        const pName = data.data && data.data.patient ? data.data.patient.name : name;
        const priority = data.data && data.data.assessment ? data.data.assessment.priorityLevel : 3;
        const docName = (data.data && data.data.allottedDoctor) ? `${data.data.allottedDoctor.name} (${data.data.allottedDoctor.specialty})` : 'Allotted Specialist';
        showNotification(`Patient ${pName} registered, triaged (Priority ${priority}), and automatically allotted to ${docName}.`, 'success', 7000);

        triageForm.reset();
        document.getElementById('triage-live-alerts').innerHTML = '';
        const catInput = document.getElementById('triage-category');
        if (catInput) catInput.value = 'Standard';
        const autoText = document.getElementById('triage-auto-text');
        if (autoText) autoText.textContent = 'Enter vitals to calculate...';
        const autoBadge = document.getElementById('triage-auto-badge');
        if (autoBadge) autoBadge.innerHTML = '<span class="badge" style="background: var(--bg-hover); color: var(--text-muted); font-size: 10px;">Awaiting Vitals</span>';
        const autoDisplay = document.getElementById('triage-auto-display');
        if (autoDisplay) autoDisplay.style.borderColor = 'var(--border-color)';
        const deptInput = document.getElementById('triage-dept-display');
        if (deptInput) deptInput.value = 'General Medicine';
        const docIdInput = document.getElementById('triage-doctor-id');
        if (docIdInput) docIdInput.value = 'DOC-102';
        const docText = document.getElementById('triage-allotted-doctor-text');
        if (docText) docText.textContent = 'Dr. Marcus Vance (General Medicine)';
        const docBadge = document.getElementById('triage-doctor-badge');
        if (docBadge) {
          docBadge.textContent = 'Auto-Allotted';
          docBadge.className = 'badge badge-success';
        }
        highlightRosterDoctor('DOC-102');
      } catch (err) {
        showNotification(`Triage Error: ${err.message}`, 'emergency');
      }
    });
  }

  // Direct Bed Allocation Confirm Listener
  const directAdmitBtn = document.getElementById('btn-confirm-direct-admit');
  if (directAdmitBtn) {
    directAdmitBtn.addEventListener('click', async () => {
      const bedId = document.getElementById('direct-admit-bed-id').value;
      const visitId = document.getElementById('direct-admit-visit-select').value;
      const notes = document.getElementById('direct-admit-notes').value.trim();

      if (!visitId) {
        showNotification('Please select an active patient visit to allocate this bed.', 'warning');
        return;
      }

      try {
        const res = await fetch('/api/beds/allocate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bedId, visitId, notes })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        closeModal('modal-direct-admit');
        showNotification(`Bed ${bedId} successfully allocated to Visit ${visitId}.`, 'success');
        loadResourcesData();
        loadDashboardData();
      } catch (err) {
        showNotification(`Bed Allocation Error: ${err.message}`, 'emergency');
      }
    });
  }

  // Toggle all doctors roster
  const toggleRosterBtn = document.getElementById('btn-toggle-roster');
  if (toggleRosterBtn) {
    toggleRosterBtn.addEventListener('click', () => {
      const rosterDiv = document.getElementById('triage-all-doctors-roster');
      if (rosterDiv) {
        const isHidden = rosterDiv.style.display === 'none' || rosterDiv.style.display === '';
        rosterDiv.style.display = isHidden ? 'block' : 'none';
        toggleRosterBtn.textContent = isHidden ? '▲ Hide Department Doctors' : '📋 View All Department Doctors';
        if (isHidden && cachedDoctors && cachedDoctors.length > 0) {
          renderTriageDoctorRoster(cachedDoctors);
        }
      }
    });
  }

  // Triage live alert detection and Factory auto-allocation on vital, age, and complaint inputs
  ['triage-spo2', 'triage-bp', 'triage-hr', 'triage-temp', 'triage-rr', 'triage-age', 'triage-complaint'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', checkLiveTriageAlerts);
  });



  // Queue Call Next
  document.getElementById('btn-call-next').addEventListener('click', async () => {
    const doctorId = document.getElementById('call-doctor-select').value;
    if (!doctorId) {
      showNotification('Please select an available doctor to call the next patient.', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/queue/call-next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctorId })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || data.error);

      const p = data.calledPatient;
      showNotification(`Patient ${p.patientName} (${p.triageCategory} - Priority ${p.triagePriority}) called for ${p.doctor.name}.`, 'info', 7000);
      loadQueueData();
    } catch (err) {
      showNotification(`Call Error: ${err.message}`, 'warning');
    }
  });

  // Queue filters
  document.getElementById('queue-filter-input').addEventListener('input', filterQueueTable);
  document.getElementById('queue-status-filter').addEventListener('change', loadQueueData);

  // Consultation doctor desk select
  document.getElementById('consult-doctor-desk').addEventListener('change', (e) => {
    loadActiveDoctorConsultation(e.target.value);
  });

  // Outcome: Complete Outpatient
  document.getElementById('btn-outcome-complete').addEventListener('click', async () => {
    const visitId = document.getElementById('consult-visit-id').value;
    const notes = document.getElementById('consult-notes').value.trim();
    if (!visitId) return;

    if (!notes) {
      showNotification('Please enter consultation notes and treatment plan.', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/consultations/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitId, notes })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      const billInfo = data.bill ? ` Outpatient invoice ${data.bill.id} generated for ₹${data.bill.totalPayable}.` : '';
      showNotification(`Visit ${visitId} concluded successfully (CompletedState). Attending physician released.${billInfo}`, 'success');
      resetConsultationForm();
      loadConsultationView();
    } catch (err) {
      showNotification(`Error: ${err.message}`, 'emergency');
    }
  });

  // Outcome: Open Bed Admission Modal
  document.getElementById('btn-open-admission-modal').addEventListener('click', async () => {
    await populateAdmissionBeds();
    openModal('modal-admit');
  });

  // Outcome: Confirm Bed Admission
  document.getElementById('btn-confirm-admit').addEventListener('click', async () => {
    const visitId = document.getElementById('consult-visit-id').value;
    const bedId = document.getElementById('admit-bed-select').value;
    const reason = document.getElementById('admit-reason').value.trim();
    const notes = document.getElementById('consult-notes').value.trim();

    if (!bedId) {
      showNotification('Please select an available bed.', 'warning');
      return;
    }

    const durationDays = parseInt(document.getElementById('admit-duration-days').value, 10) || 3;

    try {
      const res = await fetch('/api/consultations/admit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId,
          bedId,
          durationDays,
          notes: notes ? `${notes}\nAdmission Note: ${reason}` : reason
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      closeModal('modal-admit');
      const billInfo = data.bill ? ` Inpatient invoice ${data.bill.id} generated for ₹${data.bill.totalPayable}.` : '';
      showNotification(`Patient admitted to Bed ${data.bed.id} (${data.bed.ward}) (AdmittedState).${billInfo}`, 'success');
      resetConsultationForm();
      loadConsultationView();
    } catch (err) {
      showNotification(`Admission Failed: ${err.message}`, 'emergency');
    }
  });

  // Outcome: Open Referral Modal
  document.getElementById('btn-open-referral-modal').addEventListener('click', () => {
    openModal('modal-refer');
  });

  // Outcome: Confirm Referral
  document.getElementById('btn-confirm-refer').addEventListener('click', async () => {
    const visitId = document.getElementById('consult-visit-id').value;
    const facility = document.getElementById('refer-facility').value.trim();
    const reason = document.getElementById('refer-reason').value.trim();
    const notes = document.getElementById('consult-notes').value.trim();

    if (!facility || !reason) {
      showNotification('Facility and referral reason are required.', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/consultations/refer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId,
          facility,
          reason,
          notes
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      closeModal('modal-refer');
      showNotification(`Patient successfully referred to ${facility} (ReferredState).`, 'success');
      resetConsultationForm();
      loadConsultationView();
    } catch (err) {
      showNotification(`Referral Failed: ${err.message}`, 'emergency');
    }
  });

  // State Pattern: Evaluate Escalation Directive (PDF Spec, Page 5 & 8)
  const escalateBtn = document.getElementById('btn-escalate-case');
  if (escalateBtn) {
    escalateBtn.addEventListener('click', async () => {
      const visitId = document.getElementById('consult-visit-id').value;
      if (!visitId) return;

      try {
        const res = await fetch('/api/consultations/escalate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitId })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        const banner = document.getElementById('escalation-result-banner');
        banner.style.display = 'block';
        banner.innerHTML = `<strong>Triage Escalation Directive:</strong> ${escapeHtml(data.directive)}`;
        showNotification(data.directive, data.severityScore >= 8 ? 'emergency' : 'info', 7000);
      } catch (err) {
        showNotification(`Escalation Error: ${err.message}`, 'emergency');
      }
    });
  }

  // History search
  document.getElementById('btn-search-history').addEventListener('click', () => {
    loadHistoryData(document.getElementById('history-search-input').value.trim());
  });

  // Billing & Tariffs (Façade Subsystem 3)
  const btnQuickBill = document.getElementById('btn-quick-view-bill');
  if (btnQuickBill) {
    btnQuickBill.addEventListener('click', () => switchView('billing'));
  }

  const btnRefreshBilling = document.getElementById('btn-refresh-billing');
  if (btnRefreshBilling) {
    btnRefreshBilling.addEventListener('click', () => loadBillingView());
  }

  const billSearch = document.getElementById('billing-search-input');
  if (billSearch) {
    billSearch.addEventListener('input', () => filterBillingTable());
  }

  const billFilter = document.getElementById('billing-filter-status');
  if (billFilter) {
    billFilter.addEventListener('change', () => filterBillingTable());
  }

  const btnPrintReceipt = document.getElementById('btn-print-receipt');
  if (btnPrintReceipt) {
    btnPrintReceipt.addEventListener('click', () => printReceipt());
  }

  const admitBedSelect = document.getElementById('admit-bed-select');
  if (admitBedSelect) {
    admitBedSelect.addEventListener('change', updateAdmissionTariffPreview);
  }

  const admitDuration = document.getElementById('admit-duration-days');
  if (admitDuration) {
    admitDuration.addEventListener('input', updateAdmissionTariffPreview);
  }
}

function checkLiveTriageAlerts() {
  const alertsContainer = document.getElementById('triage-live-alerts');
  const alerts = [];

  const spo2 = parseInt(document.getElementById('triage-spo2').value, 10);
  if (!isNaN(spo2) && spo2 < 92) {
    alerts.push(`Critical SpO2: ${spo2}% (Below 92%). Staff escalation required.`);
  }

  const hr = parseInt(document.getElementById('triage-hr').value, 10);
  if (!isNaN(hr) && (hr > 120 || hr < 50)) {
    alerts.push(`Abnormal Heart Rate: ${hr} bpm.`);
  }

  const temp = parseFloat(document.getElementById('triage-temp').value);
  if (!isNaN(temp) && (temp > 39.0 || temp < 35.0)) {
    alerts.push(`Abnormal Body Temperature: ${temp}°C.`);
  }

  const bp = document.getElementById('triage-bp').value.trim();
  if (bp.includes('/')) {
    const sys = parseInt(bp.split('/')[0], 10);
    if (!isNaN(sys) && sys >= 180) {
      alerts.push(`Hypertensive Urgency: Systolic BP ${sys} mmHg.`);
    }
  }

  if (alerts.length > 0) {
    alertsContainer.innerHTML = `
      <div class="alert-box emergency" style="margin-top: 14px; padding: 10px 14px; border-radius: var(--border-radius); border-left: 4px solid var(--accent-emergency);">
        <div style="font-weight: 600; font-size: 12px; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
          <span>⚠️</span> <span>Clinical Red Flags Detected (${alerts.length})</span>
        </div>
        <ul style="margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.5;">
          ${alerts.map(a => `<li>${escapeHtml(a)}</li>`).join('')}
        </ul>
      </div>
    `;
  } else {
    alertsContainer.innerHTML = '';
  }

  // Automatic Factory Triage Assessment & Doctor Allotment
  const spo2Val = document.getElementById('triage-spo2').value;
  const hrVal = document.getElementById('triage-hr').value;
  const tempVal = document.getElementById('triage-temp').value;
  const bpVal = document.getElementById('triage-bp').value.trim();
  const rrVal = document.getElementById('triage-rr').value;
  const ageVal = document.getElementById('triage-age') ? document.getElementById('triage-age').value : '';
  const complaintVal = document.getElementById('triage-complaint') ? document.getElementById('triage-complaint').value.trim() : '';

  const hasAnyInput = spo2Val !== '' || hrVal !== '' || tempVal !== '' || bpVal !== '' || rrVal !== '' || ageVal !== '' || complaintVal !== '';
  const autoDisplay = document.getElementById('triage-auto-display');
  const autoText = document.getElementById('triage-auto-text');
  const autoBadge = document.getElementById('triage-auto-badge');
  const hiddenCategory = document.getElementById('triage-category');

  if (hasAnyInput) {
    fetch('/api/triage/auto-assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oxygenSaturation: spo2Val,
        heartRate: hrVal,
        temperature: tempVal,
        bloodPressure: bpVal,
        respiratoryRate: rrVal,
        age: ageVal,
        chiefComplaint: complaintVal
      })
    })
      .then(res => res.json())
      .then(result => {
        if (result.success && result.data) {
          const autoCat = result.data.triageCategory;
          const pLevel = result.data.priorityLevel;

          if (hiddenCategory) hiddenCategory.value = autoCat;
          if (autoText) {
            autoText.innerHTML = `<span style="font-weight: 700; color: var(--text-main);">${autoCat}</span> <span style="font-weight: 400; color: var(--text-muted); font-size: 12px;">(Priority ${pLevel})</span>`;
          }
          if (autoBadge) {
            autoBadge.innerHTML = `<span class="badge badge-p${pLevel}" style="font-size: 10px; padding: 2px 8px; font-weight: 600;">System Assigned</span>`;
          }
          if (autoDisplay) {
            const colors = {
              1: 'var(--accent-emergency)',
              2: 'var(--accent-urgent)',
              3: 'var(--primary)',
              4: 'var(--accent-success)'
            };
            autoDisplay.style.borderColor = colors[pLevel] || 'var(--border-color)';
          }

          // Dynamic Department & Doctor Allotment
          if (result.data.suggestedDepartment) {
            const deptInput = document.getElementById('triage-dept-display');
            if (deptInput) deptInput.value = result.data.suggestedDepartment;
          }
          if (result.data.allottedDoctor) {
            const doc = result.data.allottedDoctor;
            const docIdInput = document.getElementById('triage-doctor-id');
            if (docIdInput) docIdInput.value = doc.id;
            const docText = document.getElementById('triage-allotted-doctor-text');
            if (docText) docText.textContent = `${doc.name} (${doc.specialty})`;
            const docBadge = document.getElementById('triage-doctor-badge');
            if (docBadge) {
              docBadge.textContent = 'Auto-Allotted';
              docBadge.className = 'badge badge-success';
            }
            highlightRosterDoctor(doc.id);
          }
        }
      })
      .catch(() => {});
  } else {
    if (hiddenCategory) hiddenCategory.value = 'Standard';
    if (autoText) autoText.textContent = 'Enter vitals to calculate...';
    if (autoBadge) autoBadge.innerHTML = `<span class="badge" style="background: var(--bg-hover); color: var(--text-muted); font-size: 10px;">Awaiting Vitals</span>`;
    if (autoDisplay) autoDisplay.style.borderColor = 'var(--border-color)';
  }
}

// Safe stubs for removed secondary lookup elements
async function loadPatientsList() {}
async function loadTriagePendingVisits() {}
function selectVisitForTriage() {}
function intakeExistingPatient() {}

// ========================================================
// 4. PRIORITY QUEUE
// ========================================================
async function loadQueueData() {
  try {
    const statusFilter = document.getElementById('queue-status-filter').value;
    const [queueRes, docRes] = await Promise.all([
      fetch('/api/queue'),
      fetch('/api/doctors')
    ]);

    const queueData = await queueRes.json();
    const docData = await docRes.json();

    if (docData.success) {
      cachedDoctors = docData.data;
    }

    // Populate Doctor dropdown for calling
    const docSelect = document.getElementById('call-doctor-select');
    docSelect.innerHTML = '<option value="">-- Available Doctor --</option>';
    if (docData.success) {
      docData.data.filter(d => d.availabilityStatus === 'Available').forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = `${d.name} (${d.specialty})`;
        docSelect.appendChild(opt);
      });
    }

    if (queueData.success) {
      cachedQueueEntries = queueData.data;
      let entries = queueData.data;
      if (statusFilter !== 'ALL') {
        entries = entries.filter(e => e.queueStatus === statusFilter);
      }
      renderQueueTable(entries);
    }
  } catch (err) {
    console.error('Error loading queue:', err);
  }
}

function renderQueueTable(entries) {
  const tbody = document.querySelector('#priority-queue-table tbody');
  if (!entries || entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-placeholder">No patients matching filter.</td></tr>';
    return;
  }

  tbody.innerHTML = entries.map(item => `
    <tr>
      <td><span class="badge badge-p${item.triagePriority}">Priority ${item.triagePriority}</span></td>
      <td><strong>${escapeHtml(item.patientName)}</strong></td>
      <td>${item.patientAge || 'N/A'}</td>
      <td>${escapeHtml(item.chiefComplaint || 'N/A')}</td>
      <td>${item.triageCategory}</td>
      <td>${item.waitMinutes} mins</td>
      <td>
        <span class="badge badge-status-${item.queueStatus.toLowerCase().replace(' ', '')}">
          ${item.queueStatus}
        </span>
      </td>
      <td>${item.assignedDoctorName ? `<span class="badge" style="background: var(--bg-hover); font-size: 11px;">${escapeHtml(item.assignedDoctorName)}</span>` : '<span style="color:var(--text-light)">Unassigned</span>'}</td>
      <td>
        ${item.queueStatus === 'Waiting' ? `
          <button class="btn btn-primary btn-sm" onclick="callSpecificVisit('${item.patientVisitId}')">
            Call
          </button>
        ` : ''}
        ${item.queueStatus === 'Called' ? `
          <button class="btn btn-secondary btn-sm" onclick="requeueVisit('${item.patientVisitId}')">
            Missed / Requeue
          </button>
          <button class="btn btn-primary btn-sm" onclick="directToConsultation('${item.patientVisitId}')">
            Enter Desk
          </button>
        ` : ''}
      </td>
    </tr>
  `).join('');
}

function filterQueueTable() {
  const query = document.getElementById('queue-filter-input').value.toLowerCase().trim();
  const rows = document.querySelectorAll('#priority-queue-table tbody tr');
  rows.forEach(row => {
    const text = row.innerText.toLowerCase();
    row.style.display = text.includes(query) ? '' : 'none';
  });
}

async function callSpecificVisit(visitId) {
  let doctorId = document.getElementById('call-doctor-select').value;
  if (!doctorId && cachedQueueEntries) {
    const entry = cachedQueueEntries.find(q => q.patientVisitId === visitId);
    if (entry && entry.assignedDoctorId) {
      doctorId = entry.assignedDoctorId;
    }
  }
  if (!doctorId) {
    showNotification('Please select an available doctor in the top selector to call this patient.', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/queue/call-next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doctorId, visitId })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showNotification(`Patient called for doctor consultation.`, 'info');
    loadQueueData();
  } catch (err) {
    showNotification(`Call Error: ${err.message}`, 'warning');
  }
}

async function requeueVisit(visitId) {
  if (!confirm('Patient missed call. Re-queue patient back to Waiting status?')) return;

  try {
    const res = await fetch('/api/queue/requeue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitId, reason: 'Patient did not answer call. Re-queued.' })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showNotification('Patient re-queued to waiting queue.', 'info');
    loadQueueData();
  } catch (err) {
    showNotification(`Error: ${err.message}`, 'emergency');
  }
}

async function directToConsultation(visitId) {
  switchView('consultation');
  await loadConsultationView();
  await loadVisitIntoConsultation(visitId);
}

// ========================================================
// 5. CONSULTATION DESK
// ========================================================
async function loadConsultationView(selectedDoctorId = null) {
  try {
    const docRes = await fetch('/api/doctors');
    const docData = await docRes.json();
    const select = document.getElementById('consult-doctor-desk');
    if (!select) return;
    const currentVal = selectedDoctorId || select.value || (activeConsultationVisit && activeConsultationVisit.assignedDoctorId) || '';

    select.innerHTML = '<option value="">-- Select Attending Doctor --</option>';

    if (docData.success) {
      cachedDoctors = docData.data;
      docData.data.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = `${d.name} (${d.specialty}) [${d.availabilityStatus}]`;
        select.appendChild(opt);
      });
    }

    if (currentVal) {
      select.value = currentVal;
    }
  } catch (err) {
    console.error('Error loading consultation view:', err);
  }
}

async function loadActiveDoctorConsultation(doctorId) {
  if (!doctorId) {
    resetConsultationForm();
    return;
  }

  try {
    const visitsRes = await fetch('/api/visits');
    const visitsData = await visitsRes.json();
    if (!visitsData.success) return;

    // Look for visit currently In Consultation or Called with this doctor
    const activeVisit = visitsData.data.find(v => 
      v.assignedDoctorId === doctorId && (v.currentState === 'In Consultation' || v.currentState === 'Called')
    );

    if (activeVisit) {
      loadVisitIntoConsultation(activeVisit.id);
    } else {
      resetConsultationForm();
      document.getElementById('consultation-active-panel').innerHTML = `
        <div class="empty-placeholder">
          Doctor has no active patient called or in consultation. Call next patient from Priority Queue.
        </div>
      `;
    }
  } catch (err) {
    console.error('Error loading active consultation:', err);
  }
}

async function loadVisitIntoConsultation(visitId) {
  try {
    const res = await fetch(`/api/visits/${visitId}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const v = data.data;
    activeConsultationVisit = v;

    document.getElementById('consult-visit-id').value = v.id;
    document.getElementById('consult-notes').value = v.consultationNotes || '';

    // Synchronize top consulting doctor dropdown
    const select = document.getElementById('consult-doctor-desk');
    if (select && v.assignedDoctorId) {
      select.value = v.assignedDoctorId;
    }

    // Resolve assigned doctor
    const doc = v.doctor || (v.assignedDoctorId && cachedDoctors ? cachedDoctors.find(d => d.id === v.assignedDoctorId) : null);
    const docName = doc ? `${doc.name} (${doc.specialty})` : (v.assignedDoctorId || 'Unassigned');

    // Render Patient Info Card
    const p = v.patient || {};
    const a = v.assessment || {};
    const alerts = a.clinicalAlerts || [];

    const isCalled = v.currentState === 'Called';
    const isInConsult = v.currentState === 'In Consultation';

    document.getElementById('consultation-active-panel').innerHTML = `
      <div style="border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h3 style="font-size: 16px; font-weight: 700;">${escapeHtml(p.name || 'Unknown')}</h3>
          <span class="badge badge-status-${v.currentState.toLowerCase().replace(' ', '')}">${v.currentState}</span>
        </div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
          Visit ID: <code>${v.id}</code> | Age: ${p.age || 'N/A'} yrs | Gender: ${p.gender || 'N/A'} | Contact: ${p.contactNumber || 'N/A'}
        </div>
        <div style="margin-top: 8px; padding: 6px 12px; background: var(--bg-hover); border-radius: var(--border-radius); border-left: 3px solid var(--primary); display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size: 12px; color: var(--text-muted); font-weight: 500;">Attending Doctor:</span>
          <span style="font-size: 13px; font-weight: 700; color: var(--primary);">🩺 ${escapeHtml(docName)}</span>
        </div>
        ${p.medicalAlerts ? `<div style="margin-top: 6px; font-size: 12px; color: var(--emergency-red);"><strong>Alerts:</strong> ${escapeHtml(p.medicalAlerts)}</div>` : ''}
      </div>

      <div style="margin-bottom: 14px;">
        <h4 style="font-size: 13px; font-weight: 600; margin-bottom: 4px;">Clinical Triage Findings (${a.triageCategory || 'Standard'} - Priority ${a.priorityLevel || 3})</h4>
        <div style="font-size: 13px; color: var(--text-main);">
          <strong>Chief Complaint:</strong> ${escapeHtml(a.chiefComplaint || 'N/A')}
        </div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
          <strong>Symptoms:</strong> ${(a.symptoms || []).join(', ') || 'None recorded'}
        </div>
      </div>

      <div class="metrics-grid" style="grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px;">
        <div style="background: var(--bg-app); padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
          <div style="font-size: 11px; color: var(--text-muted);">SpO2</div>
          <div style="font-size: 16px; font-weight: 700; ${a.oxygenSaturation && a.oxygenSaturation < 92 ? 'color:var(--emergency-red);' : ''}">${a.oxygenSaturation ? `${a.oxygenSaturation}%` : '--'}</div>
        </div>
        <div style="background: var(--bg-app); padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
          <div style="font-size: 11px; color: var(--text-muted);">Blood Pressure</div>
          <div style="font-size: 16px; font-weight: 700;">${a.bloodPressure || '--'}</div>
        </div>
        <div style="background: var(--bg-app); padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
          <div style="font-size: 11px; color: var(--text-muted);">Heart Rate</div>
          <div style="font-size: 16px; font-weight: 700;">${a.heartRate ? `${a.heartRate} bpm` : '--'}</div>
        </div>
      </div>

      ${alerts.length > 0 ? `
        <div class="alert-box emergency" style="padding: 8px 12px; font-size: 12px; margin-bottom: 14px;">
          <strong>Clinical Warnings:</strong><br>
          ${alerts.map(al => `• ${escapeHtml(al)}`).join('<br>')}
        </div>
      ` : ''}

      ${isCalled ? `
        <button class="btn btn-primary" style="width: 100%; margin-top: 10px;" onclick="startConsultation('${v.id}', '${v.assignedDoctorId}')">
          Begin Patient Consultation
        </button>
      ` : ''}
    `;

    // Enable/disable outcome buttons based on state
    const outcomeButtonsEnabled = isInConsult;
    document.getElementById('btn-outcome-complete').disabled = !outcomeButtonsEnabled;
    document.getElementById('btn-open-admission-modal').disabled = !outcomeButtonsEnabled;
    document.getElementById('btn-open-referral-modal').disabled = !outcomeButtonsEnabled;
    const escBtn = document.getElementById('btn-escalate-case');
    if (escBtn) escBtn.disabled = !outcomeButtonsEnabled;

    if (v.assignedDoctorId && select) {
      select.value = v.assignedDoctorId;
    }
  } catch (err) {
    showNotification(`Failed to load visit into consultation: ${err.message}`, 'emergency');
  }
}

async function startConsultation(visitId, doctorId) {
  const docId = doctorId || (activeConsultationVisit && activeConsultationVisit.assignedDoctorId) || document.getElementById('consult-doctor-desk').value;
  try {
    const res = await fetch('/api/consultations/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitId, doctorId: docId })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showNotification(`Consultation started (State Pattern: InConsultationState).`, 'success');
    loadVisitIntoConsultation(visitId);
  } catch (err) {
    showNotification(`Error starting consultation: ${err.message}`, 'emergency');
  }
}

function resetConsultationForm() {
  activeConsultationVisit = null;
  document.getElementById('consult-visit-id').value = '';
  document.getElementById('consult-notes').value = '';
  document.getElementById('btn-outcome-complete').disabled = true;
  document.getElementById('btn-open-admission-modal').disabled = true;
  document.getElementById('btn-open-referral-modal').disabled = true;
  const escBtn = document.getElementById('btn-escalate-case');
  if (escBtn) escBtn.disabled = true;
  const escBanner = document.getElementById('escalation-result-banner');
  if (escBanner) {
    escBanner.style.display = 'none';
    escBanner.innerHTML = '';
  }
  document.getElementById('consultation-active-panel').innerHTML = `
    <div class="empty-placeholder">
      No active patient selected. Select an attending physician or call next patient.
    </div>
  `;
}

async function populateAdmissionBeds() {
  try {
    const res = await fetch('/api/beds');
    const data = await res.json();
    const select = document.getElementById('admit-bed-select');
    select.innerHTML = '<option value="">-- Select Available Bed --</option>';

    if (data.success) {
      const availBeds = data.data.filter(b => b.availabilityStatus === 'Available');
      if (availBeds.length === 0) {
        select.innerHTML = '<option value="">No beds currently available!</option>';
        return;
      }
      availBeds.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = `${b.id} — ${b.ward} (₹${b.dailyRate || 500}/day)`;
        opt.dataset.ward = b.ward;
        opt.dataset.dailyRate = b.dailyRate || 500;
        select.appendChild(opt);
      });
      updateAdmissionTariffPreview();
    }
  } catch (err) {
    console.error('Error fetching beds:', err);
  }
}

// ========================================================
// 6. DOCTORS & BEDS MANAGEMENT
// ========================================================
async function loadResourcesData() {
  try {
    const [docRes, bedRes] = await Promise.all([
      fetch('/api/doctors'),
      fetch('/api/beds')
    ]);

    const docData = await docRes.json();
    const bedData = await bedRes.json();

    if (docData.success) {
      renderDoctorsTable(docData.data);
    }

    if (bedData.success) {
      renderBedsTable(bedData.data);
    }
  } catch (err) {
    console.error('Error loading resources:', err);
  }
}

function renderDoctorsTable(doctors) {
  const tbody = document.querySelector('#doctors-manage-table tbody');
  tbody.innerHTML = doctors.map(d => {
    const isConsulting = d.availabilityStatus === 'In Consultation';
    return `
      <tr>
        <td><code>${d.id}</code></td>
        <td><strong>${escapeHtml(d.name)}</strong></td>
        <td>${escapeHtml(d.specialty)}</td>
        <td>
          ${isConsulting ? `
            <span class="badge badge-p2" style="background:#fee2e2; color:#991b1b; border:1px solid #f87171; font-weight:600;">In Consultation</span>
          ` : `
            <select onchange="updateDoctorStatus('${d.id}', this.value)" style="width: auto; min-width: 125px; padding: 4px 8px; font-size: 12px; font-weight: 500; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: ${d.availabilityStatus === 'Available' ? '#ecfdf5' : '#f8fafc'}; color: ${d.availabilityStatus === 'Available' ? '#065f46' : '#334155'};">
              <option value="Available" ${d.availabilityStatus === 'Available' ? 'selected' : ''}>Available</option>
              <option value="On Break" ${d.availabilityStatus === 'On Break' ? 'selected' : ''}>On Break</option>
              <option value="Off Duty" ${d.availabilityStatus === 'Off Duty' ? 'selected' : ''}>Off Duty</option>
            </select>
          `}
        </td>
      </tr>
    `;
  }).join('');
}

async function updateDoctorStatus(doctorId, status) {
  try {
    const res = await fetch('/api/doctors/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doctorId, status })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showNotification(`Doctor status updated to ${status}.`, 'info');
    loadResourcesData();
  } catch (err) {
    showNotification(`Failed to update doctor status: ${err.message}`, 'emergency');
  }
}

function renderBedsTable(beds) {
  const tbody = document.querySelector('#beds-manage-table tbody');
  tbody.innerHTML = beds.map(b => `
    <tr>
      <td><code>${b.id}</code></td>
      <td>${escapeHtml(b.ward)}</td>
      <td>
        <span class="badge ${b.availabilityStatus === 'Available' ? 'badge-status-completed' : 'badge-p1'}">
          ${b.availabilityStatus}
        </span>
      </td>
      <td>${b.allocatedVisitId ? `<code>${b.allocatedVisitId}</code>` : '<span style="color:var(--text-light)">None</span>'}</td>
      <td>
        ${b.availabilityStatus === 'Available' ? `
          <button class="btn btn-primary btn-sm" onclick="openDirectBedAllocation('${b.id}', '${escapeHtml(b.ward)}')">
            Allocate Bed
          </button>
        ` : ''}
        ${b.availabilityStatus === 'Occupied' ? `
          <button class="btn btn-secondary btn-sm" onclick="releaseBed('${b.id}')">
            Release Bed
          </button>
        ` : ''}
      </td>
    </tr>
  `).join('');
}

async function openDirectBedAllocation(bedId, ward) {
  try {
    const res = await fetch('/api/visits');
    const data = await res.json();
    const select = document.getElementById('direct-admit-visit-select');
    select.innerHTML = '<option value="">-- Select Patient Visit to Admit --</option>';

    if (data.success) {
      const eligibleVisits = (data.data || []).filter(v => 
        !['Completed', 'Admitted', 'Referred'].includes(v.currentState)
      );

      if (eligibleVisits.length === 0) {
        select.innerHTML = '<option value="">No active unadmitted visits available</option>';
      } else {
        eligibleVisits.forEach(v => {
          const opt = document.createElement('option');
          opt.value = v.id;
          opt.textContent = `${v.id} — ${v.patient ? v.patient.name : 'Patient'} (${v.currentState})`;
          select.appendChild(opt);
        });
      }
    }

    document.getElementById('direct-admit-bed-id').value = bedId;
    document.getElementById('direct-admit-modal-title').textContent = `Allocate Bed ${bedId} (${ward})`;
    document.getElementById('direct-admit-notes').value = '';
    openModal('modal-direct-admit');
  } catch (err) {
    showNotification(`Failed to open bed allocation: ${err.message}`, 'emergency');
  }
}

async function releaseBed(bedId) {
  if (!confirm(`Release and sanitize Bed ${bedId}?`)) return;

  try {
    const res = await fetch(`/api/beds/release/${bedId}`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showNotification(`Bed ${bedId} released and marked Available.`, 'success');
    loadResourcesData();
  } catch (err) {
    showNotification(`Error: ${err.message}`, 'emergency');
  }
}

// ========================================================
// 7. VISIT HISTORY & AUDIT TRAIL
// ========================================================
async function loadHistoryData(query = '') {
  try {
    const res = await fetch(`/api/history${query ? `?q=${encodeURIComponent(query)}` : ''}`);
    const data = await res.json();
    const tbody = document.querySelector('#history-table tbody');

    if (!data.success || data.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-placeholder">No resolved visit records found.</td></tr>';
      return;
    }

    tbody.innerHTML = data.data.map(item => `
      <tr>
        <td><code>${item.visitId}</code></td>
        <td><strong>${escapeHtml(item.patientName)}</strong></td>
        <td>${escapeHtml(item.chiefComplaint || 'N/A')}</td>
        <td>${item.triageCategory || 'Standard'}</td>
        <td>${escapeHtml(item.assignedDoctorName || 'None')}</td>
        <td>
          <span class="badge badge-status-${item.visitOutcome.toLowerCase()}">
            ${item.visitOutcome}
          </span>
        </td>
        <td>${new Date(item.registrationTimestamp).toLocaleDateString()}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="viewAuditTrail('${item.visitId}')">
            Audit Trail
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error fetching history:', err);
  }
}

async function viewAuditTrail(visitId) {
  try {
    const res = await fetch(`/api/visits/${visitId}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const v = data.data;
    document.getElementById('audit-modal-title').textContent = `Lifecycle Audit Trail — Visit ${v.id}`;

    const body = document.getElementById('audit-modal-body');
    const p = v.patient || {};
    const a = v.assessment || {};

    let html = `
      <div style="margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color);">
        <div style="font-size: 15px; font-weight: 700;">${escapeHtml(p.name || 'Patient')} (ID: ${p.id || 'N/A'})</div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
          Outcome: <strong>${v.visitOutcome || v.currentState}</strong> | Registered: ${new Date(v.registrationTimestamp).toLocaleString()}
        </div>
        ${v.consultationNotes ? `<div style="font-size: 12px; margin-top: 6px;"><strong>Consultation Notes:</strong> ${escapeHtml(v.consultationNotes)}</div>` : ''}
        ${v.allocatedBedId ? `<div style="font-size: 12px; color: var(--primary);"><strong>Inpatient Bed Allocated:</strong> ${v.allocatedBedId}</div>` : ''}
        ${v.referralDetails ? `<div style="font-size: 12px; color: #7e22ce;"><strong>Referred To:</strong> ${escapeHtml(v.referralDetails.facility)} (${escapeHtml(v.referralDetails.reason)})</div>` : ''}
      </div>

      <h4 style="font-size: 13px; font-weight: 600; margin-bottom: 8px;">State Pattern Transitions Timeline</h4>
      <ul class="timeline">
    `;

    (v.stateHistory || []).forEach(step => {
      html += `
        <li class="timeline-item">
          <span class="timeline-point"></span>
          <div class="timeline-content">
            <strong>${step.fromState ? `${step.fromState} → ` : ''}${step.toState}</strong>
            <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(step.note || step.action)}</div>
            <div class="timeline-time">${new Date(step.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
          </div>
        </li>
      `;
    });

    html += `</ul>`;
    body.innerHTML = html;
    openModal('modal-audit');
  } catch (err) {
    showNotification(`Error: ${err.message}`, 'emergency');
  }
}

// Utility: XSS prevention
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ========================================================
// 8. BILLING & TARIFF SUBSYSTEM (Façade Subsystem 3)
// ========================================================
let cachedBills = [];
let activeReceiptBill = null;

function updateAdmissionTariffPreview() {
  const bedSelect = document.getElementById('admit-bed-select');
  const durationInput = document.getElementById('admit-duration-days');
  const days = Math.max(1, parseInt(durationInput ? durationInput.value : 3, 10) || 1);

  let ward = 'General Ward';
  let dailyRate = 500;

  if (bedSelect && bedSelect.selectedOptions && bedSelect.selectedOptions[0]) {
    const opt = bedSelect.selectedOptions[0];
    if (opt.dataset && opt.dataset.ward) ward = opt.dataset.ward;
    if (opt.dataset && opt.dataset.dailyRate) dailyRate = parseInt(opt.dataset.dailyRate, 10) || 500;
  }

  const roomTotal = dailyRate * days;
  const docFee = 500;
  const pharmacy = 350;
  const subtotal = roomTotal + docFee + pharmacy;
  const subsidy = Math.round(subtotal * 0.15);
  const netTotal = subtotal - subsidy;

  const roomElem = document.getElementById('admit-calc-room');
  if (roomElem) roomElem.textContent = `${days} day${days > 1 ? 's' : ''} × ₹${dailyRate}/day = ₹${roomTotal.toLocaleString()}`;

  const subsidyElem = document.getElementById('admit-calc-subsidy');
  if (subsidyElem) subsidyElem.textContent = `- ₹${subsidy.toLocaleString()}`;

  const totalElem = document.getElementById('admit-calc-total');
  if (totalElem) totalElem.textContent = `₹${netTotal.toLocaleString()}`;
}

async function loadBillingView() {
  try {
    const res = await fetch('/api/billing/bills');
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const { bills, metrics } = data.data;
    cachedBills = bills || [];

    // Update KPI metrics
    const totalRevElem = document.getElementById('billing-metric-total');
    if (totalRevElem) totalRevElem.textContent = `₹${(metrics.totalInvoiced || 0).toLocaleString()}`;

    const billsCountElem = document.getElementById('billing-metric-bills-count');
    if (billsCountElem) billsCountElem.textContent = `${metrics.totalBills || 0} Invoices Issued`;

    const settledElem = document.getElementById('billing-metric-settled');
    if (settledElem) settledElem.textContent = `${metrics.settledCount || 0}`;

    const pendingElem = document.getElementById('billing-metric-pending');
    if (pendingElem) pendingElem.textContent = `${metrics.pendingCount || 0}`;

    const subsidyElem = document.getElementById('billing-metric-subsidy');
    if (subsidyElem) subsidyElem.textContent = `₹${(metrics.totalSubsidies || 0).toLocaleString()}`;

    renderBillingTable(cachedBills);
  } catch (err) {
    console.error('Error loading billing view:', err);
    showNotification(`Failed to load billing registry: ${err.message}`, 'emergency');
  }
}

function filterBillingTable() {
  const query = (document.getElementById('billing-search-input').value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('billing-filter-status').value;

  const filtered = cachedBills.filter(b => {
    const matchQuery = !query ||
      (b.id && b.id.toLowerCase().includes(query)) ||
      (b.visitId && b.visitId.toLowerCase().includes(query)) ||
      (b.patientName && b.patientName.toLowerCase().includes(query)) ||
      (b.billType && b.billType.toLowerCase().includes(query));

    const matchStatus = statusFilter === 'ALL' || b.status === statusFilter;
    return matchQuery && matchStatus;
  });

  renderBillingTable(filtered);
}

function renderBillingTable(bills) {
  const tbody = document.querySelector('#billing-table tbody');
  if (!tbody) return;

  if (bills.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-placeholder">No invoices in registry yet. Conclude outpatient visits or admit patients to generate bills.</td></tr>`;
    return;
  }

  tbody.innerHTML = bills.map(b => {
    const isPaid = b.status === 'Paid' || b.status === 'Settled';
    const dateStr = b.issuedAt ? new Date(b.issuedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';

    return `
      <tr>
        <td><code>${escapeHtml(b.id)}</code></td>
        <td><code>${escapeHtml(b.visitId)}</code></td>
        <td><strong>${escapeHtml(b.patientName || 'Unknown')}</strong></td>
        <td>
          <span style="font-size: 12px; font-weight: 500;">
            ${b.billType === 'Inpatient Ward Admission' ? '🏥 Inpatient' : '🩺 Outpatient'}
          </span>
        </td>
        <td style="font-size: 12px; color: var(--text-secondary);">${dateStr}</td>
        <td>₹${(b.subtotal || 0).toLocaleString()}</td>
        <td style="color: #16a34a;">-₹${(b.subsidyDiscount || 0).toLocaleString()}</td>
        <td><strong>₹${(b.totalPayable || 0).toLocaleString()}</strong></td>
        <td>
          <span class="badge ${isPaid ? 'badge-status-completed' : 'badge-p2'}" style="${isPaid ? '' : 'background:#fff7ed; color:#c2410c; border:1px solid #fdba74;'}">
            ${isPaid ? 'Paid' : 'Pending Settlement'}
          </span>
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-secondary btn-sm" onclick="viewReceipt('${b.id}')" style="padding: 3px 8px; font-size: 11px;">
              View Receipt
            </button>
            ${!isPaid ? `
              <button class="btn btn-primary btn-sm" onclick="quickSettleBill('${b.id}')" style="padding: 3px 8px; font-size: 11px;">
                Settle
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function viewReceipt(billId) {
  const bill = cachedBills.find(b => b.id === billId);
  if (!bill) return;

  activeReceiptBill = bill;

  document.getElementById('receipt-invoice-id').textContent = bill.id;
  document.getElementById('receipt-date').textContent = new Date(bill.issuedAt).toLocaleString();
  document.getElementById('receipt-patient-name').textContent = bill.patientName || 'Patient';
  document.getElementById('receipt-patient-id').textContent = bill.patientId || '--';
  document.getElementById('receipt-contact').textContent = bill.patientContact || 'N/A';
  document.getElementById('receipt-visit-id').textContent = bill.visitId || '--';
  document.getElementById('receipt-bill-type').textContent = bill.billType || '--';
  document.getElementById('receipt-payment-mode').textContent = bill.paymentMethod || 'Cash / Health Card';

  const badgeElem = document.getElementById('receipt-status-badge');
  const isPaid = bill.status === 'Paid' || bill.status === 'Settled';
  badgeElem.textContent = isPaid ? 'Paid & Settled' : 'Pending Settlement';
  badgeElem.className = `badge ${isPaid ? 'badge-status-completed' : 'badge-p2'}`;

  const itemsTbody = document.getElementById('receipt-items-tbody');
  itemsTbody.innerHTML = (bill.items || []).map(it => `
    <tr style="border-bottom: 1px solid var(--border-color);">
      <td style="padding: 8px;">${escapeHtml(it.description)}</td>
      <td style="padding: 8px; text-align: center;">${it.quantity}</td>
      <td style="padding: 8px; text-align: right;">₹${(it.amount || 0).toLocaleString()}</td>
      <td style="padding: 8px; text-align: right; font-weight: 600;">₹${(it.total || 0).toLocaleString()}</td>
    </tr>
  `).join('');

  document.getElementById('receipt-subtotal').textContent = `₹${(bill.subtotal || 0).toLocaleString()}`;
  document.getElementById('receipt-subsidy').textContent = `- ₹${(bill.subsidyDiscount || 0).toLocaleString()}`;
  document.getElementById('receipt-net-total').textContent = `₹${(bill.totalPayable || 0).toLocaleString()}`;

  const settleBtn = document.getElementById('btn-settle-receipt');
  if (settleBtn) {
    settleBtn.style.display = isPaid ? 'none' : 'inline-block';
    settleBtn.onclick = () => quickSettleBill(bill.id);
  }

  openModal('modal-invoice-receipt');
}

async function quickSettleBill(billId) {
  try {
    const res = await fetch('/api/billing/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billId, paymentMethod: 'Hospital Desk Settlement (Cash / Card)' })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showNotification(`Invoice ${billId} settled in full!`, 'success');
    closeModal('modal-invoice-receipt');
    loadBillingView();
  } catch (err) {
    showNotification(`Settlement failed: ${err.message}`, 'emergency');
  }
}

function printReceipt() {
  window.print();
}

// Attach globals for inline onclick
window.viewReceipt = viewReceipt;
window.quickSettleBill = quickSettleBill;
window.updateAdmissionTariffPreview = updateAdmissionTariffPreview;

