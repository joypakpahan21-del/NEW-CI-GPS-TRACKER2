// ==== FIREBASE CONFIG (SAMA DENGAN LAPTOP) ====
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBMiER_5b51IEEoxivkCliRC0WID1f-yzk",
    authDomain: "joi-gps-tracker.firebaseapp.com",
    databaseURL: "https://joi-gps-tracker-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "joi-gps-tracker",
    storageBucket: "joi-gps-tracker.firebasestorage.app",
    messagingSenderId: "216572191895",
    appId: "1:216572191895:web:a4fef1794daf200a2775d2"
};

// ==== APP CONFIGURATION ====
const APP_CONFIG = {
    GPS: {
        HIGH_ACCURACY: true,
        TIMEOUT: 10000,
        MAXIMUM_AGE: 0,
        FOREGROUND_INTERVAL: 1000,
        BACKGROUND_INTERVAL: 5000
    },
    TRANSMISSION: {
        BATCH_SIZE: 10,
        INTERVAL: 1000,
        MAX_RETRIES: 3,
        RETRY_DELAY: 2000
    },
    PERFORMANCE: {
        MAX_DATA_POINTS: 10000,
        CLEANUP_INTERVAL: 300000
    }
};

// Initialize Firebase
firebase.initializeApp(FIREBASE_CONFIG);
const database = firebase.database();

// ==== ENHANCED ERROR HANDLER WITH RETRY LOGIC ====
class EnhancedErrorHandler {
    constructor(maxRetries = 3) {
        this.maxRetries = maxRetries;
        this.retryCount = 0;
    }

    async withRetry(operation, context = '') {
        while (this.retryCount < this.maxRetries) {
            try {
                const result = await operation();
                this.retryCount = 0;
                return result;
            } catch (error) {
                this.retryCount++;
                console.warn(`${context} attempt ${this.retryCount} failed:`, error);
                
                if (this.retryCount >= this.maxRetries) {
                    this.retryCount = 0;
                    throw new Error(`${context} failed after ${this.maxRetries} attempts`);
                }
                
                await this.delay(Math.pow(2, this.retryCount) * 1000);
            }
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ==== OFFLINE STORAGE WITH INDEXEDDB ====
class OfflineStorage {
    constructor() {
        this.dbName = 'DTGPSData';
        this.version = 1;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('gps_data')) {
                    const store = db.createObjectStore('gps_data', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('synced', 'synced', { unique: false });
                }
            };
        });
    }

    async storeData(data) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['gps_data'], 'readwrite');
            const store = transaction.objectStore('gps_data');
            
            const request = store.add({
                ...data,
                timestamp: new Date().toISOString(),
                synced: false
            });
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getUnsyncedData() {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['gps_data'], 'readonly');
            const store = transaction.objectStore('gps_data');
            
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result.filter(item => !item.synced));
            request.onerror = () => reject(request.error);
        });
    }

    async markAsSynced(ids) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['gps_data'], 'readwrite');
            const store = transaction.objectStore('gps_data');
            
            const promises = ids.map(id => {
                return new Promise((resolve, reject) => {
                    const getRequest = store.get(id);
                    getRequest.onsuccess = () => {
                        const data = getRequest.result;
                        if (data) {
                            data.synced = true;
                            const putRequest = store.put(data);
                            putRequest.onsuccess = () => resolve();
                            putRequest.onerror = () => reject(putRequest.error);
                        } else {
                            resolve();
                        }
                    };
                    getRequest.onerror = () => reject(getRequest.error);
                });
            });
            
            Promise.all(promises).then(resolve).catch(reject);
        });
    }
}

// ==== PERFORMANCE MONITOR ====
class PerformanceMonitor {
    constructor() {
        this.metrics = {
            gpsUpdates: 0,
            dataTransmissions: 0,
            errors: 0,
            averageAccuracy: 0,
            batteryUsage: 0,
            startTime: Date.now()
        };
    }

