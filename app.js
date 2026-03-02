const API_URL = "https://script.google.com/macros/s/AKfycbzGoI8O1LJTMyeAIDr-tfeqv0vyKUThLRnDuxGRIjEaMBxkn1AoY7BMRICFxGGsa72MLQ/exec"; // !!! นำลิงก์ Web App จาก Google Apps Script มาใส่ที่นี่
const API_KEY = "kpshop_secure_12345";

// ตัวแปร global
let currentUser = null;
let stockMasterList = []; 
let currentScannedItem = null; 
let fullSummaryReport = []; 
let managerFullSummaryReport = []; 
let recentCounts = []; 

// !! ตัวแปรสำหรับระบบกล้อง !!
let allVideoDevices = []; 
let currentDeviceindex = 0; 
let lastUsedDeviceId = null; 

// ฟังก์ชันสำหรับเรียก API (แทน google.script.run)
async function callApi(action, payload) {
  try {
    const rawResponse = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: action,
        apiKey: API_KEY,
        payload: payload
      })
    });
    
    const content = await rawResponse.text();
    let jsonResp;
    try {
      jsonResp = JSON.parse(content);
    } catch(e) {
      throw new Error("เกิดข้อผิดพลาดในการเชื่อมต่อกับเซิร์ฟเวอร์ (API Error)");
    }

    if (jsonResp.status !== 'success') {
      throw new Error(jsonResp.message || 'เกิดข้อผิดพลาดจากเซิร์ฟเวอร์');
    }
    return jsonResp.data;
  } catch (error) {
    console.error("API Error: ", error);
    throw error;
  }
}

// โหลด HTML เริ่มต้นและผูก Event
document.addEventListener("DOMContentLoaded", async () => {
  const pages = [
    { id: 'page-login', file: 'Page-Login.html' },
    { id: 'page-menu', file: 'Page-Menu.html' },
    { id: 'page-stock-count', file: 'Page-StockCount.html' },
    { id: 'page-summary', file: 'Page-Summary.html' },
    { id: 'page-manager-summary', file: 'Page-ManagerSummary.html' }
  ];

  try {
    for (const page of pages) {
      const resp = await fetch(page.file);
      if (!resp.ok) throw new Error("ไม่สามารถโหลดไฟล์ " + page.file);
      document.getElementById(page.id).innerHTML = await resp.text();
    }
    
    // ผูก Event Listener ต่างๆ ใหม่ หลังจากโหลด HTML มาแปะแล้ว
    const loginForm = document.getElementById("login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", function (e) {
        e.preventDefault(); 
        const pin = document.getElementById("pin-input").value;
        document.getElementById("login-spinner").style.display = "block";
        document.getElementById("login-button").disabled = true;
        document.getElementById("login-error").style.display = "none";
        
        callApi("checkLogin", { pin: pin })
          .then(onLoginSuccess)
          .catch(onLoginFailure);
      });
    }
    
    const saveBtn = document.getElementById("save-count-btn");
    if (saveBtn) {
       saveBtn.addEventListener("click", handleSaveCount);
    }

    // ซ่อน loader และโชว์แอป
    const mainLoader = document.getElementById("main-loader");
    if (mainLoader) mainLoader.style.display = "none";
    
    const appContent = document.getElementById("app-content");
    if (appContent) appContent.style.display = "block";

  } catch (err) {
    const mainLoader = document.getElementById("main-loader");
    if (mainLoader) {
      mainLoader.innerHTML = `<h5 class="text-danger">เกิดข้อผิดพลาดในการโหลดไฟล์หน้าจอ: ${err.message}</h5>`;
    }
  }
});

// --- Audio ---
function playBeepSound() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    gainNode.gain.value = 0.1; 
    oscillator.frequency.value = 900; 
    oscillator.type = "square"; 
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1); 
  } catch (e) { console.error("Web Audio API error", e); }
}

