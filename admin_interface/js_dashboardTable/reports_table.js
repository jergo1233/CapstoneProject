// Global memory store for reports
let currentReportsList = [];

// Mock Data
const reportsData = [
  {
    reportID: "REP-001",
    fullName: "Juan Dela Cruz",
    issueCategory: "Infrastructures",
    barangayArea: "Brgy. Dapawan, Purok 3",
    issueDescription: "A large pothole has developed along the roadside. The damaged portion of the road is becoming difficult to pass, especially for motorcycles and small vehicles. Residents are requesting immediate road inspection and repair before the damage becomes worse.",
    timestamp: "April 14, 2026 - 08:10 AM",
    reportStatus: "Ongoing",
    supportingImage: []
  },
  {
    reportID: "REP-002",
    fullName: "Andres Bonifacio",
    issueCategory: "Waste Management",
    barangayArea: "Brgy. Mayha, Purok 2, Front of Chapel",
    issueDescription: "May malaking tumatagas na tubo ng tubig sa harap ng Purok 2, umaapaw na ang tubig sa kalsada.",
    timestamp: "April 15, 2026 - 01:20 PM",
    reportStatus: "Received",
    supportingImage: []
  },
  {
    reportID: "REP-003",
    fullName: "Emilio Aguinaldo",
    issueCategory: "Road Obstruction",
    barangayArea: "Brgy. Batiano, Zone 5, Highway Boundary",
    issueDescription: "May mga nakatambak na construction materials sa gitna ng daanan na humaharang sa mga sasakyan.",
    timestamp: "April 18, 2026 - 10:45 AM",
    reportStatus: "Ongoing",
    supportingImage: []
  },
  {
    reportID: "REP-004",
    fullName: "Maria Clara",
    issueCategory: "Drainage and Flooding",
    barangayArea: "Brgy. Tulay, Public Market",
    issueDescription: "The main drainage canal near the public market is heavily clogged with silt, plastics, and debris, causing water to overflow during heavy rainfall. Maintenance personnel are currently on-site clearing the drainage system to restore proper water flow.",
    timestamp: "April 18, 2026 - 10:45 AM",
    reportStatus: "Ongoing",
    supportingImage: []
  }
];

// Helper function para makuha ang angkop na class color
function getStatusClass(status) {
  const statusLower = (status || '').toLowerCase();
  if (statusLower === 'received') return 'card-status-received';
  if (statusLower === 'ongoing') return 'card-status-ongoing';
  if (statusLower === 'resolved') return 'card-status-resolved';
  return '';
}

// Function na nagpapalit ng kulay ng dropdown kapag pinalitan ng user
function handleStatusColorChange(selectElement) {
  selectElement.classList.remove('card-status-received', 'card-status-ongoing', 'card-status-resolved');
  const newClass = getStatusClass(selectElement.value);
  selectElement.classList.add(newClass);
}

// Helper function para mag-format ng bagong timestamp kapag nag-update ng status ang admin
function getFormattedTimestamp() {
  const now = new Date();
  const options = { 
    month: 'long', 
    day: 'numeric', 
    year: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: true 
  };
  return now.toLocaleString('en-US', options).replace(' at', ' -');
}

