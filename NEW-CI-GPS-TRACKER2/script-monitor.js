// ==== FIREBASE CONFIG ====
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBMiER_5b51IEEoxivkCliRC0WID1f-yzk",
    authDomain: "joi-gps-tracker.firebaseapp.com",
    databaseURL: "https://joi-gps-tracker-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "joi-gps-tracker",
    storageBucket: "joi-gps-tracker.firebasestorage.app",
    messagingSenderId: "216572191895",
    appId: "1:216572191895:web:a4fef1794daf200a2775d2"
};

// Initialize Firebase
firebase.initializeApp(FIREBASE_CONFIG);
const database = firebase.database();

// SAGM GPS Tracking System for Kebun Tempuling dengan FIREBASE REAL-TIME
class SAGMGpsTracking {
    constructor() {
        this.map = null;
        this.units = [];
        this.markers = {};
        this.importantMarkers = [];
        this.unitHistory = {};
        this.activeUnits = 0;
        this.totalDistance = 0;
        this.avgSpeed = 0;
        this.totalFuelConsumption = 0;
        this.lastUpdate = new Date();
        this.autoRefreshInterval = null;
        this.firebaseListener = null;
        
        // Konfigurasi kendaraan - PARAMETER km/L
        this.vehicleConfig = {
            fuelEfficiency: 4, // 4 km per liter
            maxSpeed: 80,
            idleFuelConsumption: 1.5, // liter per jam saat idle
            fuelTankCapacity: 100 // liter
        };

        // Koordinat penting
        this.importantLocations = {
            PKS_SAGM: { 
                lat: -0.43452332690449164, 
                lng: 102.96741072417917, 
                name: "PKS SAGM",
                type: "pks"
            },
            KANTOR_KEBUN: { 
                lat: -0.3575865859028525, 
                lng: 102.95047687287101, 
                name: "Kantor Kebun PT SAGM",
                type: "office"
            }
        };

        this.config = {
            center: [
                (this.importantLocations.PKS_SAGM.lat + this.importantLocations.KANTOR_KEBUN.lat) / 2,
                (this.importantLocations.PKS_SAGM.lng + this.importantLocations.KANTOR_KEBUN.lng) / 2
            ],
            zoom: 13
        };

        this.init();
    }

    init() {
        try {
            this.initializeMap();
            this.setupEventListeners();
            this.initializeFirebaseListener(); // NEW: Firebase real-time listener
            this.loadUnitData();
            this.startAutoRefresh();
            this.initializeHistoryStorage();
        } catch (error) {
            console.error('Error initializing GPS system:', error);
            this.showError('Gagal menginisialisasi sistem GPS');
        }
    }

    // NEW: Initialize Firebase Real-time Listener
    initializeFirebaseListener() {
        try {
            // Listen untuk perubahan real-time di path /units
            this.firebaseListener = database.ref('/units').on('value', (snapshot) => {
                this.handleRealTimeUpdate(snapshot.val());
            }, (error) => {
                console.error('Firebase listener error:', error);
                this.showError('Koneksi real-time terputus');
            });
            
            console.log('✅ Firebase real-time listener aktif');
        } catch (error) {
            console.error('Error initializing Firebase listener:', error);
        }
    }

    // NEW: Handle real-time updates dari Firebase
    handleRealTimeUpdate(firebaseData) {
        if (!firebaseData) {
            console.log('📭 Tidak ada data real-time dari Firebase');
            return;
        }

        console.log('🔄 Update real-time dari Firebase:', Object.keys(firebaseData).length + ' units');
        
        let updatedCount = 0;
        
        // Process each unit from Firebase
        Object.entries(firebaseData).forEach(([unitName, unitData]) => {
            const existingUnitIndex = this.units.findIndex(u => u.name === unitName);
            
            if (existingUnitIndex !== -1) {
                // Update existing unit
                this.updateUnitFromFirebase(this.units[existingUnitIndex], unitData);
                updatedCount++;
            } else {
                // Add new unit from Firebase
                const newUnit = this.createUnitFromFirebase(unitName, unitData);
                this.units.push(newUnit);
                updatedCount++;
            }
        });

        if (updatedCount > 0) {
            this.updateStatistics();
            this.renderUnitList();
            this.updateMapMarkers();
            this.addLog(`Data real-time diperbarui: ${updatedCount} unit`, 'success');
        }
    }