// --- Navigation ---
function showPage(pageId) {
  document.querySelectorAll(".page-container").forEach((page) => {
    page.style.display = "none";
  });
  const pageToShow = document.getElementById(pageId);
  if (pageToShow) pageToShow.style.display = "block";
  
  if (pageId === 'page-stock-count' && currentUser) loadStockCountPage();
  if (pageId === 'page-summary' && currentUser) loadSummaryReport();
  if (pageId === 'page-manager-summary' && currentUser) loadManagerPage();
}

// --- Login Functions ---
function onLoginSuccess(userObject) {
  document.getElementById("login-spinner").style.display = "none";
  document.getElementById("login-button").disabled = false;
  if (userObject) {
    currentUser = userObject; 
    document.getElementById("user-name").textContent = currentUser.name;
    document.getElementById("user-role").textContent = currentUser.role;
    document.getElementById("user-branch").textContent = currentUser.branch;
    document.getElementById("manager-menu-button").style.display = (currentUser.role === 'Manager') ? "block" : "none";
    showPage("page-menu");
  } else {
    onLoginFailure();
  }
}

function onLoginFailure() {
  document.getElementById("login-spinner").style.display = "none";
  document.getElementById("login-button").disabled = false;
  document.getElementById("login-error").style.display = "block"; 
}

function logout() {
  currentUser = null; 
  document.getElementById("pin-input").value = ""; 
  document.getElementById("login-error").style.display = "none"; 
  showPage("page-login"); 
}

// --- Stock Count Page ---
function goBackToMenu() {
  stopScanner(); 
  showPage('page-menu');
  resetScanPage();
}

function loadStockCountPage() {
  document.getElementById("stock-list-spinner").style.display = "block";
  document.getElementById("stock-list-container").style.display = "none";
  const searchDiv = document.getElementById("search-master-list");
  if(searchDiv) searchDiv.style.display = "none";
  document.getElementById("branch-name-display").textContent = currentUser.branch;
  
  stockMasterList = [];
  resetScanPage();
  recentCounts = [];
  renderRecentCounts();
  
  callApi("getStockMasterList", { branch: currentUser.branch })
    .then(onStockListLoaded)
    .catch(onStockListFailed);
}

function onStockListLoaded(list) {
  stockMasterList = list; 
  document.getElementById("stock-list-spinner").style.display = "none";
  document.getElementById("stock-list-container").style.display = "block";
  const searchDiv = document.getElementById("search-master-list");
  if(searchDiv) searchDiv.style.display = "block";
  
  const searchInput = document.getElementById("search-input-field");
  if (searchInput) {
    searchInput.addEventListener("keyup", filterStockList);
    searchInput.value = ""; 
  }
  
  renderStockList([]); 
  
  const container = document.getElementById("stock-list-container");
  container.innerHTML = '<li class="list-group-item text-center text-muted py-5 border-0 bg-transparent"><i class="bi bi-search display-1 d-block mb-3 opacity-25"></i>พิมพ์ค้นหา หรือ กดปุ่มสแกนด้านล่าง</li>';
}

function onStockListFailed() {
  document.getElementById("stock-list-spinner").innerHTML = '<p class="text-danger">ไม่สามารถโหลดข้อมูลได้</p>';
}

function renderStockList(list) {
  const container = document.getElementById("stock-list-container");
  container.innerHTML = ""; 
  
  if (list.length === 0) {
    return;
  }
  
  list.forEach(item => {
    const li = document.createElement("li");
    li.className = "list-group-item";
    li.innerHTML = `
      <strong>${item.name}</strong><br>
      <small class="text-muted">
         <i class="bi bi-upc"></i> ${item.barcode} 
         ${item.productCode ? `| <i class="bi bi-tag"></i> ${item.productCode}` : ''}
      </small>
      <span class="badge bg-secondary float-end mt-2">${item.masterQuantity} ชิ้น</span>
    `;
    li.onclick = () => selectItemFromList(item, 'tap');
    container.appendChild(li);
  });
}