// Main function to render UI
function renderReports(data) {
  currentReportsList = data; 
  
  const tbody = document.getElementById('reportsTableBody');
  const cardsContainer = document.getElementById('reportsListContainer');

  // 1. Dashboard Table View
  if (tbody) {
    tbody.innerHTML = '';
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="no-results">No residents found matching your search.</td></tr>';
      return;
    }

    data.forEach(report => {
      const tr = document.createElement('tr');
      let statusCSS = '';
      const statusLower = (report.reportStatus || '').toLowerCase();
      if (statusLower === 'received') statusCSS = 'status-received';
      else if (statusLower === 'ongoing') statusCSS = 'status-ongoing';
      else if (statusLower === 'resolved') statusCSS = 'status-resolved';

      tr.innerHTML = `
        <td><strong>${report.reportID}</strong></td>
        <td>${report.fullName}</td>
        <td>${report.issueCategory}</td>
        <td>${report.barangayArea}</td>
        <td class="desc-cell" style="cursor: pointer;" title="Click to view full description and images" onclick="openModal('${report.reportID}')">
          ${report.issueDescription}
        </td>
        <td>${report.timestamp}</td>
        <td><span class="status-badge ${statusCSS}">${report.reportStatus}</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  // 2. Report Management Card View
  if (cardsContainer) {
    cardsContainer.innerHTML = '';
    if (data.length === 0) {
      cardsContainer.innerHTML = '<p style="text-align:center; color:#777; padding:20px;">No reports found.</p>';
      return;
    }

    data.forEach(report => {
      const card = document.createElement('div');
      card.className = 'report_card';

      let imagesHTML = '';
      if (report.supportingImage && report.supportingImage.length > 0) {
        report.supportingImage.forEach(url => {
          imagesHTML += `<img src="${url}" class="img_placeholder" alt="Report Image">`;
        });
      } else {
        imagesHTML = `
          <div class="img_placeholder"></div>
          <div class="img_placeholder"></div>
        `;
      }

      const statusColorClass = getStatusClass(report.reportStatus);

      card.innerHTML = `
        <div class="card_header">
          <div class="resident_name">${report.fullName}</div>
          <select id="status-select-${report.reportID}" class="status_select ${statusColorClass}" onchange="handleStatusColorChange(this)">
            <option value="Received" ${report.reportStatus === 'Received' ? 'selected' : ''}>Received</option>
            <option value="Ongoing" ${report.reportStatus === 'Ongoing' ? 'selected' : ''}>Ongoing</option>
            <option value="Resolved" ${report.reportStatus === 'Resolved' ? 'selected' : ''}>Resolved</option>
          </select>
        </div>

        <div class="report_details">
          <p><strong>Report ID:</strong> ${report.reportID}</p>
          <p><strong>Category:</strong> ${report.issueCategory}</p>
          <p><strong>Location:</strong> ${report.barangayArea}</p>
          <p><strong>Description:</strong></p>
          <p class="desc_report_management">${report.issueDescription}</p>
        </div>

        <div class="card_images">
          ${imagesHTML}
        </div>

        <div class="card_footer">
          <div class="report_date">Date: ${report.timestamp}</div>
          <div class="card_actions">
            <button class="btn_delete" onclick="deleteReport('${report.reportID}')">Delete</button>
            <button class="btn_update" onclick="updateReportStatus('${report.reportID}')">Update status</button>
          </div>
        </div>
      `;

      cardsContainer.appendChild(card);
    });
  }
}

// Live Search Filter
function filterReports() {
  const input = document.getElementById('residentSearchInput');
  if (!input) return;

  const query = input.value.toLowerCase();
  const filteredData = reportsData.filter(report => 
    report.fullName.toLowerCase().includes(query) ||
    report.reportID.toLowerCase().includes(query) ||
    report.issueCategory.toLowerCase().includes(query)
  );
  renderReports(filteredData);
}

// Function para sa Delete Button
function deleteReport(id) {
  const confirmDelete = confirm(`Are you sure you want to delete the report? (${id})?`);
  
  if (confirmDelete) {
    const index = reportsData.findIndex(item => item.reportID === id);
    if (index !== -1) {
      reportsData.splice(index, 1);
      filterReports();
    }
  }
}

// Function para sa Update Status Button
function updateReportStatus(id) {
  const selectElement = document.getElementById(`status-select-${id}`);
  if (!selectElement) return;

  const newStatus = selectElement.value;
  const report = reportsData.find(item => item.reportID === id);

  if (report) {
    report.reportStatus = newStatus;
    report.timestamp = getFormattedTimestamp(); // Naba-bago rin ang timestamp kapag na-update na ito ni admin
    alert(`Report status ${id} has been successfully updated to "${newStatus}".`);
    filterReports();
  }
}

// Modal Control Functions (for Dashboard Table)
function openModal(id) {
  const report = currentReportsList.find(item => item.reportID === id);
  if (!report) return;

  const modal = document.getElementById('descModal');
  const imagesGrid = document.getElementById('modalImagesGrid');

  document.getElementById('modalReportId').innerText = `Report Details - ${report.reportID}`;
  document.getElementById('modalDescription').innerText = report.issueDescription;

  imagesGrid.innerHTML = '';
  if (report.supportingImage && report.supportingImage.length > 0) {
    report.supportingImage.forEach(imgUrl => {
      const img = document.createElement('img');
      img.src = imgUrl;
      img.alt = `Report Image ${report.reportID}`;
      img.className = 'modal-img-thumb';
      img.onclick = () => window.open(imgUrl, '_blank');
      imagesGrid.appendChild(img);
    });
  } else {
    imagesGrid.innerHTML = '<p class="no-images-text">No images attached to this report.</p>';
  }

  modal.classList.add('active');
}

function closeModal(event) {
  if (event.target.id === 'descModal') {
    document.getElementById('descModal').classList.remove('active');
  }
}

function closeModalDirect() {
  document.getElementById('descModal').classList.remove('active');
}

// Initial Load on page DOM ready
document.addEventListener('DOMContentLoaded', () => {
  renderReports(reportsData);
});

/* 
  Future Firebase Integration Snippet:
  
  db.collection("reports").onSnapshot((snapshot) => {
    const firebaseData = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        reportID: doc.id,
        fullName: data.fullName || '',
        issueCategory: data.issueCategory || '',
        barangayArea: data.barangayArea || '',
        issueDescription: data.issueDescription || '',
        timestamp: data.timestamp || '',
        reportStatus: data.reportStatus || 'Received',
        supportingImage: Array.isArray(data.supportingImage) ? data.supportingImage : [] // Pull array of Firebase Storage URLs
      };
    });
    renderReports(firebaseData);
  });
*/