    // NEW: Create unit object from Firebase data
    createUnitFromFirebase(unitName, firebaseData) {
        return {
            id: this.generateUnitId(unitName),
            name: unitName,
            afdeling: this.getAfdelingFromUnit(unitName),
            status: this.getStatusFromJourneyStatus(firebaseData.journeyStatus),
            latitude: firebaseData.lat || this.getRandomLatitude(),
            longitude: firebaseData.lng || this.getRandomLongitude(),
            speed: firebaseData.speed || 0,
            lastUpdate: firebaseData.lastUpdate || new Date().toLocaleTimeString('id-ID'),
            distance: firebaseData.distance || 0,
            fuelLevel: this.calculateFuelLevel(firebaseData.distance),
            fuelUsed: firebaseData.distance ? firebaseData.distance / this.vehicleConfig.fuelEfficiency : 0,
            engineHours: 1000 + Math.floor(Math.random() * 1000),
            totalRuntime: this.formatRuntime(1000 + Math.floor(Math.random() * 1000)),
            block: this.getRandomBlock(),
            driver: firebaseData.driver || 'Unknown',
            accuracy: firebaseData.accuracy || 0,
            batteryLevel: firebaseData.batteryLevel || null,
            // NEW: Track position for distance calculation
            lastLat: firebaseData.lat,
            lastLng: firebaseData.lng
        };
    }

    // NEW: Update existing unit with Firebase data
    updateUnitFromFirebase(unit, firebaseData) {
        // Calculate distance if position changed
        if (unit.lastLat && unit.lastLng && firebaseData.lat && firebaseData.lng) {
            const distance = this.calculateDistance(
                unit.lastLat, unit.lastLng, 
                firebaseData.lat, firebaseData.lng
            );
            
            if (distance < 0.1) { // Filter GPS jumps
                unit.distance += distance;
                unit.fuelUsed += distance / this.vehicleConfig.fuelEfficiency;
            }
        }

        // Update unit data
        unit.latitude = firebaseData.lat || unit.latitude;
        unit.longitude = firebaseData.lng || unit.longitude;
        unit.speed = firebaseData.speed || unit.speed;
        unit.status = this.getStatusFromJourneyStatus(firebaseData.journeyStatus) || unit.status;
        unit.lastUpdate = firebaseData.lastUpdate || unit.lastUpdate;
        unit.driver = firebaseData.driver || unit.driver;
        unit.accuracy = firebaseData.accuracy || unit.accuracy;
        unit.batteryLevel = firebaseData.batteryLevel || unit.batteryLevel;
        
        // Update fuel level based on distance
        unit.fuelLevel = this.calculateFuelLevel(unit.distance);
        
        // Store current position for next distance calculation
        unit.lastLat = firebaseData.lat;
        unit.lastLng = firebaseData.lng;
    }

    // NEW: Generate consistent ID from unit name
    generateUnitId(unitName) {
        const unitIdMap = {
            'DT-06': 1, 'DT-07': 2, 'DT-12': 3, 'DT-13': 4, 'DT-15': 5, 'DT-16': 6,
            'DT-17': 7, 'DT-18': 8, 'DT-23': 9, 'DT-24': 10, 'DT-25': 11, 'DT-26': 12,
            'DT-27': 13, 'DT-28': 14, 'DT-29': 15, 'DT-32': 16, 'DT-33': 17, 'DT-34': 18,
            'DT-35': 19, 'DT-36': 20, 'DT-37': 21, 'DT-38': 22, 'DT-39': 23
        };
        return unitIdMap[unitName] || Date.now();
    }

    initializeHistoryStorage() {
        try {
            const savedHistory = localStorage.getItem('sagm_unit_history');
            if (savedHistory) {
                this.unitHistory = JSON.parse(savedHistory);
            }
        } catch (error) {
            console.error('Error loading history:', error);
            this.unitHistory = {};
        }
    }

    saveHistoryToStorage() {
        try {
            localStorage.setItem('sagm_unit_history', JSON.stringify(this.unitHistory));
        } catch (error) {
            console.error('Error saving history:', error);
        }
    }

    initializeMap() {
        try {
            this.map = L.map('map').setView(this.config.center, this.config.zoom);

            // Multiple tile layers
            const googleSatellite = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
                attribution: '© Google Satellite',
                maxZoom: 22,
                subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
            });