function filterStockList() {
  const queryInput = document.getElementById("search-input-field");
  const query = queryInput ? queryInput.value.toLowerCase().trim() : "";
  const container = document.getElementById("stock-list-container");
  
  if (query === "") {
      container.innerHTML = '<li class="list-group-item text-center text-muted py-5 border-0 bg-transparent"><i class="bi bi-search display-1 d-block mb-3 opacity-25"></i>พิมพ์ค้นหา หรือ กดปุ่มสแกนด้านล่าง</li>';
      return;
  }
  
  const filteredList = stockMasterList.filter(item => {
    const itemName = item.name ? item.name.toLowerCase() : "";
    const itemBarcode = item.barcode ? item.barcode.toLowerCase() : "";
    const itemProductCode = item.productCode ? item.productCode.toLowerCase() : "";
    return itemName.includes(query) || itemBarcode.includes(query) || itemProductCode.includes(query);
  });
  
  if (filteredList.length === 0) {
       container.innerHTML = '<li class="list-group-item text-center text-muted py-4 border-0">ไม่พบสินค้าที่ตรงกับคำค้นหา</li>';
  } else {
       renderStockList(filteredList);
  }
}

// --- Scanner Logic ---

function _stopQuaggaOnly() {
  try {
    Quagga.offDetected(onBarcodeDetected); 
    Quagga.stop(); 
  } catch(err) { console.warn(err); }
}

function startScanner(specificDeviceId = null) {
  document.getElementById("scanner-ui-overlay").style.display = "block";
  
  const constraints = {
    width: { min: 640, ideal: 1920 },
    height: { min: 480, ideal: 1080 },
    advanced: [{ focusMode: "continuous" }]
  };

  let targetDeviceId = specificDeviceId;
  if (!targetDeviceId && lastUsedDeviceId) {
      targetDeviceId = lastUsedDeviceId;
  }

  if (targetDeviceId) {
      constraints.deviceId = { exact: targetDeviceId };
  } else {
      constraints.facingMode = "environment";
  }

  Quagga.init({
    inputStream: {
      name: "Live",
      type: "LiveStream",
      target: document.querySelector('#scanner-container'),
      constraints: constraints,
      area: { top: "30%", right: "10%", left: "10%", bottom: "30%" },
    },
    decoder: {
      readers: [ "code_128_reader", "ean_reader", "upc_reader" ],
    },
    locate: true, 
  }, function(err) {
    if (err) {
      showManagerToast('ไม่สามารถเปิดกล้องได้: ' + err.message, "error");
      return;
    }
    
    Quagga.start(); 
    
    if (allVideoDevices.length === 0) {
       navigator.mediaDevices.enumerateDevices().then(devices => {
           const videoInputs = devices.filter(device => device.kind === 'videoinput');
           const backCameras = videoInputs.filter(d => {
               const label = d.label.toLowerCase();
               return label.includes('back') || label.includes('environment');
           });
           
           if (backCameras.length > 0) {
               allVideoDevices = backCameras;
           } else {
               allVideoDevices = videoInputs;
           }

           if (allVideoDevices.length > 1) {
               document.getElementById("switch-camera-btn").style.display = "block";
           }
       });
    }

    setTimeout(() => {
      const track = Quagga.CameraAccess.getActiveTrack();
      if (track && typeof track.applyConstraints === 'function') {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] })
          .catch(e => {});
      }
    }, 500);
  });
  
  Quagga.onDetected(onBarcodeDetected);
}

function switchCamera() {
  if (allVideoDevices.length < 2) return; 
  
  _stopQuaggaOnly();
  
  currentDeviceindex = (currentDeviceindex + 1) % allVideoDevices.length;
  const nextDeviceId = allVideoDevices[currentDeviceindex].deviceId;
  lastUsedDeviceId = nextDeviceId;

  startScanner(nextDeviceId);
}

function stopScanner() {
  _stopQuaggaOnly();
  document.getElementById("scanner-ui-overlay").style.display = "none";
}