    recordGPSUpdate(accuracy) {
        this.metrics.gpsUpdates++;
        this.metrics.averageAccuracy = 
            (this.metrics.averageAccuracy * (this.metrics.gpsUpdates - 1) + accuracy) / this.metrics.gpsUpdates;
    }

    recordTransmission(success) {
        this.metrics.dataTransmissions++;
        if (!success) this.metrics.errors++;
    }

    getPerformanceReport() {
        const duration = (Date.now() - this.metrics.startTime) / 60000; // minutes
        return {
            ...this.metrics,
            transmissionSuccessRate: this.metrics.dataTransmissions > 0 ? 
                ((this.metrics.dataTransmissions - this.metrics.errors) / this.metrics.dataTransmissions * 100).toFixed(1) : 100,
            dataPointsPerMinute: duration > 0 ? (this.metrics.gpsUpdates / duration).toFixed(1) : 0,
            uptime: Math.round(duration)
        };
    }
}

// ==== MAIN GPS LOGGER CLASS (ENHANCED) ====
class DTGPSLogger {
    constructor() {
        this.driverData = null;
        this.watchId = null;
        this.isTracking = false;
        this.sendInterval = null;
        this.sessionStartTime = null;
        this.totalDistance = 0;
        this.lastPosition = null;
        this.dataPoints = 0;
        this.pendingData = [];
        this.isOnline = false;
        this.journeyStatus = 'ready';
        this.sessionId = null;
        
        // NEW: Enhanced components
        this.errorHandler = new EnhancedErrorHandler();
        this.offlineStorage = new OfflineStorage();
        this.performanceMonitor = new PerformanceMonitor();
        this.batteryOptimizationEnabled = false;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.updateTime();
        this.checkNetworkStatus();
        this.initializeOfflineStorage();
        
        // Update time every second
        setInterval(() => this.updateTime(), 1000);
        
        // Check network status every 5 seconds
        setInterval(() => this.checkNetworkStatus(), 5000);
        
        // Try to send pending data every 30 seconds when offline
        setInterval(() => {
            if (!this.isOnline) {
                this.processOfflineData();
            }
        }, 30000);

        // Performance monitoring every minute
        setInterval(() => {
            this.logPerformanceMetrics();
        }, 60000);

        console.log('DT GPS Logger initialized with enhanced features');
    }

    async initializeOfflineStorage() {
        try {
            await this.offlineStorage.init();
            this.addLog('Offline storage initialized', 'success');
        } catch (error) {
            console.error('Failed to initialize offline storage:', error);
            this.addLog('Offline storage unavailable', 'warning');
        }
    }

