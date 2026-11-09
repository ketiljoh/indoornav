class SensorManager {
    constructor() {
        this.isRunning = false;
        this.hasPermission = false;

        // Accelerometer data
        this.acceleration = { x: 0, y: 0, z: 0 };
        this.rotationRate = { alpha: 0, beta: 0, gamma: 0 };

        // Orientation (compass)
        this.heading = 0; // degrees from north
        this.orientation = { alpha: 0, beta: 0, gamma: 0 };

        // Step detection
        this.stepCount = 0;
        this.strideLength = 0.7; // meters
        this.onStep = null;

        // Step detection internals
        this._accelHistory = [];
        this._lastStepTime = 0;
        this._stepThreshold = 1.2;
        this._minStepInterval = 300; // ms

        // Time of the last devicemotion event (for the stalled-sensor watchdog)
        this.lastMotionTime = 0;

        // Calibration
        this._calibrationOffset = { x: 0, y: 0, z: 0 };
        this._isCalibrating = false;
        this._calibrationSamples = [];

        // Listeners
        this._onSensorUpdate = null;

        // Bind handlers once so the same references can be removed in stop()
        this._boundHandleMotion = this._handleMotion.bind(this);
        this._boundHandleOrientation = this._handleOrientation.bind(this);
    }

    async requestPermission() {
        // iOS 13+ requires explicit permission request
        if (typeof DeviceMotionEvent !== 'undefined' &&
            typeof DeviceMotionEvent.requestPermission === 'function') {
            try {
                const motionPerm = await DeviceMotionEvent.requestPermission();
                const orientPerm = await DeviceOrientationEvent.requestPermission();
                this.hasPermission = (motionPerm === 'granted' && orientPerm === 'granted');
            } catch (e) {
                console.error('Permission request failed:', e);
                this.hasPermission = false;
            }
        } else {
            // Non-iOS or older iOS - permissions not needed
            this.hasPermission = true;
        }
        return this.hasPermission;
    }

    start() {
        if (this.isRunning) return;

        window.addEventListener('devicemotion', this._boundHandleMotion, true);
        window.addEventListener('deviceorientation', this._boundHandleOrientation, true);
        this.lastMotionTime = Date.now(); // grace period before the watchdog warns

        // Use absolute orientation if available (webkitCompassHeading on iOS)
        if ('ondeviceorientationabsolute' in window) {
            window.addEventListener('deviceorientationabsolute', this._boundHandleOrientation, true);
        }

        this.isRunning = true;
    }

    stop() {
        if (!this.isRunning) return;

        window.removeEventListener('devicemotion', this._boundHandleMotion, true);
        window.removeEventListener('deviceorientation', this._boundHandleOrientation, true);
        window.removeEventListener('deviceorientationabsolute', this._boundHandleOrientation, true);

        this.isRunning = false;
    }

    reset() {
        this.stepCount = 0;
        this._accelHistory = [];
        this._lastStepTime = 0;
    }

    calibrate() {
        this._isCalibrating = true;
        this._calibrationSamples = [];

        return new Promise((resolve) => {
            setTimeout(() => {
                if (this._calibrationSamples.length > 0) {
                    const avg = this._calibrationSamples.reduce(
                        (acc, s) => ({
                            x: acc.x + s.x / this._calibrationSamples.length,
                            y: acc.y + s.y / this._calibrationSamples.length,
                            z: acc.z + s.z / this._calibrationSamples.length,
                        }),
                        { x: 0, y: 0, z: 0 }
                    );
                    this._calibrationOffset = avg;
                }
                this._isCalibrating = false;
                resolve(this._calibrationOffset);
            }, 2000);
        });
    }

    _handleMotion(event) {
        const accel = event.accelerationIncludingGravity;
        if (!accel) return;
        this.lastMotionTime = Date.now();

        this.acceleration = {
            x: accel.x - this._calibrationOffset.x,
            y: accel.y - this._calibrationOffset.y,
            z: accel.z - this._calibrationOffset.z,
        };

        if (event.rotationRate) {
            this.rotationRate = {
                alpha: event.rotationRate.alpha || 0,
                beta: event.rotationRate.beta || 0,
                gamma: event.rotationRate.gamma || 0,
            };
        }

        if (this._isCalibrating) {
            this._calibrationSamples.push({ x: accel.x, y: accel.y, z: accel.z });
        }

        this._detectStep();

        if (this._onSensorUpdate) {
            this._onSensorUpdate(this.getSensorData());
        }
    }

    _handleOrientation(event) {
        this.orientation = {
            alpha: event.alpha || 0,
            beta: event.beta || 0,
            gamma: event.gamma || 0,
        };

        // iOS provides webkitCompassHeading (degrees from magnetic north)
        if (event.webkitCompassHeading !== undefined) {
            this.heading = event.webkitCompassHeading;
        } else if (event.absolute && event.alpha !== null) {
            // Android/other: alpha is degrees from north when absolute
            this.heading = (360 - event.alpha) % 360;
        } else if (event.alpha !== null) {
            this.heading = (360 - event.alpha) % 360;
        }
    }

    _detectStep() {
        const mag = Math.sqrt(
            this.acceleration.x ** 2 +
            this.acceleration.y ** 2 +
            this.acceleration.z ** 2
        );

        const now = Date.now();
        this._accelHistory.push({ mag, time: now });

        // Keep last 50 samples
        if (this._accelHistory.length > 50) {
            this._accelHistory.shift();
        }

        if (this._accelHistory.length < 40) return;

        // Candidate peak is the middle sample of the last three
        const n = this._accelHistory.length;
        const prev = this._accelHistory[n - 3].mag;
        const curr = this._accelHistory[n - 2].mag;
        const next = mag;
        if (!(curr > prev && curr >= next)) return;

        // Compare the peak against the average over ~0.65 s (40 samples at
        // 60 Hz), roughly one step period, so the baseline is not dragged
        // up by the peak itself
        const recent = this._accelHistory.slice(-40);
        const avg = recent.reduce((s, v) => s + v.mag, 0) / recent.length;
        if (curr - avg < this._stepThreshold) return;

        // Only enforce a minimum interval (debounce). There must be no upper
        // limit: a pause longer than that would otherwise block step
        // detection permanently, since _lastStepTime would never update.
        if (now - this._lastStepTime < this._minStepInterval) return;

        this.stepCount++;
        this._lastStepTime = now;

        if (this.onStep) {
            this.onStep(this.stepCount, this.heading);
        }
    }

    getSensorData() {
        return {
            acceleration: { ...this.acceleration },
            rotationRate: { ...this.rotationRate },
            orientation: { ...this.orientation },
            heading: this.heading,
            stepCount: this.stepCount,
        };
    }

    set onSensorUpdate(callback) {
        this._onSensorUpdate = callback;
    }
}