function onBarcodeDetected(result) {
  playBeepSound(); 
  stopScanner(); 
  
  const code = result.codeResult.code;
  
  const foundItem = stockMasterList.find(item => 
    (item.barcode && item.barcode === code) || 
    (item.productCode && item.productCode === code)
  );
  
  if (foundItem) {
    renderStockList([foundItem]); 
    selectItemFromList(foundItem, 'scan'); 
  } else {
    currentScannedItem = null;
    const alertBox = document.getElementById("item-not-found-alert");
    alertBox.innerHTML = `
      <i class="bi bi-exclamation-triangle-fill"></i> ไม่พบสินค้านี้ในระบบ<br>
      <div class="mt-2 p-2 bg-white rounded border border-danger text-danger">
        <small>รหัสที่อ่านได้:</small><br>
        <strong class="fs-5">${code}</strong>
      </div>
    `;
    alertBox.style.display = "block";
    document.getElementById("scan-result-card").style.display = "none";
    document.getElementById("quantity-input").disabled = true;
    document.getElementById("save-count-btn").disabled = true;
  }
}

function selectItemFromList(item, source = 'tap') { 
  if (source === 'tap') {
    playBeepSound(); 
  }
  
  currentScannedItem = item; 
  document.getElementById("result-barcode").textContent = item.barcode; 
  document.getElementById("result-name").textContent = item.name;
  document.getElementById("scan-result-card").style.display = "block";
  document.getElementById("item-not-found-alert").style.display = "none";
  
  const qtyInput = document.getElementById("quantity-input");
  qtyInput.disabled = false;
  qtyInput.value = ""; 
  qtyInput.focus(); 
  document.getElementById("save-count-btn").disabled = false;
  document.getElementById("start-scan-btn-container").style.display = "none";
}

function resetScanPage() {
  currentScannedItem = null;
  document.getElementById("scan-result-card").style.display = "none";
  document.getElementById("item-not-found-alert").style.display = "none";
  const qtyInput = document.getElementById("quantity-input");
  qtyInput.value = "";
  qtyInput.disabled = true;
  document.getElementById("save-count-btn").disabled = true;
  document.getElementById("start-scan-btn-container").style.display = "block";
  
  const searchInput = document.getElementById("search-input-field");
  if(searchInput) searchInput.value = "";
  
  const container = document.getElementById("stock-list-container");
  container.innerHTML = '<li class="list-group-item text-center text-muted py-5 border-0 bg-transparent"><i class="bi bi-search display-1 d-block mb-3 opacity-25"></i>พิมพ์ค้นหา หรือ กดปุ่มสแกนด้านล่าง</li>';
}

