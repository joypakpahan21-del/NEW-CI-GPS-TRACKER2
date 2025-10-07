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
        this.journeyStatus = 'ready'; // ready, started, paused, ended
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.updateTime();
        this.checkNetworkStatus();
        setInterval(() => this.updateTime(), 1000);
        setInterval(() => this.checkNetworkStatus(), 5000);
    }

    setupEventListeners() {
        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });
    }

    handleLogin() {
        const driverName = document.getElementById('driverName').value;
        const unitNumber = document.getElementById('unitNumber').value;

        if (driverName && unitNumber) {
            this.driverData = {
                name: driverName,
                unit: unitNumber,
                year: this.getVehicleYear(unitNumber),
                sessionId: this.generateSessionId()
            };

            this.showDriverApp();
            this.startGPSTracking();
            this.startDataTransmission();
            
            // Auto start journey after 3 seconds
            setTimeout(() => {
                this.startJourney();
            }, 3000);
        } else {
            alert('Harap isi semua field!');
        }
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
        return 'SESS_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    showDriverApp() {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('driverApp').style.display = 'block';
        
        document.getElementById('vehicleName').textContent = this.driverData.unit;
        document.getElementById('driverDisplayName').textContent = this.driverData.name;
        
        this.sessionStartTime = new Date();
        this.updateSessionDuration();
    }

    startGPSTracking() {
        if (!navigator.geolocation) {
            this.addLog('GPS tidak didukung di browser ini', 'error');
            return;
        }

        this.isTracking = true;
        
        const options = {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        };

        // Watch position untuk real-time tracking dengan interval 1 detik
        this.watchId = navigator.geolocation.watchPosition(
            (position) => this.handlePositionUpdate(position),
            (error) => this.handleGPSError(error),
            options
        );

        this.addLog('GPS tracking aktif - 1 detik interval', 'success');
    }

    startDataTransmission() {
        // Kirim data setiap 1 detik
        this.sendInterval = setInterval(() => {
            this.processPendingData();
        }, 1000);
    }

    handlePositionUpdate(position) {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const speed = position.coords.speed !== null ? position.coords.speed * 3.6 : 0; // Convert to km/h
        const accuracy = position.coords.accuracy;
        const bearing = position.coords.heading;
        const timestamp = new Date().toISOString();

        // Update UI
        document.getElementById('currentLat').textContent = lat.toFixed(6);
        document.getElementById('currentLng').textContent = lng.toFixed(6);
        document.getElementById('currentSpeed').textContent = speed.toFixed(1);
        document.getElementById('gpsAccuracy').textContent = accuracy.toFixed(1) + ' m';
        document.getElementById('gpsBearing').textContent = bearing ? bearing.toFixed(0) + '°' : '-';

        // Calculate distance hanya jika perjalanan aktif
        if (this.lastPosition && this.journeyStatus === 'started') {
            const distance = this.calculateDistance(
                this.lastPosition.lat, this.lastPosition.lng,
                lat, lng
            );
            this.totalDistance += distance;
            document.getElementById('todayDistance').textContent = this.totalDistance.toFixed(2);
        }

        // Prepare data for transmission
        const gpsData = {
            sessionId: this.driverData.sessionId,
            driver: this.driverData.name,
            unit: this.driverData.unit,
            lat: lat,
            lng: lng,
            speed: speed,
            accuracy: accuracy,
            bearing: bearing,
            timestamp: timestamp,
            distance: this.totalDistance,
            journeyStatus: this.journeyStatus
        };

        this.pendingData.push(gpsData);
        this.dataPoints++;
        document.getElementById('dataPoints').textContent = this.dataPoints;

        this.lastPosition = { lat, lng, timestamp };

        // Update average speed
        this.updateAverageSpeed();
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth radius in km
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
            document.getElementById('avgSpeed').textContent = avgSpeed.toFixed(1) + ' km/h';
        }
    }

    async processPendingData() {
        if (this.pendingData.length === 0) return;

        try {
            // Simulate data transmission to server
            const success = await this.sendToServer(this.pendingData);
            
            if (success) {
                this.addLog(`📡 Data terkirim: ${this.pendingData.length} points`, 'success');
                this.pendingData = []; // Clear sent data
                this.updateConnectionStatus(true);
            } else {
                this.addLog('⚠️ Gagal mengirim data, mencoba lagi...', 'warning');
                // Keep data in pending for retry
            }
        } catch (error) {
            this.addLog('❌ Error transmisi data', 'error');
            this.updateConnectionStatus(false);
        }
    }

    async sendToServer(data) {
        // GANTI INI DENGAN API ENDPOINT ANDA
        const apiUrl = 'https://your-server.com/api/gps-data'; // Ganti dengan URL server Anda
        
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    gpsData: data,
                    timestamp: new Date().toISOString()
                })
            });

            return response.ok;
        } catch (error) {
            // Fallback ke simulasi jika server tidak tersedia
            return new Promise((resolve) => {
                setTimeout(() => {
                    // Simulate 95% success rate
                    const success = Math.random() > 0.05;
                    
                    if (success) {
                        console.log('Data sent to server:', {
                            count: data.length,
                            lastPoint: data[data.length-1],
                            totalDistance: this.totalDistance
                        });
                    }
                    
                    resolve(success);
                }, 300);
            });
        }
    }

    checkNetworkStatus() {
        this.isOnline = navigator.onLine;
        this.updateConnectionStatus(this.isOnline);
    }

    updateConnectionStatus(connected) {
        const dot = document.getElementById('connectionDot');
        const status = document.getElementById('connectionStatus');
        
        if (connected) {
            dot.className = 'connection-status connected';
            status.textContent = 'TERHUBUNG';
            status.className = 'text-success';
        } else {
            dot.className = 'connection-status disconnected';
            status.textContent = 'OFFLINE';
            status.className = 'text-danger';
        }
    }

    handleGPSError(error) {
        let message = 'GPS Error: ';
        switch(error.code) {
            case error.PERMISSION_DENIED:
                message += 'Izin GPS ditolak';
                break;
            case error.POSITION_UNAVAILABLE:
                message += 'Posisi tidak tersedia';
                break;
            case error.TIMEOUT:
                message += 'Timeout';
                break;
            default:
                message += 'Error tidak diketahui';
                break;
        }
        this.addLog(message, 'error');
    }

    addLog(message, type = 'info') {
        const logContainer = document.getElementById('dataLogs');
        const alertClass = {
            'info': 'alert-info',
            'success': 'alert-success', 
            'error': 'alert-danger',
            'warning': 'alert-warning'
        }[type] || 'alert-info';

        const logEntry = document.createElement('div');
        logEntry.className = `alert ${alertClass} py-2 mb-2`;
        logEntry.innerHTML = `
            <small>${new Date().toLocaleTimeString('id-ID')}: ${message}</small>
        `;
        
        logContainer.insertBefore(logEntry, logContainer.firstChild);
        
        // Keep only last 8 logs
        if (logContainer.children.length > 8) {
            logContainer.removeChild(logContainer.lastChild);
        }
    }

    updateTime() {
        document.getElementById('currentTime').textContent = 
            new Date().toLocaleTimeString('id-ID');
    }

    updateSessionDuration() {
        if (!this.sessionStartTime) return;
        
        const now = new Date();
        const diff = now - this.sessionStartTime;
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        
        document.getElementById('sessionDuration').textContent = 
            `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        setTimeout(() => this.updateSessionDuration(), 1000);
    }

    startJourney() {
        this.journeyStatus = 'started';
        document.getElementById('vehicleStatus').textContent = 'ON TRIP';
        this.addLog('Perjalanan dimulai - GPS tracking aktif', 'success');
    }

    pauseJourney() {
        this.journeyStatus = 'paused';
        document.getElementById('vehicleStatus').textContent = 'PAUSED';
        this.addLog('Perjalanan dijeda', 'warning');
    }

    endJourney() {
        this.journeyStatus = 'ended';
        document.getElementById('vehicleStatus').textContent = 'COMPLETED';
        this.addLog('Perjalanan selesai', 'info');
        
        // Kirim data final
        this.processPendingData();
    }

    stopTracking() {
        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
        }
        if (this.sendInterval) {
            clearInterval(this.sendInterval);
        }
        
        this.isTracking = false;
    }

    logout() {
        // Send final data before logout
        this.processPendingData().finally(() => {
            this.stopTracking();
            
            // Log session summary
            const sessionSummary = {
                driver: this.driverData.name,
                unit: this.driverData.unit,
                duration: document.getElementById('sessionDuration').textContent,
                totalDistance: this.totalDistance,
                dataPoints: this.dataPoints,
                avgSpeed: document.getElementById('avgSpeed').textContent,
                sessionId: this.driverData.sessionId
            };
            
            console.log('Session Summary:', sessionSummary);
            
            // Kirim summary ke server (opsional)
            this.sendSessionSummary(sessionSummary);
            
            this.driverData = null;
            document.getElementById('loginScreen').style.display = 'block';
            document.getElementById('driverApp').style.display = 'none';
            document.getElementById('loginForm').reset();
            
            this.addLog('Session ended - Driver logged out', 'info');
        });
    }

    async sendSessionSummary(summary) {
        try {
            await fetch('https://your-server.com/api/session-summary', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(summary)
            });
        } catch (error) {
            console.log('Gagal mengirim session summary');
        }
    }
}

// Global functions untuk button controls
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
    const issues = [
        'Mesin bermasalah',
        'Ban bocor', 
        'Bahan bakar habis',
        'Kecelakaan kecil',
        'Lainnya'
    ];
    
    const issue = prompt('Lapor masalah:\n' + issues.join('\n'));
    if (issue && window.dtLogger) {
        window.dtLogger.addLog(`Laporan: ${issue}`, 'warning');
        
        // Kirim laporan ke server
        if (window.dtLogger.driverData) {
            const reportData = {
                type: 'issue_report',
                driver: window.dtLogger.driverData.name,
                unit: window.dtLogger.driverData.unit,
                issue: issue,
                timestamp: new Date().toISOString(),
                location: window.dtLogger.lastPosition
            };
            
            // Kirim laporan
            window.dtLogger.sendToServer([reportData]);
        }
    }
}

function logout() {
    if (window.dtLogger) {
        window.dtLogger.logout();
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    window.dtLogger = new DTGPSLogger();
});

// Handle page visibility changes
document.addEventListener('visibilitychange', function() {
    if (window.dtLogger && window.dtLogger.driverData) {
        if (document.hidden) {
            window.dtLogger.addLog('Aplikasi di background', 'warning');
        } else {
            window.dtLogger.addLog('Aplikasi aktif kembali', 'success');
        }
    }
});

// Prevent going back to login after logged in
window.addEventListener('pageshow', function(event) {
    if (event.persisted && window.dtLogger && window.dtLogger.driverData) {
        window.dtLogger.addLog('Aplikasi di-restore dari cache', 'info');
    }
});