            const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
                attribution: '© Google Hybrid',
                maxZoom: 22,
                subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
            });

            const openStreetMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap',
                maxZoom: 20
            });

            // Add default layer
            googleSatellite.addTo(this.map);

            // Layer control
            const baseMaps = {
                "🛰️ Google Satellite": googleSatellite,
                "🛰️ Google Hybrid": googleHybrid,
                "🗺️ OpenStreetMap": openStreetMap
            };

            L.control.layers(baseMaps).addTo(this.map);

            // Additional controls
            L.control.scale({ imperial: false }).addTo(this.map);
            L.control.zoom({ position: 'topright' }).addTo(this.map);

            this.addImportantLocations();

        } catch (error) {
            console.error('Error initializing map:', error);
            throw new Error('Gagal menginisialisasi peta');
        }
    }

    addImportantLocations() {
        try {
            // Clear existing markers
            this.importantMarkers.forEach(marker => {
                if (marker && this.map) {
                    this.map.removeLayer(marker);
                }
            });
            this.importantMarkers = [];

            // PKS Marker
            const pksIcon = L.divIcon({
                className: 'custom-marker',
                html: `<div class="marker-icon pks" title="PKS SAGM">🏭</div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });

            const pksMarker = L.marker([this.importantLocations.PKS_SAGM.lat, this.importantLocations.PKS_SAGM.lng], { icon: pksIcon })
                .bindPopup(this.createLocationPopup('PKS SAGM', 'pks'))
                .addTo(this.map);

            // Office Marker
            const officeIcon = L.divIcon({
                className: 'custom-marker',
                html: `<div class="marker-icon office" title="Kantor Kebun">🏢</div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });

            const officeMarker = L.marker([this.importantLocations.KANTOR_KEBUN.lat, this.importantLocations.KANTOR_KEBUN.lng], { icon: officeIcon })
                .bindPopup(this.createLocationPopup('Kantor Kebun PT SAGM', 'office'))
                .addTo(this.map);

            this.importantMarkers.push(pksMarker, officeMarker);

        } catch (error) {
            console.error('Error adding important locations:', error);
        }
    }

    createLocationPopup(name, type) {
        const pksInfo = `
            <div class="info-item">
                <span class="info-label">Kapasitas:</span>
                <span class="info-value">45 Ton TBS/Jam</span>
            </div>
        `;

        const officeInfo = `
            <div class="info-item">
                <span class="info-label">Jam Operasi:</span>
                <span class="info-value">07:00 - 16:00</span>
            </div>
        `;

        return `
            <div class="unit-popup">
                <div class="popup-header">
                    <h6 class="mb-0">${type === 'pks' ? '🏭' : '🏢'} ${name}</h6>
                </div>
                <div class="info-grid">
                    <div class="info-item">
                        <span class="info-label">Tipe:</span>
                        <span class="info-value">${type === 'pks' ? 'Pabrik Kelapa Sawit' : 'Kantor Operasional'}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Status:</span>
                        <span class="info-value">Operasional</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Lokasi:</span>
                        <span class="info-value">Kebun Tempuling</span>
                    </div>
                    ${type === 'pks' ? pksInfo : officeInfo}
                </div>
            </div>
        `;
    }

    setupEventListeners() {
        // Search functionality
        const searchInput = document.getElementById('searchUnit');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.filterUnits());
        }

        // Filter functionality
        const filters = ['filterAfdeling', 'filterStatus', 'filterFuel'];
        filters.forEach(filterId => {
            const filter = document.getElementById(filterId);
            if (filter) {
                filter.addEventListener('change', () => this.filterUnits());
            }
        });

        // NEW: Firebase connection status
        database.ref('.info/connected').on('value', (snapshot) => {
            this.updateFirebaseStatus(snapshot.val());
        });
    }

    // NEW: Update Firebase connection status
    updateFirebaseStatus(connected) {
        const statusElement = document.getElementById('firebaseStatus');
        if (statusElement) {
            if (connected) {
                statusElement.innerHTML = '🟢 TERHUBUNG KE FIREBASE';
                statusElement.className = 'text-success';
            } else {
                statusElement.innerHTML = '🔴 FIREBASE OFFLINE';
                statusElement.className = 'text-danger';
            }
        }
    }

    // ========== SISTEM AKUMULASI JARAK REAL-TIME ==========
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Radius bumi dalam km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c; // Jarak dalam km
    }

    startAutoRefresh() {
        // Auto refresh every 30 seconds untuk backup
        this.autoRefreshInterval = setInterval(() => {
            this.addLog('Auto-refresh data', 'info');
        }, 30000);
    }

    async loadUnitData() {
        try {
            this.showLoading(true);
            
            const data = await this.fetchUnitData();
            this.units = data;
            
            // Inisialisasi posisi awal untuk akumulasi
            this.units.forEach(unit => {
                unit.lastLat = unit.latitude;
                unit.lastLng = unit.longitude;
                unit.distance = unit.distance || 0;
                unit.fuelUsed = unit.fuelUsed || 0;
            });
            
            this.updateUnitHistory();
            this.updateStatistics();
            this.renderUnitList();
            this.updateMapMarkers();
            
            this.showLoading(false);
            this.showNotification('Sistem monitoring aktif - Menunggu data real-time', 'success');
            
        } catch (error) {
            console.error('Error loading unit data:', error);
            this.showLoading(false);
            this.showError('Gagal memuat data unit: ' + error.message);
        }
    }

    async fetchUnitData() {
        try {
            // NEW: Use Firebase SDK instead of fetch
            const snapshot = await database.ref('/units').once('value');
            const firebaseData = snapshot.val();
            
            // JIKA ADA DATA REAL DARI FIREBASE
            if (firebaseData && Object.keys(firebaseData).length > 0) {
                console.log('✅ Data real ditemukan di Firebase:', Object.keys(firebaseData).length + ' units');
                
                const realUnits = [];
                
                for (const [unitName, unitData] of Object.entries(firebaseData)) {
                    realUnits.push(this.createUnitFromFirebase(unitName, unitData));
                }
                
                return realUnits;
            }
            
            // JIKA TIDAK ADA DATA FIREBASE, PAKAI DATA SIMULASI
            console.log('⚠️ Tidak ada data Firebase, menggunakan data simulasi');
            return this.getSimulatedData();
            
        } catch (error) {
            console.error('Error mengambil data Firebase:', error);
            return this.getSimulatedData();
        }
    }

    // ===== FUNGSI PENDUKUNG =====
    getAfdelingFromUnit(unitName) {
        const afdelingMap = {
            'DT-06': 'AFD I', 'DT-07': 'AFD I', 'DT-12': 'AFD II', 'DT-13': 'AFD II',
            'DT-15': 'AFD III', 'DT-16': 'AFD III', 'DT-17': 'AFD IV', 'DT-18': 'AFD IV',
            'DT-23': 'AFD V', 'DT-24': 'AFD V', 'DT-25': 'KKPA', 'DT-26': 'KKPA',
            'DT-27': 'KKPA', 'DT-28': 'AFD II', 'DT-29': 'AFD III', 'DT-32': 'AFD I',
            'DT-33': 'AFD IV', 'DT-34': 'AFD V', 'DT-35': 'KKPA', 'DT-36': 'AFD II',
            'DT-37': 'AFD III', 'DT-38': 'AFD I', 'DT-39': 'AFD IV'
        };
        return afdelingMap[unitName] || 'AFD I';
    }

    getStatusFromJourneyStatus(journeyStatus) {
        const statusMap = {
            'started': 'moving',
            'moving': 'moving', 
            'active': 'active',
            'paused': 'active',
            'ended': 'inactive',
            'ready': 'inactive'
        };
        return statusMap[journeyStatus] || 'active';
    }

    getRandomLatitude() {
        return -0.396 + (Math.random() - 0.5) * 0.03;
    }

    getRandomLongitude() {
        return 102.959 + (Math.random() - 0.5) * 0.03;
    }

    calculateFuelLevel(distance) {
        const baseFuel = 80;
        const fuelUsed = distance ? distance / this.vehicleConfig.fuelEfficiency : 0;
        return Math.max(10, baseFuel - (fuelUsed / this.vehicleConfig.fuelTankCapacity * 100));
    }

    getRandomBlock() {
        const blocks = ['V73', 'T46', 'U52', 'T38', 'U59', 'X83', 'V68', 'T51', 'U51', 'Q37', 'U47', 'U44', 'V70'];
        return blocks[Math.floor(Math.random() * blocks.length)];
    }

    formatRuntime(hours) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return `${days} hari ${remainingHours} jam`;
    }

    getSimulatedData() {
        return new Promise(resolve => {
            setTimeout(() => {
                const unitData = [
                    // ... data simulasi Anda yang asli (tetap sama)
                    { id: 1, name: "CANTER PS125-001", afdeling: "AFD I", status: "active", latitude: -0.371, longitude: 102.948, speed: 45, lastUpdate: new Date().toLocaleTimeString('id-ID'), distance: 0, fuelLevel: 85, fuelUsed: 0, engineHours: 1250, totalRuntime: "52 hari 4 jam", block: "V73", driver: "Driver Simulasi" },
                    { id: 2, name: "CANTER PS125-002", afdeling: "AFD II", status: "moving", latitude: -0.368, longitude: 102.955, speed: 60, lastUpdate: new Date().toLocaleTimeString('id-ID'), distance: 0, fuelLevel: 45, fuelUsed: 0, engineHours: 980, totalRuntime: "40 hari 20 jam", block: "T46", driver: "Driver Simulasi" },
                    // ... lanjutkan dengan data simulasi lainnya
                ];
                resolve(unitData);
            }, 1000);
        });
    }

    // NEW: Enhanced unit popup dengan info dari Firebase
    createUnitPopup(unit) {
        return `
            <div class="unit-popup">
                <div class="popup-header">
                    <h6 class="mb-0">🚛 ${unit.name}</h6>
                </div>
                <div class="info-grid">
                    <div class="info-item">
                        <span class="info-label">Driver:</span>
                        <span class="info-value">${unit.driver || 'Tidak diketahui'}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Afdeling:</span>
                        <span class="info-value">${unit.afdeling}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Status:</span>
                        <span class="info-value ${unit.status === 'moving' ? 'text-warning' : unit.status === 'active' ? 'text-success' : 'text-danger'}">
                            ${unit.status === 'moving' ? 'Dalam Perjalanan' : unit.status === 'active' ? 'Aktif' : 'Non-Aktif'}
                        </span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Kecepatan:</span>
                        <span class="info-value">${unit.speed} km/h</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Jarak Tempuh:</span>
                        <span class="info-value">${unit.distance.toFixed(2)} km</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Bahan Bakar:</span>
                        <span class="info-value">${unit.fuelLevel}%</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Akurasi GPS:</span>
                        <span class="info-value">${unit.accuracy ? unit.accuracy.toFixed(1) + ' m' : 'Tidak diketahui'}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Baterai:</span>
                        <span class="info-value">${unit.batteryLevel ? unit.batteryLevel + '%' : 'Tidak diketahui'}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Update Terakhir:</span>
                        <span class="info-value">${unit.lastUpdate}</span>
                    </div>
                </div>
            </div>
        `;
    }

    // NEW: Add log system
    addLog(message, type = 'info') {
        console.log(`[${type.toUpperCase()}] ${message}`);
        // Bisa ditambahkan UI log system jika diperlukan
    }

    // NEW: Show notification
    showNotification(message, type = 'info') {
        // Implementation untuk show notification
        console.log(`[NOTIFICATION ${type}] ${message}`);
    }

    // NEW: Show error
    showError(message) {
        console.error(`[ERROR] ${message}`);
        this.showNotification(message, 'error');
    }

    // NEW: Show loading
    showLoading(show) {
        // Implementation untuk show/hide loading spinner
        const spinner = document.getElementById('loadingSpinner');
        if (spinner) {
            spinner.style.display = show ? 'block' : 'none';
        }
    }

    // Method yang sudah ada (tetap diperlukan)
    updateStatistics() {
        const activeUnits = this.units.filter(unit => unit.status === 'active' || unit.status === 'moving').length;
        const totalDistance = this.units.reduce((sum, unit) => sum + unit.distance, 0);
        const totalSpeed = this.units.reduce((sum, unit) => sum + unit.speed, 0);
        const avgSpeed = this.units.length > 0 ? totalSpeed / this.units.length : 0;
        const totalFuel = this.units.reduce((sum, unit) => sum + unit.fuelUsed, 0);

        this.activeUnits = activeUnits;
        this.totalDistance = totalDistance;
        this.avgSpeed = avgSpeed;
        this.totalFuelConsumption = totalFuel;

        // Update UI elements
        if (document.getElementById('activeUnits')) {
            document.getElementById('activeUnits').textContent = `${activeUnits}/23`;
        }
        if (document.getElementById('totalDistance')) {
            document.getElementById('totalDistance').textContent = `${totalDistance.toFixed(1)} km`;
        }
        if (document.getElementById('avgSpeed')) {
            document.getElementById('avgSpeed').textContent = `${avgSpeed.toFixed(1)} km/h`;
        }
        if (document.getElementById('totalFuel')) {
            document.getElementById('totalFuel').textContent = `${totalFuel.toFixed(1)} L`;
        }
    }

    renderUnitList() {
        const unitList = document.getElementById('unitList');
        if (!unitList) return;

        unitList.innerHTML = '';

        this.units.forEach(unit => {
            const unitElement = document.createElement('div');
            unitElement.className = `unit-item ${unit.status}`;
            unitElement.innerHTML = `
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <h6 class="mb-1">${unit.name}</h6>
                        <small class="text-muted">${unit.afdeling} - ${unit.driver || 'No Driver'}</small>
                    </div>
                    <span class="badge ${unit.status === 'active' ? 'bg-success' : unit.status === 'moving' ? 'bg-warning' : 'bg-danger'}">
                        ${unit.status === 'active' ? 'Aktif' : unit.status === 'moving' ? 'Berjalan' : 'Non-Aktif'}
                    </span>
                </div>
                <div class="mt-2">
                    <small class="text-muted">
                        Block: <strong>${unit.block}</strong><br>
                        Kecepatan: ${unit.speed} km/h<br>
                        Jarak: ${unit.distance.toFixed(2)} km<br>
                        Bahan Bakar: ${unit.fuelLevel}%<br>
                        Update: ${unit.lastUpdate}
                    </small>
                </div>
            `;
            unitList.appendChild(unitElement);
        });
    }

    updateMapMarkers() {
        // Clear existing markers
        Object.values(this.markers).forEach(marker => {
            if (marker && this.map) {
                this.map.removeLayer(marker);
            }
        });
        this.markers = {};

        // Add new markers
        this.units.forEach(unit => {
            const markerIcon = L.divIcon({
                className: 'custom-marker',
                html: `<div class="marker-icon ${unit.status}" title="${unit.name}">🚛</div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });

            const marker = L.marker([unit.latitude, unit.longitude], { icon: markerIcon })
                .bindPopup(this.createUnitPopup(unit))
                .addTo(this.map);
            
            this.markers[unit.id] = marker;
        });
    }

    filterUnits() {
        // Implementation untuk filter units
        const searchTerm = document.getElementById('searchUnit')?.value.toLowerCase() || '';
        const afdelingFilter = document.getElementById('filterAfdeling')?.value || '';
        const statusFilter = document.getElementById('filterStatus')?.value || '';
        const fuelFilter = document.getElementById('filterFuel')?.value || '';

        // Filter logic here
        console.log('Filtering units...', { searchTerm, afdelingFilter, statusFilter, fuelFilter });
    }

    updateUnitHistory() {
        // Implementation untuk update unit history
        this.units.forEach(unit => {
            if (!this.unitHistory[unit.name]) {
                this.unitHistory[unit.name] = [];
            }
            this.unitHistory[unit.name].push({
                timestamp: new Date().toISOString(),
                latitude: unit.latitude,
                longitude: unit.longitude,
                speed: unit.speed,
                distance: unit.distance
            });
        });
        this.saveHistoryToStorage();
    }

    // Cleanup method
    destroy() {
        if (this.firebaseListener) {
            database.ref('/units').off('value', this.firebaseListener);
        }
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
        }
    }
}

// Initialize system
let gpsSystem;

document.addEventListener('DOMContentLoaded', function() {
    gpsSystem = new SAGMGpsTracking();
});

// Global functions
function refreshData() {
    if (gpsSystem) {
        gpsSystem.loadUnitData();
    }
}

function exportData() {
    if (gpsSystem) {
        // Implementation untuk export data
        console.log('Exporting data...');
        gpsSystem.showNotification('Fitur export akan datang!', 'info');
    }
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    sidebar.classList.toggle('show');
}

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (gpsSystem) {
        gpsSystem.destroy();
    }
});