// --- Save Logic ---
function handleSaveCount() {
  const quantity = parseInt(document.getElementById("quantity-input").value);
  if (!currentScannedItem) { showManagerToast("Error: No item", "error"); return; }
  if (isNaN(quantity) || quantity < 0) { showManagerToast("กรุณากรอกจำนวน", "warning"); return; }
  
  const saveBtn = document.getElementById("save-count-btn");
  saveBtn.disabled = true;
  saveBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> กำลังบันทึก...`;

  const startScanBtn = document.getElementById("start-scan-btn");
  if(startScanBtn) {
    startScanBtn.disabled = true;
    startScanBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> รอสักครู่...';
  }
  
  document.getElementById("save-status-toast").style.display = "none";

  const dataToSave = {
    barcode: currentScannedItem.barcode, 
    name: currentScannedItem.name, 
    quantity: quantity,
    user: currentUser.name,
    branch: currentUser.branch
  };
  
  callApi("logStockCount", { data: dataToSave })
    .then(onSaveSuccess)
    .catch(onSaveFailure);
}

function onSaveSuccess(message) {
  const saveBtn = document.getElementById("save-count-btn");
  saveBtn.disabled = false;
  saveBtn.innerHTML = "บันทึก";

  const startScanBtn = document.getElementById("start-scan-btn");
  if(startScanBtn) {
    startScanBtn.disabled = false;
    startScanBtn.innerHTML = '<i class="bi bi-upc-scan me-2"></i> เริ่มสแกน';
  }
  
  const toast = document.getElementById("save-status-toast");
  toast.textContent = message; 
  toast.className = "save-status-toast success";
  toast.style.display = "block";
  
  const quantity = parseInt(document.getElementById("quantity-input").value);
  recentCounts.unshift({ 
    name: currentScannedItem.name,
    quantity: quantity,
    barcode: currentScannedItem.barcode 
  });
  renderRecentCounts(); 
  resetScanPage(); 
  setTimeout(() => { toast.style.display = "none"; }, 2000);
}

function onSaveFailure(error) {
  const saveBtn = document.getElementById("save-count-btn");
  saveBtn.disabled = false;
  saveBtn.innerHTML = "บันทึก";

  const startScanBtn = document.getElementById("start-scan-btn");
  if(startScanBtn) {
    startScanBtn.disabled = false;
    startScanBtn.innerHTML = '<i class="bi bi-upc-scan me-2"></i> เริ่มสแกน';
  }

  const toast = document.getElementById("save-status-toast");
  toast.textContent = error.message; 
  toast.className = "save-status-toast error";
  toast.style.display = "block";
}

function renderRecentCounts() {
  const wrapper = document.getElementById("recent-count-container-wrapper");
  const container = document.getElementById("recent-count-container");
  
  if (recentCounts.length === 0) {
    wrapper.style.display = "none"; 
    container.innerHTML = "";
  } else {
    wrapper.style.display = "block"; 
    container.innerHTML = ""; 
    
    const displayList = recentCounts.slice(0, 3);
    
    displayList.forEach(item => {
      const div = document.createElement("div");
      div.className = "recent-count-item px-3 py-2 border-bottom"; 
      div.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
          <strong class="text-truncate" style="max-width: 70%;">${item.name}</strong>
          <span class="fw-bold text-primary">${item.quantity} ชิ้น</span>
        </div>
        <small class="text-muted">${item.barcode}</small>
      `;
      container.appendChild(div);
    });
  }
}

function loadSummaryReport() {
  fullSummaryReport = []; 
  const container = document.getElementById("summary-report-list");
  const spinner = document.getElementById("summary-report-spinner");
  container.innerHTML = ""; 
  spinner.style.display = "block";
  document.getElementById("filter-all").checked = true;
  
  callApi("getSummaryReport", { branch: currentUser.branch })
    .then(onSummaryReportLoaded)
    .catch(onSummaryReportFailed);
}

function onSummaryReportLoaded(report) {
  fullSummaryReport = report;
  document.getElementById("summary-report-spinner").style.display = "none";
  renderSummaryReport(fullSummaryReport); 
  updateFilterCounts(); 
}

function onSummaryReportFailed(error) {
  document.getElementById("summary-report-spinner").innerHTML = `<p class="text-danger">${error.message}</p>`;
}

function updateFilterCounts() {
  const counts = { all: 0, short: 0, over: 0, ok: 0 };
  fullSummaryReport.forEach(item => { counts.all++; counts[item.status]++; });
  document.getElementById("filter-all-label").textContent = `ทั้งหมด (${counts.all})`;
  document.getElementById("filter-short-label").textContent = `ขาด (${counts.short})`;
  document.getElementById("filter-over-label").textContent = `เกิน (${counts.over})`;
  document.getElementById("filter-ok-label").textContent = `ตรง (${counts.ok})`;
}

function filterSummaryReport(status) {
  const filteredList = (status === 'all') ? fullSummaryReport : fullSummaryReport.filter(item => item.status === status);
  renderSummaryReport(filteredList);
}