    setupEventListeners() {
        // Login form submission
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleLogin();
            });
        }

        // Enhanced page visibility handling with battery optimization
        document.addEventListener('visibilitychange', () => {
            if (this.driverData) {
                if (document.hidden) {
                    this.addLog('Aplikasi berjalan di background - optimizing battery', 'info');
                    this.optimizeBatteryUsage(true);
                } else {
                    this.addLog('Aplikasi aktif kembali - full tracking mode', 'success');
                    this.optimizeBatteryUsage(false);
                }
            }
        });

        // Handle online/offline events with enhanced offline support
        window.addEventListener('online', () => {
            this.checkNetworkStatus();
            this.addLog('Koneksi internet tersedia - syncing offline data', 'success');
            this.processOfflineData();
        });

        window.addEventListener('offline', () => {
            this.checkNetworkStatus();
            this.addLog('Koneksi internet terputus - menggunakan offline storage', 'warning');
        });

        // Prevent form resubmission on page refresh
        window.addEventListener('beforeunload', (e) => {
            if (this.driverData && this.isTracking) {
                e.preventDefault();
                e.returnValue = 'Data tracking sedang berjalan. Yakin ingin meninggalkan halaman?';
            }
        });

        // Battery level monitoring
        if ('getBattery' in navigator) {
            navigator.getBattery().then(battery => {
                battery.addEventListener('levelchange', () => {
                    this.handleBatteryLevelChange(battery.level);
                });
            });
        }
    }

    // NEW: Battery optimization
    optimizeBatteryUsage(isBackground) {
        if (!this.isTracking) return;

        if (isBackground) {
            // Reduce GPS frequency in background
            this.setGPSInterval(APP_CONFIG.GPS.BACKGROUND_INTERVAL);
            this.batteryOptimizationEnabled = true;
        } else {
            // Normal GPS frequency in foreground
            this.setGPSInterval(APP_CONFIG.GPS.FOREGROUND_INTERVAL);
            this.batteryOptimizationEnabled = false;
        }
    }

    setGPSInterval(interval) {
        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
        }
        
        const options = {
            enableHighAccuracy: APP_CONFIG.GPS.HIGH_ACCURACY,
            timeout: interval,
            maximumAge: APP_CONFIG.GPS.MAXIMUM_AGE
        };
        
        this.watchId = navigator.geolocation.watchPosition(
            (position) => this.handlePositionUpdate(position),
            (error) => this.handleGPSError(error),
            options
        );
    }

    handleBatteryLevelChange(level) {
        const batteryPercent = Math.round(level * 100);
        this.updateUIElement('batteryLevel', `${batteryPercent}%`);
        
        if (batteryPercent < 20 && !this.batteryOptimizationEnabled) {
            this.addLog('Battery low - enabling power saving mode', 'warning');
            this.optimizeBatteryUsage(true);
        }
    }

    handleLogin() {
        const driverName = document.getElementById('driverName').value.trim();
        const unitNumber = document.getElementById('unitNumber').value;

        if (!driverName || !unitNumber) {
            this.showNotification('Harap isi semua field!', 'error');
            return;
        }

        // NEW: Input validation
        if (!this.validateLoginInput(driverName, unitNumber)) {
            return;
        }

        // Show loading state
        this.setLoadingState(true);

        // Simulate login process
        setTimeout(() => {
            this.driverData = {
                name: this.sanitizeInput(driverName),
                unit: unitNumber,
                year: this.getVehicleYear(unitNumber)
            };

            this.sessionId = this.generateSessionId();
            this.showDriverApp();
            this.startGPSTracking();
            this.startDataTransmission();
            
            this.setLoadingState(false);
            
            // Auto start journey after 3 seconds
            setTimeout(() => {
                this.startJourney();
            }, 3000);

        }, 1000);
    }

    // NEW: Input validation
    validateLoginInput(driverName, unitNumber) {
        if (driverName.length < 2) {
            this.showNotification('Nama driver harus minimal 2 karakter', 'error');
            return false;
        }

        if (driverName.length > 50) {
            this.showNotification('Nama driver terlalu panjang', 'error');
            return false;
        }

        const unitRegex = /^DT-\d+$/;
        if (!unitRegex.test(unitNumber)) {
            this.showNotification('Format nomor unit tidak valid', 'error');
            return false;
        }

        return true;
    }

    // NEW: Input sanitization
    sanitizeInput(input) {
        const div = document.createElement('div');
        div.textContent = input;
        return div.innerHTML.replace(/[<>]/g, '');
    }

    getVehicleYear(unit) {
        const yearMap = {
            'DT-06': '2018', 'DT-07': '2018',
            'DT-12': '2020', 'DT-13': '2020', 'DT-15': '2020', 'DT-16': '2020', 
            'DT-17': '2020', 'DT-18': '2020', 'DT-36': '2020', 'DT-37': '2020',
            'DT-38': '2020', 'DT-39': '2020',
            'DT-23': '2021', 'DT-24': '2021',
            'DT-25': '2022', 'DT-26': '2022', 'DT-27': '2022', 'DT-28': '2022', 'DT-29': '2022',
            'DT-32': '2024',
            'DT-33': '2025', 'DT-34': '2025', 'DT-35': '2025'
        };
        return yearMap[unit] || 'Unknown';
    }

    generateSessionId() {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        return `DT_${timestamp}_${random}`;
    }

    setLoadingState(loading) {
        const buttons = document.querySelectorAll('button');
        buttons.forEach(button => {
            if (loading) {
                button.disabled = true;
                button.classList.add('loading');
            } else {
                button.disabled = false;
                button.classList.remove('loading');
            }
        });
    }

    showDriverApp() {
        const loginScreen = document.getElementById('loginScreen');
        const driverApp = document.getElementById('driverApp');

        if (loginScreen && driverApp) {
            loginScreen.style.display = 'none';
            driverApp.style.display = 'block';
            driverApp.classList.add('fade-in');
        }

        // Update UI with driver data
        this.updateUIElement('vehicleName', this.driverData.unit);
        this.updateUIElement('driverDisplayName', this.driverData.name);

        this.sessionStartTime = new Date();
        this.updateSessionDuration();

        this.addLog(`Login berhasil - ${this.driverData.name} - ${this.driverData.unit}`, 'success');
    }

    startGPSTracking() {
        if (!navigator.geolocation) {
            this.addLog('GPS tidak didukung di browser ini', 'error');
            this.showNotification('GPS tidak didukung di perangkat Anda', 'error');
            return;
        }

        // Request permission first
        if (!this.checkGeolocationPermission()) {
            this.addLog('Menunggu izin akses lokasi...', 'warning');
            return;
        }

        this.isTracking = true;
        this.setGPSInterval(APP_CONFIG.GPS.FOREGROUND_INTERVAL);

        this.addLog('GPS tracking aktif - interval 1 detik', 'success');
    }

    checkGeolocationPermission() {
        return new Promise((resolve) => {
            if (!navigator.permissions) {
                resolve(true);
                return;
            }

            navigator.permissions.query({ name: 'geolocation' })
                .then((result) => {
                    if (result.state === 'granted') {
                        resolve(true);
                    } else if (result.state === 'prompt') {
                        resolve(true);
                    } else {
                        this.showNotification('Izin akses lokasi diperlukan untuk tracking GPS', 'warning');
                        resolve(false);
                    }
                })
                .catch(() => resolve(true));
        });
    }

    handlePositionUpdate(position) {
        // NEW: Data validation
        if (!this.validateGPSData(position)) {
            this.addLog('Data GPS tidak valid - diabaikan', 'warning');
            return;
        }

        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const speed = position.coords.speed !== null ? position.coords.speed * 3.6 : 0;
        const accuracy = position.coords.accuracy;
        const bearing = position.coords.heading;
        const altitude = position.coords.altitude;
        const timestamp = new Date().toISOString();

        // Update performance metrics
        this.performanceMonitor.recordGPSUpdate(accuracy);

        // Update UI
        this.updateUIElement('currentLat', lat.toFixed(6));
        this.updateUIElement('currentLng', lng.toFixed(6));
        this.updateUIElement('currentSpeed', speed.toFixed(1));
        this.updateUIElement('gpsAccuracy', `${accuracy.toFixed(1)} m`);
        this.updateUIElement('gpsBearing', bearing ? `${bearing.toFixed(0)}°` : '-');

        // Calculate distance if journey has started and we have previous position
        if (this.lastPosition && this.journeyStatus === 'started' && speed > 1) {
            const distance = this.calculateDistance(
                this.lastPosition.lat,
                this.lastPosition.lng,
                lat,
                lng
            );
            
            // Only add distance if it's reasonable (filter GPS jumps)
            if (distance < 0.1) { // Max 100 meters between points
                this.totalDistance += distance;
                this.updateUIElement('todayDistance', this.totalDistance.toFixed(2));
            }
        }

        // NEW: Compress GPS data before sending
        const gpsData = this.compressGPSData({
            sessionId: this.sessionId,
            driver: this.driverData.name,
            unit: this.driverData.unit,
            lat: lat,
            lng: lng,
            speed: speed,
            accuracy: accuracy,
            bearing: bearing,
            altitude: altitude,
            timestamp: timestamp,
            distance: this.totalDistance,
            journeyStatus: this.journeyStatus,
            batteryLevel: this.getBatteryLevel()
        });

        this.pendingData.push(gpsData);
        this.dataPoints++;
        this.updateUIElement('dataPoints', this.dataPoints);

        this.lastPosition = { lat, lng, timestamp, speed };

        // Update average speed
        this.updateAverageSpeed();

        // Log position update occasionally
        if (this.dataPoints % 10 === 0) {
            this.addLog(`Posisi updated #${this.dataPoints} - ${speed.toFixed(1)} km/h`, 'info');
        }
    }

    // NEW: GPS data validation
    validateGPSData(position) {
        const coords = position.coords;
        
        // Check for valid coordinates
        if (coords.latitude < -90 || coords.latitude > 90) return false;
        if (coords.longitude < -180 || coords.longitude > 180) return false;
        
        // Check for reasonable accuracy
        if (coords.accuracy > 1000) return false; // More than 1km accuracy is suspicious
        
        // Check for reasonable speed
        if (coords.speed !== null && coords.speed * 3.6 > 200) return false; // More than 200 km/h
        
        return true;
    }

    // NEW: Data compression for optimization
    compressGPSData(gpsData) {
        return {
            s: this.sessionId, // sessionId
            d: gpsData.driver.substring(0, 3), // driver initials
            u: gpsData.unit, // unit
            lt: Math.round(gpsData.lat * 1000000), // compressed lat
            ln: Math.round(gpsData.lng * 1000000), // compressed lng
            sp: Math.round(gpsData.speed), // speed
            acc: Math.round(gpsData.accuracy), // accuracy
            ts: Date.now(), // timestamp
            st: gpsData.journeyStatus.charAt(0), // status first char
            dst: Math.round(gpsData.distance * 100), // distance compressed
            bat: gpsData.batteryLevel
        };
    }

    // NEW: Decompress GPS data
    decompressGPSData(compressedData) {
        return {
            sessionId: compressedData.s,
            driver: compressedData.d,
            unit: compressedData.u,
            lat: compressedData.lt / 1000000,
            lng: compressedData.ln / 1000000,
            speed: compressedData.sp,
            accuracy: compressedData.acc,
            timestamp: new Date(compressedData.ts).toISOString(),
            journeyStatus: this.expandStatus(compressedData.st),
            distance: compressedData.dst / 100,
            batteryLevel: compressedData.bat
        };
    }

    expandStatus(statusChar) {
        const statusMap = { 'r': 'ready', 's': 'started', 'p': 'paused', 'e': 'ended' };
        return statusMap[statusChar] || 'ready';
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    updateAverageSpeed() {
        if (this.dataPoints > 0 && this.sessionStartTime) {
            const duration = (new Date() - this.sessionStartTime) / 3600000; // hours
            const avgSpeed = duration > 0 ? this.totalDistance / duration : 0;
            this.updateUIElement('avgSpeed', `${avgSpeed.toFixed(1)} km/h`);
        }
    }

    startDataTransmission() {
        // Send data every 1 second
        this.sendInterval = setInterval(() => {
            this.processPendingData();
        }, APP_CONFIG.TRANSMISSION.INTERVAL);

        this.addLog('Transmisi data aktif - interval 1 detik', 'success');
    }

    async processPendingData() {
        if (this.pendingData.length === 0) return;

        try {
            const dataToSend = [...this.pendingData];
            
            // NEW: Enhanced transmission with retry logic
            const success = await this.errorHandler.withRetry(
                () => this.sendToFirebase(dataToSend),
                'Firebase transmission'
            );
            
            if (success) {
                // Remove sent data from pending
                this.pendingData = this.pendingData.slice(dataToSend.length);
                this.updateConnectionStatus(true);
                this.performanceMonitor.recordTransmission(true);
                
                if (dataToSend.length > 0) {
                    this.addLog(`📡 Data terkirim ke Firebase: ${dataToSend.length} points`, 'success');
                }
            } else {
                this.addLog('⚠️ Gagal mengirim data ke Firebase, menyimpan offline', 'warning');
                this.performanceMonitor.recordTransmission(false);
                await this.storeDataOffline(dataToSend);
                this.updateConnectionStatus(false);
            }
        } catch (error) {
            console.error('Firebase transmission error:', error);
            this.addLog('❌ Error transmisi data ke Firebase, menyimpan offline', 'error');
            this.performanceMonitor.recordTransmission(false);
            await this.storeDataOffline(this.pendingData);
            this.pendingData = [];
            this.updateConnectionStatus(false);
        }
    }

    // NEW: Offline data storage
    async storeDataOffline(data) {
        try {
            for (const item of data) {
                await this.offlineStorage.storeData(item);
            }
            this.addLog(`💾 Data disimpan offline: ${data.length} points`, 'info');
        } catch (error) {
            console.error('Failed to store data offline:', error);
            this.addLog('❌ Gagal menyimpan data offline', 'error');
        }
    }

    // NEW: Process offline data when back online
    async processOfflineData() {
        try {
            const unsyncedData = await this.offlineStorage.getUnsyncedData();
            if (unsyncedData.length > 0) {
                this.addLog(`🔄 Syncing offline data: ${unsyncedData.length} points`, 'info');
                
                const success = await this.sendToFirebase(unsyncedData);
                if (success) {
                    const ids = unsyncedData.map(item => item.id).filter(id => id);
                    await this.offlineStorage.markAsSynced(ids);
                    this.addLog(`✅ Offline data synced: ${unsyncedData.length} points`, 'success');
                }
            }
        } catch (error) {
            console.error('Failed to process offline data:', error);
        }
    }

    // ENHANCED: Firebase transmission with compression
    async sendToFirebase(data) {
        try {
            const timestamp = new Date().toISOString();
            const updates = {};
            
            data.forEach((gpsData, index) => {
                const key = `${gpsData.u}_${timestamp}_${index}`; // Use compressed unit
                
                // Send compressed data to reduce bandwidth
                updates[`/gps_data/${key}`] = gpsData;
                
                // Update real-time position untuk monitoring di laptop (decompressed)
                const decompressedData = this.decompressGPSData(gpsData);
                updates[`/units/${gpsData.u}`] = {
                    lat: decompressedData.lat,
                    lng: decompressedData.lng,
                    speed: decompressedData.speed,
                    driver: decompressedData.driver,
                    timestamp: decompressedData.timestamp,
                    journeyStatus: decompressedData.journeyStatus,
                    distance: decompressedData.distance,
                    lastUpdate: new Date().toLocaleTimeString('id-ID'),
                    accuracy: decompressedData.accuracy,
                    batteryLevel: decompressedData.batteryLevel
                };
            });

            await database.ref().update(updates);
            return true;

        } catch (error) {
            console.error('Firebase error:', error);
            return false;
        }
    }

    // NEW: Performance metrics logging
    logPerformanceMetrics() {
        const report = this.performanceMonitor.getPerformanceReport();
        console.log('Performance Report:', report);
        
        // Send performance metrics to Firebase occasionally
        if (this.dataPoints % 60 === 0) { // Every ~60 data points
            database.ref(`/performance/${this.sessionId}_${Date.now()}`).set(report);
        }
    }

    getBatteryLevel() {
        if ('getBattery' in navigator) {
            return navigator.getBattery().then(battery => {
                return Math.round(battery.level * 100);
            });
        }
        return null;
    }

    checkNetworkStatus() {
        this.isOnline = navigator.onLine;
        this.updateConnectionStatus(this.isOnline);
    }

    updateConnectionStatus(connected) {
        const dot = document.getElementById('connectionDot');
        const status = document.getElementById('connectionStatus');
        
        if (!dot || !status) return;

        if (connected) {
            dot.className = 'connection-dot connected';
            status.textContent = 'TERHUBUNG';
            status.className = 'text-success';
        } else {
            dot.className = 'connection-dot disconnected';
            status.textContent = 'OFFLINE';
            status.className = 'text-danger';
        }
    }

    handleGPSError(error) {
        let message = 'GPS Error: ';
        switch(error.code) {
            case error.PERMISSION_DENIED:
                message = 'Izin akses lokasi ditolak';
                this.showNotification('Akses lokasi diperlukan untuk tracking', 'error');
                break;
            case error.POSITION_UNAVAILABLE:
                message = 'Posisi GPS tidak tersedia';
                break;
            case error.TIMEOUT:
                message = 'Timeout mendapatkan posisi GPS';
                break;
            default:
                message = 'Error tidak diketahui pada GPS';
                break;
        }
        this.addLog(message, 'error');
    }

    addLog(message, type = 'info') {
        const logContainer = document.getElementById('dataLogs');
        if (!logContainer) return;

        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        logEntry.innerHTML = `
            <small>${new Date().toLocaleTimeString('id-ID')}: ${message}</small>
        `;
        
        logContainer.insertBefore(logEntry, logContainer.firstChild);
        
        // Keep only last 15 logs
        if (logContainer.children.length > 15) {
            logContainer.removeChild(logContainer.lastChild);
        }

        // Auto scroll to top
        logContainer.scrollTop = 0;
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `alert alert-${type} notification`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            min-width: 300px;
            animation: slideIn 0.3s ease-out;
        `;
        notification.textContent = message;

        document.body.appendChild(notification);

        // Remove after 3 seconds
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    updateUIElement(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = value;
        }
    }

    updateTime() {
        this.updateUIElement('currentTime', new Date().toLocaleTimeString('id-ID'));
    }

    updateSessionDuration() {
        if (!this.sessionStartTime) return;
        
        const now = new Date();
        const diff = now - this.sessionStartTime;
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        
        this.updateUIElement('sessionDuration', 
            `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
        );
        
        setTimeout(() => this.updateSessionDuration(), 1000);
    }

    // Journey Control Methods
    startJourney() {
        this.journeyStatus = 'started';
        this.updateUIElement('vehicleStatus', 'ON TRIP');
        this.addLog('Perjalanan dimulai - GPS tracking aktif', 'success');
        this.showNotification('Perjalanan dimulai - Tracking aktif', 'success');
    }

    pauseJourney() {
        this.journeyStatus = 'paused';
        this.updateUIElement('vehicleStatus', 'PAUSED');
        this.addLog('Perjalanan dijeda', 'warning');
        this.showNotification('Perjalanan dijeda', 'warning');
    }

    endJourney() {
        this.journeyStatus = 'ended';
        this.updateUIElement('vehicleStatus', 'COMPLETED');
        this.addLog('Perjalanan selesai', 'info');
        this.showNotification('Perjalanan selesai', 'info');
        
        // Send final data
        this.processPendingData();
    }

    stopTracking() {
        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        if (this.sendInterval) {
            clearInterval(this.sendInterval);
            this.sendInterval = null;
        }
        
        this.isTracking = false;
    }

    logout() {
        if (!confirm('Yakin ingin logout? Data tracking akan dihentikan.')) {
            return;
        }

        // Send final data before logout
        this.processPendingData().finally(() => {
            this.stopTracking();
            
            // Create session summary with performance data
            const sessionSummary = {
                sessionId: this.sessionId,
                driver: this.driverData.name,
                unit: this.driverData.unit,
                startTime: this.sessionStartTime,
                endTime: new Date(),
                duration: document.getElementById('sessionDuration').textContent,
                totalDistance: this.totalDistance,
                dataPoints: this.dataPoints,
                avgSpeed: document.getElementById('avgSpeed').textContent,
                journeyStatus: this.journeyStatus,
                performance: this.performanceMonitor.getPerformanceReport()
            };
            
            console.log('Session Summary:', sessionSummary);
            
            // Send session summary to Firebase
            this.sendSessionSummary(sessionSummary);
            
            // Reset app state
            this.resetAppState();
            
            this.addLog('Session ended - Driver logged out', 'info');
            this.showNotification('Logout berhasil', 'success');
        });
    }

    async sendSessionSummary(summary) {
        try {
            await database.ref(`/sessions/${this.sessionId}`).set(summary);
            console.log('Session summary sent to Firebase');
        } catch (error) {
            console.log('Gagal mengirim session summary ke Firebase:', error);
            // Store offline if failed
            await this.offlineStorage.storeData({
                type: 'session_summary',
                ...summary
            });
        }
    }

    resetAppState() {
        this.driverData = null;
        this.sessionId = null;
        this.sessionStartTime = null;
        this.totalDistance = 0;
        this.dataPoints = 0;
        this.pendingData = [];
        this.lastPosition = null;
        this.journeyStatus = 'ready';
        this.performanceMonitor = new PerformanceMonitor();

        // Show login screen
        const loginScreen = document.getElementById('loginScreen');
        const driverApp = document.getElementById('driverApp');
        
        if (loginScreen && driverApp) {
            loginScreen.style.display = 'block';
            driverApp.style.display = 'none';
        }

        // Reset form
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.reset();
        }

        // Reset UI elements
        this.updateUIElement('vehicleName', '-');
        this.updateUIElement('driverDisplayName', '-');
        this.updateUIElement('currentSpeed', '0');
        this.updateUIElement('todayDistance', '0.0');
        this.updateUIElement('currentLat', '-');
        this.updateUIElement('currentLng', '-');
        this.updateUIElement('gpsAccuracy', '-');
        this.updateUIElement('gpsBearing', '-');
        this.updateUIElement('sessionDuration', '00:00:00');
        this.updateUIElement('dataPoints', '0');
        this.updateUIElement('avgSpeed', '0');
        this.updateUIElement('vehicleStatus', 'READY');
        this.updateUIElement('batteryLevel', '-');
    }

    reportIssue() {
        const issues = [
            'Mesin bermasalah',
            'Ban bocor', 
            'Bahan bakar habis',
            'Kecelakaan kecil',
            'Kondisi jalan rusak',
            'Kendaraan mogok',
            'Lainnya'
        ];
        
        const issue = prompt('Lapor masalah:\n' + issues.join('\n'));
        if (issue && this.driverData) {
            this.addLog(`Laporan masalah: ${issue}`, 'warning');
            
            const reportData = {
                type: 'issue_report',
                driver: this.driverData.name,
                unit: this.driverData.unit,
                issue: issue,
                timestamp: new Date().toISOString(),
                location: this.lastPosition,
                sessionId: this.sessionId
            };
            
            // Send report immediately ke Firebase
            database.ref(`/issues/${this.sessionId}_${Date.now()}`).set(reportData);
            
            this.showNotification('Laporan masalah terkirim ke Firebase', 'success');
        }
    }
}

// Initialize the application
let dtLogger;

document.addEventListener('DOMContentLoaded', function() {
    dtLogger = new DTGPSLogger();
    console.log('Enhanced DT GPS Logger loaded successfully');
});

// Global functions for HTML button onclick events
function startJourney() {
    if (window.dtLogger) {
        window.dtLogger.startJourney();
    }
}

function pauseJourney() {
    if (window.dtLogger) {
        window.dtLogger.pauseJourney();
    }
}

function endJourney() {
    if (window.dtLogger) {
        window.dtLogger.endJourney();
    }
}

function reportIssue() {
    if (window.dtLogger) {
        window.dtLogger.reportIssue();
    }
}

function logout() {
    if (window.dtLogger) {
        window.dtLogger.logout();
    }
}

// Service Worker Registration for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('/sw.js')
            .then(function(registration) {
                console.log('ServiceWorker registration successful');
            })
            .catch(function(error) {
                console.log('ServiceWorker registration failed: ', error);
            });
    });
}