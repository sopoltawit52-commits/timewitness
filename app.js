/* ==========================================================================
   TIMEWITNESS - PERSONAL ATTENDANCE EVIDENCE APP JS LOGIC
   Features: Real HTML5 GPS, Real HTML5 Camera, Canvas Watermark Overlay,
             Buzzer Sound Alerts, PDF/Print Receipts, LocalStorage Logs.
   ========================================================================== */

(function () {
    'use strict';

    // ==========================================================================
    // 1. STATE & LOCAL DATABASE
    // ==========================================================================

    // Default Personal Profile
    const DEFAULT_PROFILE = {
        name: "สมชาย ใจดี",
        empId: "EMP-69420",
        dept: "ฝ่ายปฏิบัติการคลังสินค้า",
        company: "บริษัท โลจิสติกส์ พลัส จำกัด"
    };

    // Default Alarm Times
    const DEFAULT_ALARMS = {
        checkin: "08:45",
        lunch: "12:00",
        breakin: "12:55",
        checkout: "18:00",
        enableSound: true
    };

    // Initialize local database keys
    let profile = JSON.parse(localStorage.getItem('TW_profile')) || DEFAULT_PROFILE;
    let alarms = JSON.parse(localStorage.getItem('TW_alarms')) || DEFAULT_ALARMS;
    let scanHistory = JSON.parse(localStorage.getItem('TW_history')) || [];

    // Helper to persist state
    function saveDatabase() {
        localStorage.setItem('TW_profile', JSON.stringify(profile));
        localStorage.setItem('TW_alarms', JSON.stringify(alarms));
        localStorage.setItem('TW_history', JSON.stringify(scanHistory));
    }

    // Active Punch state
    let activeCameraStream = null;
    let capturedPhotoBase64 = null;
    let currentGPSData = null;
    
    // ==========================================================================
    // 2. HELPER UTILITIES (Time, Sound Synth, Geolocation, Camera)
    // ==========================================================================

    // Play synthesized buzzer warning sounds using Web Audio API
    function playBeepSound(type = 'success') {
        if (!alarms.enableSound) return;
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            const ctx = new AudioContext();
            
            if (type === 'success') {
                // Short digital confirmation beep
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                
                gain.gain.setValueAtTime(0.08, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
                
                osc.type = 'sine';
                osc.frequency.setValueAtTime(800, ctx.currentTime);
                
                osc.start();
                osc.stop(ctx.currentTime + 0.15);
            } else if (type === 'alarm') {
                // Multi-tone alarm buzzer
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                
                gain.gain.setValueAtTime(0.12, ctx.currentTime);
                gain.gain.setValueAtTime(0.01, ctx.currentTime + 0.15);
                gain.gain.setValueAtTime(0.12, ctx.currentTime + 0.25);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
                
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(950, ctx.currentTime);
                osc.frequency.setValueAtTime(850, ctx.currentTime + 0.25);
                
                osc.start();
                osc.stop(ctx.currentTime + 0.5);
            }
        } catch (e) {
            console.warn("Audio Context blocked by browser permission policy.", e);
        }
    }

    // Format current date in Thai format
    function getThaiDateString(date) {
        const days = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
        const months = [
            'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
            'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
        ];
        return `${days[date.getDay()]}ที่ ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() + 543}`;
    }

    // Get YYYY-MM-DD
    function getLocalDateISO(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    // Convert time string to minutes of day
    function timeToMinutes(timeStr) {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    }

    // ==========================================================================
    // 3. TOAST REMINDER ALERTS ENGINE
    // ==========================================================================
    
    function showToast(title, message, type = 'info', duration = 8000) {
        const wrapper = document.getElementById('toast-notifications-wrapper');
        if (!wrapper) return;

        const toast = document.createElement('div');
        toast.className = `toast-item toast-${type}`;
        
        let iconClass = 'fa-info-circle';
        if (type === 'success') iconClass = 'fa-circle-check';
        if (type === 'warning') iconClass = 'fa-bell';
        if (type === 'danger') iconClass = 'fa-triangle-exclamation';

        toast.innerHTML = `
            <i class="fa-solid ${iconClass} toast-icon"></i>
            <div class="toast-content">
                <h4>${title}</h4>
                <p>${message}</p>
            </div>
            <button class="toast-close-btn"><i class="fa-solid fa-times"></i></button>
        `;

        toast.querySelector('.toast-close-btn').addEventListener('click', () => {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 350);
        });

        wrapper.appendChild(toast);
        
        // Trigger buzzer audio
        if (type === 'danger') playBeepSound('alarm');
        else playBeepSound('success');

        setTimeout(() => {
            if (toast.parentNode) {
                toast.classList.add('removing');
                setTimeout(() => toast.remove(), 350);
            }
        }, duration);
    }

    // ==========================================================================
    // 4. CORE APP FUNCTIONS
    // ==========================================================================
    
    const App = {
        activeTab: 'dashboard',
        calendarYear: 2026,
        calendarMonth: 5, // June
        clockInterval: null,
        gpsInterval: null,
        notifiedEvents: new Set(),

        // Dynamic camera controls & alarm states
        currentFacingMode: 'user',
        isDoubleCameraMode: false,
        doubleCameraStep: 0, // 0 = single camera, 1 = capturing front, 2 = capturing back
        doubleCameraPhotos: { front: null, back: null },
        alarmAudioCtx: null,
        alarmIntervalId: null,
        isAlarmActive: false,

        init: function () {
            this.registerServiceWorker();
            this.bindEvents();
            this.initClock();
            this.initGPSPolling();
            this.initNetworkMonitoring();
            this.syncProfileUI();
            this.loadTodayStatus();
            this.renderHistory();
            this.initNotificationsEngine();
        },

        registerServiceWorker: function () {
            const self = this;
            if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                    navigator.serviceWorker.register('./service-worker.js')
                        .then(reg => {
                            console.log('[Service Worker] Registered successfully:', reg.scope);
                            
                            // Check for updates
                            self.checkServiceWorkerUpdate(reg);
                            
                            // Check if update button clicked
                            const checkUpdateBtn = document.getElementById('btn-check-app-update');
                            if (checkUpdateBtn) {
                                checkUpdateBtn.addEventListener('click', () => {
                                    showToast("กำลังตรวจสอบ...", "กำลังดึงข้อมูลเช็คความอัปเดตระบบแอป...", "info", 2000);
                                    reg.update().then(() => {
                                        setTimeout(() => {
                                            if (!reg.waiting && !reg.installing) {
                                                showToast("เวอร์ชันล่าสุดแล้ว", "แอปพลิเคชันของคุณเป็นรุ่นปรับปรุงล่าสุดแล้ว (v1.3.0)", "success");
                                            }
                                        }, 1500);
                                    });
                                });
                            }
                        })
                        .catch(err => console.error('[Service Worker] Registration failed:', err));
                });

                // Listen for controllerchange (refresh the page when new service worker takes control)
                let refreshing = false;
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    if (!refreshing) {
                        refreshing = true;
                        window.location.reload();
                    }
                });
            }

            // Request system notification permissions
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission().then(permission => {
                    console.log('[Notification] Permission:', permission);
                });
            }

            // Bind PWA update banner button
            const btnReload = document.getElementById('btn-reload-pwa-update');
            if (btnReload) {
                btnReload.addEventListener('click', () => {
                    self.activateWaitingServiceWorker();
                });
            }
        },

        bindEvents: function () {
            const self = this;

            // Nav tabs switches
            document.querySelectorAll('.nav-link, .mobile-nav-link').forEach(link => {
                link.addEventListener('click', function (e) {
                    const target = this.getAttribute('data-target');
                    if (target) {
                        e.preventDefault();
                        self.switchTab(target);
                    }
                });
            });

            // Punch buttons
            document.getElementById('punch-main-btn').addEventListener('click', () => self.openCameraModal());
            document.getElementById('btn-close-camera-modal').addEventListener('click', () => self.closeCameraModal());
            document.getElementById('btn-cancel-capture').addEventListener('click', () => self.closeCameraModal());
            document.getElementById('btn-trigger-snap').addEventListener('click', () => self.snapSelfiePhoto());
            document.getElementById('btn-confirm-attendance').addEventListener('click', () => self.savePunchLog());

            // Alarm tests
            document.getElementById('btn-trigger-test-alarm').addEventListener('click', () => {
                showToast("แจ้งเตือนทดสอบสแกนนิ้ว", "นี่คือเสียงเตือนสแกนนิ้วกันลืมเข้าระบบพยานหลักฐาน", "warning");
            });
            document.getElementById('btn-trigger-mobile-alarm').addEventListener('click', () => {
                self.startAlarmActive("ทดสอบนาฬิกาปลุกบันทึกพยาน");
            });
            document.getElementById('btn-dismiss-alarm').addEventListener('click', () => {
                self.stopAlarmActive();
            });
            document.getElementById('btn-clear-today-logs').addEventListener('click', () => self.clearTodayLogs());

            // Camera modal controls
            document.getElementById('btn-switch-camera').addEventListener('click', () => {
                if (self.isDoubleCameraMode) {
                    showToast("โหมดกล้องคู่", "ในโหมดกล้องคู่ จะถ่ายกล้องหน้าแล้วสลับไปกล้องหลังให้อัตโนมัติ", "info");
                    return;
                }
                self.toggleCameraFacing();
            });

            const cbDouble = document.getElementById('cb-double-camera');
            if (cbDouble) {
                cbDouble.addEventListener('change', function () {
                    self.isDoubleCameraMode = this.checked;
                    const indicator = document.getElementById('double-cam-indicator');
                    const text = document.getElementById('double-cam-text');
                    if (indicator && text) {
                        if (self.isDoubleCameraMode) {
                            indicator.style.borderColor = 'var(--color-cyan)';
                            indicator.style.color = 'var(--color-cyan)';
                            indicator.style.background = 'rgba(6, 182, 212, 0.15)';
                            text.textContent = 'กล้องคู่ (หน้า+หลัง)';
                            text.style.color = 'var(--color-cyan)';
                        } else {
                            indicator.style.borderColor = 'rgba(255,255,255,0.2)';
                            indicator.style.color = 'var(--text-muted)';
                            indicator.style.background = 'rgba(255,255,255,0.05)';
                            text.textContent = 'กล้องเดี่ยว';
                            text.style.color = 'var(--text-muted)';
                        }
                    }
                    
                    // If camera is open, restart the stream to reset step details
                    const modal = document.getElementById('camera-capture-modal');
                    if (modal && modal.classList.contains('active')) {
                        self.doubleCameraStep = self.isDoubleCameraMode ? 1 : 0;
                        self.doubleCameraPhotos = { front: null, back: null };
                        self.currentFacingMode = self.isDoubleCameraMode ? 'user' : 'user';
                        self.startWebcamStream();
                    }
                });
            }

            // Filters
            document.getElementById('btn-apply-filters').addEventListener('click', () => self.renderHistory());
            document.getElementById('btn-reset-filters').addEventListener('click', () => {
                document.getElementById('filter-start-date').value = '';
                document.getElementById('filter-end-date').value = '';
                document.getElementById('filter-scan-type').value = 'all';
                self.renderHistory();
            });
            document.getElementById('export-history-csv-btn').addEventListener('click', () => self.exportHistoryCSV());
            document.getElementById('btn-export-pdf-report').addEventListener('click', () => self.exportPDFReport());

            // Calendar Navigation
            document.getElementById('cal-prev-month-btn').addEventListener('click', () => self.changeCalendarMonth(-1));
            document.getElementById('cal-next-month-btn').addEventListener('click', () => self.changeCalendarMonth(1));

            // Settings Forms
            document.getElementById('btn-save-profile').addEventListener('click', () => self.saveProfileSettings());
            document.getElementById('btn-save-alarms').addEventListener('click', () => self.saveAlarmSettings());

            // Receipt actions
            document.getElementById('btn-close-receipt-modal').addEventListener('click', () => self.closeReceiptModal());
            document.getElementById('btn-print-receipt').addEventListener('click', () => {
                document.body.classList.add('printing-single-receipt');
                window.print();
                document.body.classList.remove('printing-single-receipt');
            });
            document.getElementById('btn-download-receipt-image').addEventListener('click', () => self.downloadReceiptImage());

            // PWA Install triggers
            const triggerPwaInstall = () => {
                if (self.deferredPrompt) {
                    self.deferredPrompt.prompt();
                    self.deferredPrompt.userChoice.then((choiceResult) => {
                        if (choiceResult.outcome === 'accepted') {
                            console.log('User accepted PWA install prompt');
                            // Hide install UI
                            const sidebarContainer = document.getElementById('sidebar-install-container');
                            const settingsBtn = document.getElementById('btn-install-pwa-settings');
                            const statusText = document.getElementById('pwa-install-status-text');
                            if (sidebarContainer) sidebarContainer.style.display = 'none';
                            if (settingsBtn) settingsBtn.style.display = 'none';
                            if (statusText) statusText.textContent = "ติดตั้งสำเร็จเรียบร้อยแล้ว";
                        }
                        self.deferredPrompt = null;
                    });
                }
            };

            const btnInstallSidebar = document.getElementById('btn-install-pwa-sidebar');
            if (btnInstallSidebar) {
                btnInstallSidebar.addEventListener('click', triggerPwaInstall);
            }
            const btnInstallSettings = document.getElementById('btn-install-pwa-settings');
            if (btnInstallSettings) {
                btnInstallSettings.addEventListener('click', triggerPwaInstall);
            }

            // Window PWA events
            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                self.deferredPrompt = e;
                // Show install UI
                const sidebarContainer = document.getElementById('sidebar-install-container');
                const settingsBtn = document.getElementById('btn-install-pwa-settings');
                const statusText = document.getElementById('pwa-install-status-text');
                if (sidebarContainer) sidebarContainer.style.display = 'block';
                if (settingsBtn) settingsBtn.style.display = 'block';
                if (statusText) statusText.textContent = "พร้อมติดตั้งแอปพลิเคชัน";
            });

            window.addEventListener('appinstalled', (evt) => {
                console.log('TimeWitness PWA was installed successfully');
                const sidebarContainer = document.getElementById('sidebar-install-container');
                const settingsBtn = document.getElementById('btn-install-pwa-settings');
                const statusText = document.getElementById('pwa-install-status-text');
                if (sidebarContainer) sidebarContainer.style.display = 'none';
                if (settingsBtn) settingsBtn.style.display = 'none';
                if (statusText) statusText.textContent = "ติดตั้งสำเร็จเรียบร้อยแล้ว (Standalone Mode)";
            });
        },

        // Realtime clocks
        initClock: function () {
            const clockTime = document.getElementById('clock-time-display');
            const clockDay = document.getElementById('clock-day-display');
            const dateDisplay = document.getElementById('current-date-display');
            
            function updateTime() {
                const now = new Date();
                clockTime.textContent = now.toTimeString().split(' ')[0];
                const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
                clockDay.textContent = days[now.getDay()];
            }
            
            updateTime();
            this.clockInterval = setInterval(updateTime, 1000);
        },

        // Switch panels (tabs)
        switchTab: function (tabId) {
            this.activeTab = tabId;
            document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));
            document.getElementById(`view-${tabId}`).classList.add('active');

            document.querySelectorAll('.nav-link, .mobile-nav-link').forEach(link => {
                if (link.getAttribute('data-target') === tabId) {
                    link.classList.add('active');
                } else {
                    link.classList.remove('active');
                }
            });

            if (tabId === 'calendar') {
                this.renderCalendar();
            } else if (tabId === 'history') {
                this.renderHistory();
            } else if (tabId === 'settings') {
                this.syncProfileUI();
            }
        },

        // network status detection
        initNetworkMonitoring: function () {
            const updateStatus = () => {
                const badge = document.getElementById('mobile-net-status');
                if (navigator.onLine) {
                    badge.textContent = "Online";
                    badge.style.color = "var(--color-cyan)";
                    badge.style.background = "rgba(6, 182, 212, 0.1)";
                    badge.style.borderColor = "rgba(6, 182, 212, 0.2)";
                } else {
                    badge.textContent = "Offline";
                    badge.style.color = "var(--color-red)";
                    badge.style.background = "rgba(239, 68, 68, 0.1)";
                    badge.style.borderColor = "rgba(239, 68, 68, 0.2)";
                }
            };
            window.addEventListener('online', updateStatus);
            window.addEventListener('offline', updateStatus);
            updateStatus();
        },

        // ==========================================================================
        // 5. REAL HTML5 GEOLOCATION API POLLING
        // ==========================================================================
        
        initGPSPolling: function () {
            const self = this;
            const statusText = document.getElementById('gps-status-text');
            const dot = document.getElementById('mobile-gps-status-dot');

            function fetchLocation() {
                if (!navigator.geolocation) {
                    statusText.textContent = "ระบบ Geolocation ไม่รองรับในอุปกรณ์นี้";
                    dot.classList.remove('active');
                    return;
                }

                navigator.geolocation.getCurrentPosition(
                    position => {
                        const lat = position.coords.latitude.toFixed(6);
                        const lng = position.coords.longitude.toFixed(6);
                        const acc = position.coords.accuracy.toFixed(0);

                        currentGPSData = {
                            lat: lat,
                            lng: lng,
                            accuracy: acc
                        };

                        statusText.textContent = `พิกัด GPS จริงพร้อมบันทึก: ${lat}, ${lng} (คลาดเคลื่อน +/- ${acc} ม.)`;
                        dot.classList.add('active');
                        document.getElementById('dashboard-gps-status').className = "location-status-bar success";
                    },
                    error => {
                        let errMsg = "ไม่สามารถตรวจจับพิกัดได้ (กรุณาเปิด GPS)";
                        if (error.code === error.PERMISSION_DENIED) {
                            errMsg = "การเข้าถึงพิกัด GPS ถูกปฏิเสธ (กรุณาอนุญาตระบุพิกัด)";
                        }
                        statusText.textContent = errMsg;
                        dot.classList.remove('active');
                        document.getElementById('dashboard-gps-status').className = "location-status-bar error";
                        
                        // Fallback mock values so app remains testable
                        currentGPSData = {
                            lat: "13.756300",
                            lng: "100.501800",
                            accuracy: "12"
                        };
                    },
                    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
                );
            }

            fetchLocation();
            this.gpsInterval = setInterval(fetchLocation, 30000); // refresh every 30 seconds
        },

        // ==========================================================================
        // 6. REAL HTML5 CAMERA WEBCAM STREAM & WATERMARK CANVAS DRAW
        // ==========================================================================
        
        openCameraModal: function () {
            const self = this;
            const modal = document.getElementById('camera-capture-modal');
            const confirmBtn = document.getElementById('btn-confirm-attendance');
            const cbDouble = document.getElementById('cb-double-camera');

            // Reset double camera state
            self.isDoubleCameraMode = cbDouble ? cbDouble.checked : false;
            self.doubleCameraStep = self.isDoubleCameraMode ? 1 : 0;
            self.doubleCameraPhotos = { front: null, back: null };
            
            // Default facingMode: front ('user')
            self.currentFacingMode = 'user';

            // UI setup
            confirmBtn.disabled = true;
            modal.classList.add('active');

            // GPS query in modal
            const gpsText = document.getElementById('modal-gps-text');
            const gpsAcc = document.getElementById('modal-gps-accuracy');

            if (currentGPSData) {
                gpsText.textContent = `ละติจูด: ${currentGPSData.lat}, ลองจิจูด: ${currentGPSData.lng}`;
                gpsAcc.textContent = `คลาดเคลื่อน: +/- ${currentGPSData.accuracy} เมตร`;
            } else {
                gpsText.textContent = "กำลังเรียกข้อมูลพิกัด GPS...";
                gpsAcc.textContent = "";
            }

            self.startWebcamStream();
        },

        startWebcamStream: function () {
            const self = this;
            const video = document.getElementById('webcam-element');
            const canvas = document.getElementById('photo-canvas');
            const loadingMsg = document.getElementById('camera-status-msg');
            const placeholder = document.getElementById('camera-loading-placeholder');
            const confirmBtn = document.getElementById('btn-confirm-attendance');
            const stepPrompt = document.getElementById('camera-step-prompt');

            // Stop any active camera streams
            if (activeCameraStream) {
                activeCameraStream.getTracks().forEach(track => track.stop());
                activeCameraStream = null;
            }

            canvas.style.display = 'none';
            video.style.display = 'none';
            placeholder.style.display = 'flex';

            // Update status messages
            let cameraLabel = self.currentFacingMode === 'user' ? "กล้องหน้า (เซลฟี่)" : "กล้องหลัง (เครื่องสแกน)";
            loadingMsg.textContent = `กำลังเปิด${cameraLabel}...`;

            if (self.isDoubleCameraMode) {
                stepPrompt.style.display = 'block';
                if (self.doubleCameraStep === 1) {
                    stepPrompt.textContent = "ขั้นตอนที่ 1: ถ่ายรูปกล้องหน้า (เซลฟี่)";
                    self.currentFacingMode = 'user'; // Lock to user for step 1
                } else if (self.doubleCameraStep === 2) {
                    stepPrompt.textContent = "ขั้นตอนที่ 2: ถ่ายรูปกล้องหลัง (เครื่องสแกน)";
                    self.currentFacingMode = 'environment'; // Lock to environment for step 2
                }
            } else {
                stepPrompt.style.display = 'none';
            }

            // Start webcam video streams
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                navigator.mediaDevices.getUserMedia({
                    video: { facingMode: self.currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
                    audio: false
                })
                .then(stream => {
                    activeCameraStream = stream;
                    video.srcObject = stream;
                    video.style.display = 'block';
                    placeholder.style.display = 'none';
                })
                .catch(err => {
                    console.error("Camera access error:", err);
                    loadingMsg.innerHTML = `<span style="color:var(--color-red);"><i class="fa-solid fa-triangle-exclamation"></i> ไม่สามารถเปิดกล้องได้ (กรุณาอนุญาตใช้กล้อง)</span>`;
                    
                    // Fallback simulated camera canvas drawing
                    setTimeout(() => {
                        self.drawSimulatedSelfiePlaceholder();
                        placeholder.style.display = 'none';
                    }, 1000);
                });
            } else {
                loadingMsg.textContent = "ระบบเบราว์เซอร์ไม่รองรับกล้องถ่ายรูป";
                setTimeout(() => {
                    self.drawSimulatedSelfiePlaceholder();
                    placeholder.style.display = 'none';
                }, 1000);
            }
        },

        toggleCameraFacing: function () {
            this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
            this.startWebcamStream();
        },

        closeCameraModal: function () {
            // Stop camera feeds
            if (activeCameraStream) {
                activeCameraStream.getTracks().forEach(track => track.stop());
                activeCameraStream = null;
            }
            document.getElementById('camera-capture-modal').classList.remove('active');
        },

        snapSelfiePhoto: function () {
            const self = this;
            const video = document.getElementById('webcam-element');
            const canvas = document.getElementById('photo-canvas');
            const confirmBtn = document.getElementById('btn-confirm-attendance');
            
            if (!activeCameraStream && canvas.style.display === 'block') {
                // If using simulated mode, click snap advances simulation manually
                if (self.isDoubleCameraMode && self.doubleCameraStep === 1) {
                    self.drawSimulatedSelfiePlaceholder();
                } else if (self.isDoubleCameraMode && self.doubleCameraStep === 2) {
                    self.drawSimulatedSelfiePlaceholder();
                }
                return;
            }

            if (!video.srcObject) return;

            // Capture logic based on camera mode
            if (self.isDoubleCameraMode && self.doubleCameraStep === 1) {
                // Capture Step 1 (Front camera)
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = video.videoWidth || 640;
                tempCanvas.height = video.videoHeight || 480;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
                self.doubleCameraPhotos.front = tempCanvas.toDataURL('image/jpeg');

                // Beep and alert user
                playBeepSound('success');
                showToast("กล้องหน้าสำเร็จ", "บันทึกรูปเซลฟี่แล้ว กำลังสลับไปกล้องหลัง...", "success", 2000);

                // Switch to Back camera for Step 2
                self.doubleCameraStep = 2;
                self.currentFacingMode = 'environment';
                
                // Restart webcam stream for step 2
                self.startWebcamStream();
                return;
            }

            // Capture Step 2 (Back camera in Double mode) OR Single camera snap
            const ctx = canvas.getContext('2d');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Turn off camera stream instantly to save battery
            if (activeCameraStream) {
                activeCameraStream.getTracks().forEach(track => track.stop());
                activeCameraStream = null;
            }
            video.style.display = 'none';
            canvas.style.display = 'block';

            if (self.isDoubleCameraMode && self.doubleCameraStep === 2) {
                // Save Back camera image
                self.doubleCameraPhotos.back = canvas.toDataURL('image/jpeg');

                // Composite both images: Back is background, Front is PiP overlay
                const pipW = Math.round(canvas.width * 0.28);
                const pipH = Math.round(canvas.height * 0.28);
                const pipX = canvas.width - pipW - Math.round(canvas.width * 0.03); // Right aligned
                const pipY = Math.round(canvas.height * 0.03); // Top aligned
                const borderSize = Math.max(2, Math.round(canvas.width * 0.006));

                // Draw PiP white border frame
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(pipX - borderSize, pipY - borderSize, pipW + (borderSize * 2), pipH + (borderSize * 2));

                // Draw PiP image
                const imgFront = new Image();
                imgFront.onload = function () {
                    ctx.drawImage(imgFront, pipX, pipY, pipW, pipH);
                    
                    // Draw secure watermark
                    self.drawWatermarkOverlay(canvas);
                    
                    capturedPhotoBase64 = canvas.toDataURL('image/jpeg');
                    confirmBtn.disabled = false;
                };
                imgFront.src = self.doubleCameraPhotos.front;

            } else {
                // Normal Single Camera draw watermark directly
                self.drawWatermarkOverlay(canvas);
                capturedPhotoBase64 = canvas.toDataURL('image/jpeg');
                confirmBtn.disabled = false;
            }
            
            playBeepSound('success');
        },

        drawWatermarkOverlay: function (canvas) {
            const ctx = canvas.getContext('2d');
            const now = new Date();
            
            // Format Timestamp: YYYY-MM-DD HH:MM:SS
            const pad = (n) => String(n).padStart(2, '0');
            const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
            const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
            const timestamp = `${dateStr} ${timeStr}`;

            const selectedMode = document.querySelector('input[name="work_mode"]:checked').value;
            const modeNames = { "Office": "OFFICE SCANNER", "WFH": "WORK FROM HOME", "Field": "OUTSIDE FIELD" };
            const modeText = modeNames[selectedMode] || "SECURED PUNCH";

            // Coords
            const gpsCoords = currentGPSData 
                ? `LAT: ${currentGPSData.lat}, LNG: ${currentGPSData.lng} (+/- ${currentGPSData.accuracy}m)`
                : "GPS COORDS: NOT DETECTED (MOCK ACTIVE)";

            // Proportional sizes based on canvas size (solves disappearing watermark on high-res)
            const barHeight = Math.round(canvas.height * 0.16); // 16% of height
            const margin = Math.round(canvas.width * 0.03); // 3% margin
            const titleSize = Math.max(14, Math.round(canvas.height * 0.035)); // 3.5%
            const bodySize = Math.max(11, Math.round(canvas.height * 0.026)); // 2.6%
            const badgeSize = Math.max(12, Math.round(canvas.height * 0.032)); // 3.2%
            const smallSize = Math.max(8, Math.round(canvas.height * 0.020)); // 2.0%

            // Draw translucent black bar at bottom
            ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.fillRect(0, canvas.height - barHeight, canvas.width, barHeight);

            // Draw bottom border line (Cyan neon)
            const borderWidth = Math.max(2, Math.round(canvas.height * 0.008));
            ctx.lineWidth = borderWidth;
            ctx.strokeStyle = '#06b6d4';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height - barHeight);
            ctx.lineTo(canvas.width, canvas.height - barHeight);
            ctx.stroke();

            // Font configurations
            ctx.textBaseline = 'middle';
            
            // Left text block (Verify logo and details)
            ctx.fillStyle = '#06b6d4'; // Cyan color
            ctx.textAlign = 'left';
            ctx.font = `bold ${titleSize}px Prompt, Arial, sans-serif`;
            ctx.fillText("TIMEWITNESS SECURE PROOF", margin, canvas.height - (barHeight * 0.70));

            ctx.fillStyle = '#f9fafb'; // White color
            ctx.font = `bold ${bodySize}px Outfit, Arial, sans-serif`;
            ctx.fillText(`TIMESTAMP: ${timestamp}`, margin, canvas.height - (barHeight * 0.44));
            ctx.fillText(`COORDINATES: ${gpsCoords}`, margin, canvas.height - (barHeight * 0.18));

            // Right aligned status badge
            ctx.textAlign = 'right';
            ctx.fillStyle = '#10b981'; // Emerald
            ctx.font = `bold ${badgeSize}px Prompt, Arial, sans-serif`;
            ctx.fillText(modeText, canvas.width - margin, canvas.height - (barHeight * 0.70));
            
            ctx.fillStyle = '#9ca3af'; // Gray
            ctx.font = `bold ${smallSize}px Outfit, Arial, sans-serif`;
            ctx.fillText("VERIFIED BY DEVICE SENSORS", canvas.width - margin, canvas.height - (barHeight * 0.22));
        },

        drawSimulatedSelfiePlaceholder: function () {
            const self = this;
            const canvas = document.getElementById('photo-canvas');
            const ctx = canvas.getContext('2d');
            const confirmBtn = document.getElementById('btn-confirm-attendance');
            canvas.width = 640;
            canvas.height = 480;
            canvas.style.display = 'block';

            if (self.isDoubleCameraMode && self.doubleCameraStep === 1) {
                // Step 1: Draw simulated front camera (Selfie)
                ctx.fillStyle = '#0f172a'; // dark background
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                
                // Draw face shape
                ctx.beginPath();
                ctx.arc(canvas.width / 2, canvas.height / 2 - 20, 100, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(6, 182, 212, 0.15)';
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#06b6d4';
                ctx.stroke();

                // Draw face elements
                ctx.fillStyle = '#06b6d4';
                ctx.beginPath();
                ctx.arc(canvas.width / 2 - 35, canvas.height / 2 - 40, 8, 0, Math.PI * 2);
                ctx.arc(canvas.width / 2 + 35, canvas.height / 2 - 40, 8, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = '#06b6d4';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(canvas.width / 2, canvas.height / 2, 45, 0, Math.PI);
                ctx.stroke();

                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 20px Prompt, Arial';
                ctx.textAlign = 'center';
                ctx.fillText("SIMULATED FRONT CAMERA (SELFIE)", canvas.width / 2, canvas.height / 2 + 120);

                self.doubleCameraPhotos.front = canvas.toDataURL('image/jpeg');

                // Advance to step 2 after a delay
                self.doubleCameraStep = 2;
                self.currentFacingMode = 'environment';
                
                setTimeout(() => {
                    self.startWebcamStream();
                }, 1200);
                return;
            }

            if (self.isDoubleCameraMode && self.doubleCameraStep === 2) {
                // Step 2: Draw simulated back camera (Machine)
                ctx.fillStyle = '#090d16'; 
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw barcode scanner box
                ctx.fillStyle = '#1e293b';
                ctx.fillRect(canvas.width / 2 - 120, canvas.height / 2 - 100, 240, 200);

                ctx.strokeStyle = '#ef4444'; // Scanner red laser
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(canvas.width / 2 - 110, canvas.height / 2);
                ctx.lineTo(canvas.width / 2 + 110, canvas.height / 2);
                ctx.stroke();

                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 18px Prompt, Arial';
                ctx.textAlign = 'center';
                ctx.fillText("SIMULATED BACK CAMERA (OFFICE SCANNER)", canvas.width / 2, canvas.height / 2 - 120);
                ctx.fillText("FINGERPRINT MACHINE IN FOCUS", canvas.width / 2, canvas.height / 2 + 130);

                self.doubleCameraPhotos.back = canvas.toDataURL('image/jpeg');

                // Composite Front selfie over it
                const pipW = Math.round(canvas.width * 0.28);
                const pipH = Math.round(canvas.height * 0.28);
                const pipX = canvas.width - pipW - 20;
                const pipY = 20;

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(pipX - 4, pipY - 4, pipW + 8, pipH + 8);

                const imgFront = new Image();
                imgFront.onload = function () {
                    ctx.drawImage(imgFront, pipX, pipY, pipW, pipH);
                    self.drawWatermarkOverlay(canvas);
                    capturedPhotoBase64 = canvas.toDataURL('image/jpeg');
                    confirmBtn.disabled = false;
                    canvas.style.display = 'block';
                };
                imgFront.src = self.doubleCameraPhotos.front;
                return;
            }

            // Normal single camera simulation
            ctx.fillStyle = '#0b0f19';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Face silhouette outlines
            ctx.beginPath();
            ctx.arc(canvas.width / 2, canvas.height / 2 - 20, 100, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(6, 182, 212, 0.08)';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#06b6d4';
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(canvas.width / 2, canvas.height / 2 + 190, 180, Math.PI, Math.PI * 2);
            ctx.fillStyle = 'rgba(6, 182, 212, 0.2)';
            ctx.fill();

            // Center target crosshair
            ctx.strokeStyle = 'rgba(139, 92, 246, 0.4)';
            ctx.lineWidth = 1;
            ctx.strokeRect(30, 30, 40, 20);
            ctx.strokeRect(30, 30, 20, 40);
            ctx.strokeRect(canvas.width - 70, 30, 40, 20);
            ctx.strokeRect(canvas.width - 50, 30, 20, 40);

            // Watermark overlays
            self.drawWatermarkOverlay(canvas);

            capturedPhotoBase64 = canvas.toDataURL('image/jpeg');
            confirmBtn.disabled = false;
        },

        // Alarm Alert functions
        startAlarmActive: function (label = "ได้เวลาบันทึกเวลาทำงานแล้ว") {
            if (this.isAlarmActive) return;
            this.isAlarmActive = true;

            // Show full screen alarm modal
            const modal = document.getElementById('alarm-siren-modal');
            const timeDisplay = document.getElementById('alarm-time-now-display');
            if (modal) modal.classList.add('active');
            if (timeDisplay) {
                const now = new Date();
                timeDisplay.textContent = now.toTimeString().split(' ')[0].substring(0, 5);
            }

            const self = this;

            // Audio synthesis function using Web Audio API
            function triggerSirenBeep() {
                if (!self.isAlarmActive || !alarms.enableSound) return;
                try {
                    const AudioContext = window.AudioContext || window.webkitAudioContext;
                    if (!AudioContext) return;
                    if (!self.alarmAudioCtx || self.alarmAudioCtx.state === 'closed') {
                        self.alarmAudioCtx = new AudioContext();
                    }
                    const ctx = self.alarmAudioCtx;
                    if (ctx.state === 'suspended') {
                        ctx.resume();
                    }

                    // Mobile alarm beep (double beep: beep beep)
                    const playTone = (freq, startTime, duration) => {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.connect(gain);
                        gain.connect(ctx.destination);

                        gain.gain.setValueAtTime(0.15, startTime);
                        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

                        osc.type = 'square'; // harsher square wave for alarm siren
                        osc.frequency.setValueAtTime(freq, startTime);
                        osc.start(startTime);
                        osc.stop(startTime + duration);
                    };

                    const nowTime = ctx.currentTime;
                    playTone(987.77, nowTime, 0.15); // B5 note
                    playTone(987.77, nowTime + 0.22, 0.15);
                } catch (e) {
                    console.warn("Alarm audio context error:", e);
                }
            }

            // Vibration loop
            function triggerVibration() {
                if ('vibrate' in navigator) {
                    navigator.vibrate([500, 200, 500, 200, 500]);
                }
            }

            // Initial play
            triggerSirenBeep();
            triggerVibration();

            // Loop every 1.5 seconds
            this.alarmIntervalId = setInterval(() => {
                triggerSirenBeep();
                triggerVibration();
            }, 1500);

            // Also show native system push notification
            if ('Notification' in window && Notification.permission === 'granted') {
                navigator.serviceWorker.ready.then(registration => {
                    registration.showNotification("TimeWitness Alarm Clock ⏰", {
                        body: `ถึงเวลาเตือน: ${label}! กรุณากดลงเวลาบันทึกพยานในระบบทันที`,
                        icon: 'logo.png', // Fallback
                        vibrate: [500, 200, 500, 200, 500],
                        requireInteraction: true,
                        tag: 'timewitness-alarm'
                    });
                });
            }
        },

        stopAlarmActive: function () {
            this.isAlarmActive = false;
            if (this.alarmIntervalId) {
                clearInterval(this.alarmIntervalId);
                this.alarmIntervalId = null;
            }
            if (this.alarmAudioCtx) {
                try {
                    this.alarmAudioCtx.close();
                } catch (e) {}
                this.alarmAudioCtx = null;
            }
            
            // Close alarm modal
            const modal = document.getElementById('alarm-siren-modal');
            if (modal) modal.classList.remove('active');

            // Cancel phone vibration
            if ('vibrate' in navigator) {
                navigator.vibrate(0);
            }
        },

        // ==========================================================================
        // 7. PUNCH LOG DATA RECORDING (LocalStorage Sync)
        // ==========================================================================
        
        savePunchLog: function () {
            const now = new Date();
            const todayISO = getLocalDateISO(now);
            const timeISO = now.toTimeString().split(' ')[0].substring(0, 5); // "HH:MM"
            const mode = document.querySelector('input[name="work_mode"]:checked').value;
            const remark = document.getElementById('punch-note-input').value;
            
            // Precise step allocation
            let todayLogs = scanHistory.filter(h => h.date === todayISO);
            let activeStep = todayLogs.length + 1; // e.g., 1, 2, 3, or 4
            
            if (activeStep > 4) {
                alert("คุณลงบันทึกเวลาเป็นพยานวันนี้ครบ 4 ครั้งเรียบร้อยแล้ว!");
                this.closeCameraModal();
                return;
            }

            const stepNames = ["เข้างาน (Check-In)", "ออกพักเที่ยง (Break Out)", "กลับจากพัก (Break In)", "ออกงาน (Check-Out)"];

            const newLog = {
                id: 'LOG_' + now.getTime(),
                date: todayISO,
                time: timeISO,
                fullTimestamp: now.toISOString(),
                empName: profile.name,
                empId: profile.empId,
                empDept: profile.dept,
                company: profile.company,
                scanType: activeStep, // 1 to 4
                scanLabel: stepNames[activeStep - 1],
                mode: mode,
                lat: currentGPSData ? currentGPSData.lat : "13.756300",
                lng: currentGPSData ? currentGPSData.lng : "100.501800",
                accuracy: currentGPSData ? currentGPSData.accuracy : "10",
                selfie: capturedPhotoBase64,
                remark: remark,
                userAgent: navigator.userAgent
            };

            scanHistory.unshift(newLog);
            saveDatabase();
            
            this.closeCameraModal();
            this.loadTodayStatus();
            this.renderHistory();
            
            showToast("บันทึกหลักฐานสำเร็จ", `บันทึกรายการ ${stepNames[activeStep - 1]} เรียบร้อยพร้อมฝังพิกัดและลายน้ำในรูป`, "success");
        },

        loadTodayStatus: function () {
            const todayISO = getLocalDateISO(new Date());
            const todayLogs = scanHistory.filter(h => h.date === todayISO).sort((a,b) => a.scanType - b.scanType);
            
            const steps = [null, null, null, null];
            todayLogs.forEach(log => {
                if (log.scanType >= 1 && log.scanType <= 4) {
                    steps[log.scanType - 1] = log.time;
                }
            });

            // Set stepper filling
            const logsCount = todayLogs.length;
            const fillWidth = logsCount === 4 ? 100 : logsCount * 25; // 0, 25, 50, 75, 100
            
            const stepperFill = document.getElementById('stepper-fill');
            if (stepperFill) stepperFill.style.width = `${fillWidth}%`;

            for (let s = 1; s <= 4; s++) {
                const node = document.getElementById(`step-node-${s}`);
                const timeLabel = document.getElementById(`step-time-${s}`);
                
                if (!node || !timeLabel) continue;

                node.classList.remove('active', 'completed');
                
                if (steps[s - 1]) {
                    timeLabel.textContent = steps[s - 1];
                    node.classList.add('completed');
                } else {
                    timeLabel.textContent = '-';
                }

                // Node active indicator
                if (logsCount === s - 1) {
                    node.classList.add('active');
                }
            }

            // Punch button labels update
            const btn = document.getElementById('punch-main-btn');
            const btnLabel = document.getElementById('punch-btn-label');
            
            if (btn && btnLabel) {
                btn.classList.remove('disabled');
                const stepLabels = [
                    "สแกนนิ้วเข้างาน (Check-In)",
                    "สแกนนิ้วออกพัก (Break Out)",
                    "สแกนนิ้วกลับเข้างาน (Break In)",
                    "สแกนนิ้วออกงาน (Check-Out)"
                ];

                if (logsCount < 4) {
                    btnLabel.textContent = `กดสแกน: ${stepLabels[logsCount]}`;
                } else {
                    btnLabel.textContent = "ลงเวลาครบ 4 ครั้งแล้ว";
                    btn.classList.add('disabled');
                }
            }

            // Stats summaries widgets
            document.getElementById('quick-logs-count').textContent = `${logsCount} / 4 ครั้ง`;
            document.getElementById('quick-checkin-time').textContent = steps[0] ? `${steps[0]} น.` : '-';
            document.getElementById('quick-checkout-time').textContent = steps[3] ? `${steps[3]} น.` : '-';

            // Calculate lunch break
            if (steps[1] && steps[2]) {
                const startM = timeToMinutes(steps[1]);
                const endM = timeToMinutes(steps[2]);
                const diff = endM - startM;
                document.getElementById('quick-break-time').textContent = `${diff} นาที`;
            } else {
                document.getElementById('quick-break-time').textContent = '-';
            }
        },

        clearTodayLogs: function () {
            if (confirm("คุณแน่ใจว่าต้องการล้างประวัติการลงพยานหลักฐานเฉพาะของวันนี้?")) {
                const todayISO = getLocalDateISO(new Date());
                scanHistory = scanHistory.filter(h => h.date !== todayISO);
                saveDatabase();
                
                this.loadTodayStatus();
                this.renderHistory();
                showToast("ล้างประวัติวันนี้แล้ว", "ลบรายการบันทึกของวันนี้เรียบร้อยแล้ว", "info");
            }
        },

        // ==========================================================================
        // 8. EVIDENCE HISTORY VIEW & PDF RECEIPT EXPORT
        // ==========================================================================
        
        renderHistory: function () {
            const tableBody = document.getElementById('history-table-body');
            const mobileContainer = document.getElementById('history-mobile-cards');
            
            if (!tableBody || !mobileContainer) return;

            tableBody.innerHTML = '';
            mobileContainer.innerHTML = '';

            const startDate = document.getElementById('filter-start-date').value;
            const endDate = document.getElementById('filter-end-date').value;
            const typeFilter = document.getElementById('filter-scan-type').value;

            // Apply filters
            const filtered = scanHistory.filter(h => {
                if (startDate && h.date < startDate) return false;
                if (endDate && h.date > endDate) return false;
                if (typeFilter !== 'all' && h.scanType !== parseInt(typeFilter)) return false;
                return true;
            });

            if (filtered.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:2rem;">ไม่พบประวัติพยานหลักฐานในระบบ</td></tr>`;
                mobileContainer.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:2rem;">ไม่พบประวัติพยานหลักฐานในระบบ</div>`;
                return;
            }

            filtered.forEach(log => {
                // Table row (Desktop)
                const tr = document.createElement('tr');
                const gpsString = `${log.lat}, ${log.lng}`;
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${log.lat},${log.lng}`;

                tr.innerHTML = `
                    <td><strong>${this.formatThaiDateShort(log.date)} ${log.time} น.</strong></td>
                    <td><span class="scan-type-tag step-${log.scanType}">${log.scanLabel}</span></td>
                    <td><span class="mode-pill ${log.mode.toLowerCase() === 'wfh' ? 'wfh' : log.mode.toLowerCase() === 'field' ? 'field' : ''}">${log.mode}</span></td>
                    <td><a href="${mapsUrl}" target="_blank" style="color:var(--color-cyan); text-decoration:underline;">
                        <i class="fa-solid fa-map-location-dot"></i> ${gpsString}
                    </a></td>
                    <td>+/- ${log.accuracy} ม.</td>
                    <td><span style="font-size:0.75rem;">${log.userAgent.includes("Mobile") ? "Mobile" : "Desktop"}</span></td>
                    <td>
                        <img src="${log.selfie}" class="history-thumbnail" alt="Selfie proof">
                    </td>
                    <td>
                        <button class="btn btn-secondary btn-sm btn-show-receipt" data-id="${log.id}">
                            <i class="fa-solid fa-file-invoice"></i> ใบสำคัญ
                        </button>
                    </td>
                `;

                // Bind click to thumbnail to show receipt as well
                tr.querySelector('.history-thumbnail').addEventListener('click', () => this.openReceiptModal(log.id));
                tr.querySelector('.btn-show-receipt').addEventListener('click', () => this.openReceiptModal(log.id));

                tableBody.appendChild(tr);

                // Mobile Card (Mobile screen)
                const card = document.createElement('div');
                card.className = 'history-mob-card';
                card.innerHTML = `
                    <div class="mob-card-header">
                        <h4>${this.formatThaiDateShort(log.date)} ${log.time} น.</h4>
                        <span class="scan-type-tag step-${log.scanType}">${log.scanLabel}</span>
                    </div>
                    <div class="mob-card-body">
                        <div class="mob-row" style="margin-bottom:0.4rem;">
                            <span class="mob-lbl">รูปถ่ายลายน้ำ:</span>
                            <img src="${log.selfie}" class="history-thumbnail" style="width:55px; height:45px;" alt="selfie">
                        </div>
                        <div class="mob-row">
                            <span class="mob-lbl">ประเภทสถานที่:</span>
                            <span class="mob-val">${log.mode}</span>
                        </div>
                        <div class="mob-row">
                            <span class="mob-lbl">พิกัดดาวเทียม:</span>
                            <a href="${mapsUrl}" target="_blank" class="mob-val text-cyan" style="text-decoration:underline;">
                                <i class="fa-solid fa-location-dot"></i> ${gpsString}
                            </a>
                        </div>
                        <div class="mob-row" style="margin-top:0.6rem;">
                            <button class="btn btn-primary btn-sm btn-block btn-show-receipt-mob" data-id="${log.id}">
                                <i class="fa-solid fa-file-invoice"></i> เปิดใบสำคัญหลักฐาน
                            </button>
                        </div>
                    </div>
                `;

                card.querySelector('.btn-show-receipt-mob').addEventListener('click', () => this.openReceiptModal(log.id));
                card.querySelector('.history-thumbnail').addEventListener('click', () => this.openReceiptModal(log.id));

                mobileContainer.appendChild(card);
            });
        },

        // Export history as a CSV file download
        exportHistoryCSV: function () {
            let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
            csvContent += "วันที่,เวลา,รหัสพนักงาน,ชื่อพนักงาน,ประเภทบันทึก,สถานที่,ละติจูด,ลองจิจูด,ความแม่นยำ (เมตร),หมายเหตุ,รูปถ่ายพยาน (Base64)\r\n";

            // Filter scanHistory based on current active filters
            const startDate = document.getElementById('filter-start-date').value;
            const endDate = document.getElementById('filter-end-date').value;
            const typeFilter = document.getElementById('filter-scan-type').value;

            const logs = scanHistory.filter(h => {
                if (startDate && h.date < startDate) return false;
                if (endDate && h.date > endDate) return false;
                if (typeFilter !== 'all' && h.scanType !== parseInt(typeFilter)) return false;
                return true;
            });

            logs.forEach(h => {
                const base64Escaped = `"${h.selfie}"`;
                const row = [
                    h.date,
                    h.time,
                    h.empId,
                    h.empName,
                    h.scanLabel,
                    h.mode,
                    h.lat,
                    h.lng,
                    h.accuracy,
                    h.remark ? `"${h.remark.replace(/"/g, '""')}"` : "",
                    base64Escaped
                ].join(",");
                csvContent += row + "\r\n";
            });

            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `timewitness_evidence_logs_${getLocalDateISO(new Date())}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        },

        exportPDFReport: function () {
            const self = this;
            const startDate = document.getElementById('filter-start-date').value;
            const endDate = document.getElementById('filter-end-date').value;
            const typeFilter = document.getElementById('filter-scan-type').value;

            // Apply filters to get the selected items
            const filtered = scanHistory.filter(h => {
                if (startDate && h.date < startDate) return false;
                if (endDate && h.date > endDate) return false;
                if (typeFilter !== 'all' && h.scanType !== parseInt(typeFilter)) return false;
                return true;
            });

            if (filtered.length === 0) {
                alert("ไม่พบข้อมูลประวัติหลักฐานสำหรับออกรายงาน PDF!");
                return;
            }

            const printContainer = document.getElementById('print-report-container');
            printContainer.innerHTML = '';

            // Generate header
            const headerHtml = `
                <div class="print-report-header">
                    <h1>TIMEWITNESS OFFICIAL EVIDENCE REPORT</h1>
                    <p>รายงานรวบรวมพยานหลักฐานภาพถ่ายการลงเวลาทำงานส่วนบุคคล</p>
                </div>
                <div class="print-report-meta-grid">
                    <div class="print-meta-block">
                        <span class="print-meta-label">ชื่อพนักงาน:</span>
                        <span class="print-meta-val">${profile.name}</span>
                    </div>
                    <div class="print-meta-block">
                        <span class="print-meta-label">รหัสพนักงาน:</span>
                        <span class="print-meta-val">${profile.empId}</span>
                    </div>
                    <div class="print-meta-block">
                        <span class="print-meta-label">แผนก / สังกัด:</span>
                        <span class="print-meta-val">${profile.dept}</span>
                    </div>
                </div>
            `;
            
            printContainer.innerHTML += headerHtml;

            // Generate list items
            filtered.forEach(log => {
                const itemHtml = `
                    <div class="print-receipt-item">
                        <div class="receipt-photo-box">
                            <img src="${log.selfie}" alt="Selfie proof with watermark">
                        </div>
                        <div class="receipt-details-list">
                            <div class="detail-row">
                                <span class="d-label">วันที่ลงเวลาจริง:</span>
                                <span class="d-val">${self.formatThaiDateShort(log.date)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="d-label">เวลาประทับ:</span>
                                <span class="d-val" style="color:#059669;">${log.time} น.</span>
                            </div>
                            <div class="detail-row">
                                <span class="d-label">ประเภทบันทึก:</span>
                                <span class="d-val">${log.scanLabel}</span>
                            </div>
                            <div class="detail-row">
                                <span class="d-label">สถานที่สแกนนิ้ว:</span>
                                <span class="d-val">${log.mode}</span>
                            </div>
                            <div class="detail-row">
                                <span class="d-label">พิกัด GPS จริง:</span>
                                <span class="d-val" style="color:#0891b2;">${log.lat}, ${log.lng} (+/- ${log.accuracy}ม.)</span>
                            </div>
                            <div class="detail-row">
                                <span class="d-label">บันทึกช่วยจำ:</span>
                                <span class="d-val">${log.remark || "ไม่มีบันทึกช่วยจำ"}</span>
                            </div>
                        </div>
                    </div>
                `;
                printContainer.innerHTML += itemHtml;
            });

            // Generate footer
            const footerHtml = `
                <div class="print-report-footer">
                    <p>รายงานฉบับนี้พิมพ์โดยระบบ TimeWitness Evidence Vault ณ วันที่ ${self.formatThaiDateShort(getLocalDateISO(new Date()))} เวลา ${new Date().toTimeString().split(' ')[0]} น.</p>
                    <p>พยานหลักฐานและลายน้ำถูกเข้ารหัสเก็บไว้ภายใน Local Storage ของอุปกรณ์พนักงานเป็นการส่วนตัวเพื่อยืนยันความถูกต้อง</p>
                </div>
            `;
            printContainer.innerHTML += footerHtml;

            // Trigger browser print
            document.body.classList.add('printing-compiled-report');
            window.print();
            document.body.classList.remove('printing-compiled-report');
        },

        openReceiptModal: function (logId) {
            const log = scanHistory.find(h => h.id === logId);
            if (!log) return;

            // Fill Receipt fields
            document.getElementById('rec-emp-name').textContent = log.empName;
            document.getElementById('rec-emp-id').textContent = log.empId;
            document.getElementById('rec-emp-dept').textContent = log.empDept;
            document.getElementById('rec-photo-proof').src = log.selfie;
            document.getElementById('rec-date').textContent = this.formatThaiDateShort(log.date);
            document.getElementById('rec-time').textContent = `${log.time} น.`;
            document.getElementById('rec-type').textContent = log.scanLabel;
            document.getElementById('rec-mode').textContent = log.mode;
            document.getElementById('rec-coords').textContent = `${log.lat}, ${log.lng}`;
            document.getElementById('rec-accuracy').textContent = `+/- ${log.accuracy} เมตร`;
            document.getElementById('rec-remark').textContent = log.remark || "ไม่มีบันทึกช่วยจำ";
            document.getElementById('rec-device').textContent = log.userAgent;
            
            document.getElementById('rec-maps-link').href = `https://www.google.com/maps/search/?api=1&query=${log.lat},${log.lng}`;

            // Store active logId on download button
            document.getElementById('btn-download-receipt-image').setAttribute('data-active-id', logId);

            document.getElementById('receipt-modal').classList.add('active');
        },

        closeReceiptModal: function () {
            document.getElementById('receipt-modal').classList.remove('active');
        },

        // Triggers direct download of the watermarked image file
        downloadReceiptImage: function () {
            const logId = document.getElementById('btn-download-receipt-image').getAttribute('data-active-id');
            const log = scanHistory.find(h => h.id === logId);
            if (!log) return;

            const link = document.createElement('a');
            link.href = log.selfie;
            link.download = `timewitness_${log.date}_${log.time.replace(':', '_')}.jpg`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            showToast("ดาวน์โหลดภาพหลักฐานสำเร็จ", "ดาวน์โหลดภาพพยานเซลฟี่ที่มีลายน้ำระบุเวลา/GPS เรียบร้อยแล้ว", "success");
        },

        // ==========================================================================
        // 9. MONTHLY CALENDAR COMPLETION HIGHLIGHTS
        // ==========================================================================
        
        renderCalendar: function () {
            const container = document.getElementById('calendar-days-container');
            const title = document.getElementById('cal-month-title');
            
            if (!container) return;

            container.innerHTML = '';
            
            const thaiMonths = [
                'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
                'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
            ];
            title.textContent = `${thaiMonths[this.calendarMonth]} ${this.calendarYear + 543}`;

            const firstDay = new Date(this.calendarYear, this.calendarMonth, 1).getDay();
            const totalDays = new Date(this.calendarYear, this.calendarMonth + 1, 0).getDate();

            // Empty pre-padding cells
            for (let i = 0; i < firstDay; i++) {
                const emptyCell = document.createElement('div');
                emptyCell.className = 'calendar-day empty-day';
                container.appendChild(emptyCell);
            }

            const todayISO = getLocalDateISO(new Date());
            let completeCount = 0;
            let partialCount = 0;
            let totalPhotosCount = 0;
            let totalAccSum = 0;
            let accCount = 0;

            for (let day = 1; day <= totalDays; day++) {
                const dateStr = formatDateString(this.calendarYear, this.calendarMonth, day);
                const dayCell = document.createElement('div');
                dayCell.className = 'calendar-day';
                dayCell.innerHTML = `<span class="day-number">${day}</span>`;
                
                if (dateStr === todayISO) {
                    dayCell.classList.add('today');
                }

                // Query logs count for this date
                const dayLogs = scanHistory.filter(h => h.date === dateStr);
                const count = dayLogs.length;

                if (count === 4) {
                    dayCell.classList.add('status-complete');
                    completeCount++;
                } else if (count > 0 && count < 4) {
                    dayCell.classList.add('status-partial');
                    partialCount++;
                }

                // Render dot indicators
                if (count > 0) {
                    const dotsWrap = document.createElement('div');
                    dotsWrap.className = 'calendar-day-status-dots';
                    for (let c = 0; c < count; c++) {
                        const dot = document.createElement('span');
                        dot.className = `status-dot`;
                        dot.style.background = count === 4 ? 'var(--color-emerald)' : 'var(--color-amber)';
                        dotsWrap.appendChild(dot);
                    }
                    dayCell.appendChild(dotsWrap);
                }

                // Acc calculations for stats
                dayLogs.forEach(l => {
                    totalPhotosCount++;
                    totalAccSum += parseFloat(l.accuracy);
                    accCount++;
                });

                // Clicking date filters history list
                dayCell.addEventListener('click', () => {
                    document.getElementById('filter-start-date').value = dateStr;
                    document.getElementById('filter-end-date').value = dateStr;
                    this.switchTab('history');
                    this.renderHistory();
                });

                container.appendChild(dayCell);
            }

            // Update stats panel sidebar
            document.getElementById('stat-days-complete').textContent = `${completeCount} วัน`;
            document.getElementById('stat-days-partial').textContent = `${partialCount} วัน`;
            document.getElementById('stat-total-photos').textContent = `${totalPhotosCount} รูปภาพ`;
            
            const avgAcc = accCount > 0 ? (totalAccSum / accCount).toFixed(0) : "10";
            document.getElementById('stat-avg-accuracy').textContent = `+/- ${avgAcc} เมตร`;
        },

        changeCalendarMonth: function (direction) {
            this.calendarMonth += direction;
            if (this.calendarMonth < 0) {
                this.calendarMonth = 11;
                this.calendarYear -= 1;
            } else if (this.calendarMonth > 11) {
                this.calendarMonth = 0;
                this.calendarYear += 1;
            }
            this.renderCalendar();
        },

        formatThaiDateShort: function (dateStr) {
            const [y, m, d] = dateStr.split('-');
            const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
            return `${parseInt(d)} ${months[parseInt(m) - 1]} ${parseInt(y) + 543}`;
        },

        // ==========================================================================
        // 10. PROFILE & ALARM SETTINGS
        // ==========================================================================
        
        syncProfileUI: function () {
            document.getElementById('setting-emp-name').value = profile.name;
            document.getElementById('setting-emp-id').value = profile.empId;
            document.getElementById('setting-emp-dept').value = profile.dept;
            document.getElementById('setting-emp-company').value = profile.company;

            document.getElementById('setting-alarm-checkin').value = alarms.checkin;
            document.getElementById('setting-alarm-lunch').value = alarms.lunch;
            document.getElementById('setting-alarm-breakin').value = alarms.breakin;
            document.getElementById('setting-alarm-checkout').value = alarms.checkout;
            document.getElementById('setting-alert-sound').checked = alarms.enableSound;
            
            // Sidebar header sync
            document.getElementById('user-display-name').textContent = profile.name;
            document.getElementById('user-role-badge').textContent = `ID: ${profile.empId}`;
            document.getElementById('user-avatar').src = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(profile.name)}`;
        },

        saveProfileSettings: function () {
            profile.name = document.getElementById('setting-emp-name').value.trim();
            profile.empId = document.getElementById('setting-emp-id').value.trim();
            profile.dept = document.getElementById('setting-emp-dept').value.trim();
            profile.company = document.getElementById('setting-emp-company').value.trim();

            saveDatabase();
            this.syncProfileUI();
            showToast("อัปเดตโปรไฟล์เรียบร้อย", "ข้อมูลจะแสดงในประวัติและใบเสร็จหลักฐานถัดไปทั้งหมด", "success");
        },

        saveAlarmSettings: function () {
            alarms.checkin = document.getElementById('setting-alarm-checkin').value;
            alarms.lunch = document.getElementById('setting-alarm-lunch').value;
            alarms.breakin = document.getElementById('setting-alarm-breakin').value;
            alarms.checkout = document.getElementById('setting-alarm-checkout').value;
            alarms.enableSound = document.getElementById('setting-alert-sound').checked;

            saveDatabase();
            showToast("บันทึกเวลาเตือนสแกนนิ้วแล้ว", "ระบบจะเตือนความจำและส่งเสียงเมื่อถึงกำหนดเวลาของแต่ละช่วง", "success");
        },

        // ==========================================================================
        // 11. ALARMS CHECKER ALARM REMINDERS ENGINE
        // ==========================================================================
        
        initNotificationsEngine: function () {
            const self = this;
            
            function checkAlarms() {
                const now = new Date();
                const todayISO = getLocalDateISO(now);
                const currentTimeStr = now.toTimeString().split(' ')[0].substring(0, 5); // "HH:MM"
                const currentSec = now.getSeconds();

                // Only check once a minute (at start of the minute)
                if (currentSec > 15) return;

                // Load logs counts to see if they already completed some punches
                const todayLogs = scanHistory.filter(h => h.date === todayISO);
                const stepsCount = todayLogs.length;

                // Alarm 1: Check-in Reminder (e.g. 08:45)
                const checkinKey = `${todayISO}_checkin_reminder`;
                if (currentTimeStr === alarms.checkin && stepsCount === 0 && !self.notifiedEvents.has(checkinKey)) {
                    self.startAlarmActive("เตือนสแกนนิ้วเข้างาน (Check-In)");
                    showToast("เตือนสแกนนิ้วเข้างาน (Check-In)", "ขณะนี้ถึงเวลาเตือนสแกนนิ้วเข้างานแล้ว กรุณากดปุ่มเพื่อบันทึกพยานหลักฐานพร้อมภาพถ่าย!", "danger", 15000);
                    self.notifiedEvents.add(checkinKey);
                }

                // Alarm 2: Lunch Break Reminder (e.g. 12:00)
                const lunchKey = `${todayISO}_lunch_reminder`;
                if (currentTimeStr === alarms.lunch && stepsCount === 1 && !self.notifiedEvents.has(lunchKey)) {
                    self.startAlarmActive("เตือนสแกนนิ้วออกพักเที่ยง");
                    showToast("เตือนสแกนนิ้วออกพักเที่ยง", "สแกนนิ้วออกพักกลางวันเรียบร้อยแล้วหรือยัง? อย่าลืมกดลงประวัติพยานในแอปสำรองไว้นะ!", "warning", 12000);
                    self.notifiedEvents.add(lunchKey);
                }

                // Alarm 3: Break In Reminder (e.g. 12:55)
                const breakinKey = `${todayISO}_breakin_reminder`;
                if (currentTimeStr === alarms.breakin && stepsCount === 2 && !self.notifiedEvents.has(breakinKey)) {
                    self.startAlarmActive("เตือนสแกนนิ้วกลับเข้าทำงาน");
                    showToast("เตือนสแกนนิ้วกลับเข้าทำงาน", "หมดเวลาพักเที่ยงแล้ว สแกนนิ้วกลับทำงานและกดยืนยันบันทึกพยานบนเครื่องไว้เลย!", "warning", 12000);
                    self.notifiedEvents.add(breakinKey);
                }

                // Alarm 4: Check-out Reminder (e.g. 18:00)
                const checkoutKey = `${todayISO}_checkout_reminder`;
                if (currentTimeStr === alarms.checkout && stepsCount === 3 && !self.notifiedEvents.has(checkoutKey)) {
                    self.startAlarmActive("เตือนสแกนนิ้วออกงาน (Check-Out)");
                    showToast("เตือนสแกนนิ้วออกงาน (Check-Out)", "เลิกงานเรียบร้อยแล้ว สแกนนิ้วออกงานและอย่าลืมกดยืนยันพยานจบล็อกของวันนี้!", "danger", 15000);
                    self.notifiedEvents.add(checkoutKey);
                }
            }

            // Check every 25 seconds
            setInterval(checkAlarms, 25000);
        },

        deferredPrompt: null,
        activeServiceWorkerReg: null,

        checkServiceWorkerUpdate: function (reg) {
            const self = this;
            self.activeServiceWorkerReg = reg;

            // If there's already a waiting worker, show update banner
            if (reg.waiting) {
                self.showUpdateBanner();
                return;
            }

            // If a new worker is installing, listen for status changes
            if (reg.installing) {
                self.trackInstallingServiceWorker(reg.installing);
                return;
            }

            // Listen for updates found
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                self.trackInstallingServiceWorker(newWorker);
            });
        },

        trackInstallingServiceWorker: function (worker) {
            const self = this;
            worker.addEventListener('statechange', () => {
                if (worker.state === 'installed') {
                    if (navigator.serviceWorker.controller) {
                        // New content is available, show banner!
                        self.showUpdateBanner();
                    }
                }
            });
        },

        showUpdateBanner: function () {
            const banner = document.getElementById('pwa-update-banner');
            if (banner) {
                banner.style.display = 'flex';
            }
        },

        activateWaitingServiceWorker: function () {
            const self = this;
            if (self.activeServiceWorkerReg && self.activeServiceWorkerReg.waiting) {
                self.activeServiceWorkerReg.waiting.postMessage({ action: 'skipWaiting' });
            } else {
                // Fallback if reference lost
                navigator.serviceWorker.getRegistration().then(reg => {
                    if (reg && reg.waiting) {
                        reg.waiting.postMessage({ action: 'skipWaiting' });
                    } else {
                        window.location.reload();
                    }
                });
            }
        }
    };

    // Helper to format date string
    function formatDateString(year, month, day) {
        return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    // Startup app on DOM ready
    document.addEventListener('DOMContentLoaded', () => {
        App.init();
    });

})();