function renderSummaryReport(list) {
  const container = document.getElementById("summary-report-list");
  container.innerHTML = ""; 
  if (list.length === 0) { container.innerHTML = '<p class="text-center text-muted">ไม่พบข้อมูล</p>'; return; }
  list.forEach(item => {
    let badgeClass = 'bg-success'; 
    let discrepancyText = `<strong>${item.discrepancy}</strong>`;
    if (item.status === 'short') badgeClass = 'bg-danger'; 
    else if (item.status === 'over') { badgeClass = 'bg-warning text-dark'; discrepancyText = `<strong>+${item.discrepancy}</strong>`; }
    
    const card = document.createElement("div");
    card.className = `card shadow-sm mb-2 report-item ${item.status}`;
    card.innerHTML = `
      <div class="card-body p-2">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <h6 class="card-title mb-0">${item.name}</h6>
            <small class="text-muted">
              <i class="bi bi-upc"></i> ${item.barcode}
              ${item.productCode ? `<br><i class="bi bi-tag"></i> ${item.productCode}` : ''}
            </small>
          </div>
          <span class="badge ${badgeClass} fs-6 px-2 py-2">${discrepancyText}</span>
        </div>
        <hr class="my-1">
        <div class="row text-center">
          <div class="col"><small class="text-muted d-block">ในระบบ</small><strong>${item.masterQty}</strong></div>
          <div class="col"><small class="text-muted d-block">นับได้</small><strong>${item.countedQty}</strong></div>
        </div>
      </div>`;
    container.appendChild(card);
  });
}

function loadManagerPage() {
  managerFullSummaryReport = [];
  renderManagerSummaryReport([]);
  const selector = document.getElementById("manager-branch-selector");
  const loadBtn = document.getElementById("manager-load-report-btn");
  const emailBtn = document.getElementById("manager-send-email-btn");
  if (emailBtn) emailBtn.disabled = true;
  selector.disabled = true;
  loadBtn.disabled = true;
  selector.innerHTML = '<option selected>กำลังโหลด...</option>';
  
  callApi("getAllBranchNames", {})
    .then(onBranchNamesLoaded)
    .catch(onBranchNamesFailed);
}

function onBranchNamesLoaded(branchNames) {
  const selector = document.getElementById("manager-branch-selector");
  const loadBtn = document.getElementById("manager-load-report-btn");
  selector.innerHTML = '<option value="" selected disabled>-- เลือกสาขา --</option>';
  branchNames.forEach(branch => { const option = document.createElement("option"); option.value = branch; option.textContent = branch; selector.appendChild(option); });
  selector.disabled = false;
  loadBtn.disabled = false;
  const emailBtn = document.getElementById("manager-send-email-btn");
  if (emailBtn) {
    emailBtn.removeEventListener("click", handleSendEmail);
    emailBtn.addEventListener("click", handleSendEmail);
  }
}

function onBranchNamesFailed(error) { showManagerToast("โหลดสาขาไม่สำเร็จ: " + error.message, "error"); }

function handleManagerReportLoad() {
  managerFullSummaryReport = [];
  const branch = document.getElementById("manager-branch-selector").value;
  if (!branch) { showManagerToast("กรุณาเลือกสาขา", "warning"); return; }
  const container = document.getElementById("manager-report-list");
  const spinner = document.getElementById("manager-summary-report-spinner");
  const emailBtn = document.getElementById("manager-send-email-btn");
  if (emailBtn) emailBtn.disabled = true;
  container.innerHTML = "";
  spinner.style.display = "block";
  document.getElementById("manager-filter-all").checked = true;
  
  callApi("getSummaryReport", { branch: branch })
    .then(onManagerSummaryReportLoaded)
    .catch(onManagerSummaryReportFailed);
}

function onManagerSummaryReportLoaded(report) {
  managerFullSummaryReport = report;
  document.getElementById("manager-summary-report-spinner").style.display = "none";
  renderManagerSummaryReport(managerFullSummaryReport);
  updateManagerFilterCounts();
  const emailBtn = document.getElementById("manager-send-email-btn");
  if (emailBtn) emailBtn.disabled = false;
}

function onManagerSummaryReportFailed(error) { document.getElementById("manager-summary-report-spinner").innerHTML = `<p class="text-danger">${error.message}</p>`; }

