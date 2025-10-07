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
            this.initializeFirebaseListener();
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
        
        Object.entries(firebaseData).forEach(([unitName, unitData]) => {
            const existingUnitIndex = this.units.findIndex(u => u.name === unitName);
            
            if (existingUnitIndex !== -1) {
                this.updateUnitFromFirebase(this.units[existingUnitIndex], unitData);
                updatedCount++;
            } else {
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
            lastLat: firebaseData.lat,
            lastLng: firebaseData.lng
        };
    }

    // NEW: Update existing unit with Firebase data
    updateUnitFromFirebase(unit, firebaseData) {
        if (unit.lastLat && unit.lastLng && firebaseData.lat && firebaseData.lng) {
            const distance = this.calculateDistance(
                unit.lastLat, unit.lastLng, 
                firebaseData.lat, firebaseData.lng
            );
            
            if (distance < 0.1) {
                unit.distance += distance;
                unit.fuelUsed += distance / this.vehicleConfig.fuelEfficiency;
            }
        }

        unit.latitude = firebaseData.lat || unit.latitude;
        unit.longitude = firebaseData.lng || unit.longitude;
        unit.speed = firebaseData.speed || unit.speed;
        unit.status = this.getStatusFromJourneyStatus(firebaseData.journeyStatus) || unit.status;
        unit.lastUpdate = firebaseData.lastUpdate || unit.lastUpdate;
        unit.driver = firebaseData.driver || unit.driver;
        unit.accuracy = firebaseData.accuracy || unit.accuracy;
        unit.batteryLevel = firebaseData.batteryLevel || unit.batteryLevel;
        
        unit.fuelLevel = this.calculateFuelLevel(unit.distance);
        
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

            const googleSatellite = L.tile