function updateManagerFilterCounts() {
  const counts = { all: 0, short: 0, over: 0, ok: 0 };
  managerFullSummaryReport.forEach(item => { counts.all++; counts[item.status]++; });
  document.getElementById("manager-filter-all-label").textContent = `ทั้งหมด (${counts.all})`;
  document.getElementById("manager-filter-short-label").textContent = `ขาด (${counts.short})`;
  document.getElementById("manager-filter-over-label").textContent = `เกิน (${counts.over})`;
  document.getElementById("manager-filter-ok-label").textContent = `ตรง (${counts.ok})`;
}

function filterManagerSummaryReport(status) {
  const filteredList = (status === 'all') ? managerFullSummaryReport : managerFullSummaryReport.filter(item => item.status === status);
  renderManagerSummaryReport(filteredList);
}

function renderManagerSummaryReport(list) {
  const container = document.getElementById("manager-report-list");
  container.innerHTML = "";
  if (list.length === 0) { container.innerHTML = '<p class="text-center text-muted">ไม่พบข้อมูล</p>'; return; }
  list.forEach(item => {
    let badgeClass = 'bg-success';
    let discrepancyText = `<strong>${item.discrepancy}</strong>`;
    if (item.status === 'short') badgeClass = 'bg-danger';
    else if (item.status === 'over') { badgeClass = 'bg-warning text-dark'; discrepancyText = `<strong>+${item.discrepancy}</strong>`; }
    
    const card = document.createElement("div");
    card.className = `card shadow-sm mb-2 report-item ${item.status}`;
    card.innerHTML = `
      <div class="card-body p-2">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <h6 class="card-title mb-0">${item.name}</h6>
            <small class="text-muted">
              <i class="bi bi-upc"></i> ${item.barcode}
              ${item.productCode ? `<br><i class="bi bi-tag"></i> ${item.productCode}` : ''}
            </small>
          </div>
          <span class="badge ${badgeClass} fs-6 px-2 py-2">${discrepancyText}</span>
        </div>
        <hr class="my-1">
        <div class="row text-center">
          <div class="col"><small class="text-muted d-block">ในระบบ</small><strong>${item.masterQty}</strong></div>
          <div class="col"><small class="text-muted d-block">นับได้</small><strong>${item.countedQty}</strong></div>
        </div>
      </div>`;
    container.appendChild(card);
  });
}

function handleSendEmail() {
  const branch = document.getElementById("manager-branch-selector").value;
  const discrepancyItems = managerFullSummaryReport.filter(item => item.status === 'short' || item.status === 'over');
  if (discrepancyItems.length === 0) { showManagerToast("ไม่พบรายการส่วนต่าง", "warning"); return; }
  const emailBtn = document.getElementById("manager-send-email-btn");
  emailBtn.disabled = true;
  emailBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> กำลังส่ง...`;
  
  callApi("sendDiscrepancyReport", { branchName: branch, discrepancyItems: discrepancyItems })
    .then(onSendEmailSuccess)
    .catch(onSendEmailFailure);
}

function onSendEmailSuccess(message) {
  const emailBtn = document.getElementById("manager-send-email-btn");
  emailBtn.disabled = false;
  emailBtn.innerHTML = '<i class="bi bi-envelope"></i> ส่งอีเมล';
  showManagerToast(message, "success");
}

function onSendEmailFailure(error) {
  const emailBtn = document.getElementById("manager-send-email-btn");
  emailBtn.disabled = false;
  emailBtn.innerHTML = '<i class="bi bi-envelope"></i> ส่งอีเมล';
  showManagerToast(error.message, "error");
}

function showManagerToast(message, type) {
  const toast = document.getElementById("manager-email-toast");
  toast.textContent = message;
  toast.className = (type === 'success') ? 'alert alert-success p-2' : (type === 'error' ? 'alert alert-danger p-2' : 'alert alert-warning p-2');
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3000);
}
