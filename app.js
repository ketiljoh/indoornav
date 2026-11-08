// IndoorNav App - Main Controller
(function () {
    const sensors = new SensorManager();
    const navigator = new IndoorNavigator();
    const canvas = document.getElementById('map-canvas');
    const renderer = new MapRenderer(canvas);

    // UI Elements
    const btnStart = document.getElementById('btn-start');
    const btnReset = document.getElementById('btn-reset');
    const btnSetFloor = document.getElementById('btn-set-floor');
    const btnCalibrate = document.getElementById('btn-calibrate');
    const stepCountEl = document.getElementById('step-count');
    const headingEl = document.getElementById('heading-display');
    const accuracyEl = document.getElementById('accuracy-indicator');
    const floorPanel = document.getElementById('floor-panel');
    const calibrationPanel = document.getElementById('calibration-panel');
    const infoPanel = document.getElementById('info-panel');
    const sensorDebug = document.getElementById('sensor-debug');
    const strideSlider = document.getElementById('stride-slider');
    const strideValue = document.getElementById('stride-value');

    let isTracking = false;
    let animFrameId = null;
    let currentView = 'map';

    // Initialize floor buttons
    function initFloorButtons() {
        const container = document.getElementById('floor-buttons');
        for (let i = -1; i <= 5; i++) {
            const btn = document.createElement('button');
            btn.textContent = i === -1 ? 'K' : `${i}`;
            btn.dataset.floor = i;
            if (i === 0) btn.classList.add('active');
            btn.addEventListener('click', () => {
                container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                navigator.setFloor(i);
            });
            container.appendChild(btn);
        }
    }

    // Start/stop tracking
    async function toggleTracking() {
        if (!isTracking) {
            if (!sensors.hasPermission) {
                const granted = await sensors.requestPermission();
                if (!granted) {
                    alert('Sensorene krever tillatelse. Vennligst tillat tilgang til bevegelsessensorer.');
                    return;
                }
            }

            sensors.start();
            isTracking = true;
            btnStart.textContent = 'Stopp';
            btnStart.classList.add('active');
            accuracyEl.textContent = 'Aktiv';
            accuracyEl.style.color = '#30D158';

            startRenderLoop();
        } else {
            sensors.stop();
            isTracking = false;
            btnStart.textContent = 'Start navigasjon';
            btnStart.classList.remove('active');
            accuracyEl.textContent = 'Stoppet';
            accuracyEl.style.color = '#FF9F0A';

            if (animFrameId) {
                cancelAnimationFrame(animFrameId);
                animFrameId = null;
            }
        }
    }

    // Render loop
    function startRenderLoop() {
        function frame() {
            renderer.render(
                navigator.position,
                navigator.path,
                sensors.heading,
                navigator.floor
            );

            // Update UI
            stepCountEl.textContent = `${sensors.stepCount} skritt`;
            headingEl.textContent = `${Math.round(sensors.heading)}°`;

            // Update sensor debug panel if visible
            if (currentView === 'info') {
                updateSensorDebug();
            }

            animFrameId = requestAnimationFrame(frame);
        }
        frame();
    }

    function updateSensorDebug() {
        const data = sensors.getSensorData();
        const dist = navigator.getDistanceTraveled();

        sensorDebug.innerHTML = `
            <div><span class="label">Akselerasjon X:</span> <span class="value">${data.acceleration.x.toFixed(3)}</span> m/s²</div>
            <div><span class="label">Akselerasjon Y:</span> <span class="value">${data.acceleration.y.toFixed(3)}</span> m/s²</div>
            <div><span class="label">Akselerasjon Z:</span> <span class="value">${data.acceleration.z.toFixed(3)}</span> m/s²</div>
            <hr style="border-color:#333;margin:8px 0">
            <div><span class="label">Rotasjon Alpha:</span> <span class="value">${data.rotationRate.alpha.toFixed(2)}</span> °/s</div>
            <div><span class="label">Rotasjon Beta:</span> <span class="value">${data.rotationRate.beta.toFixed(2)}</span> °/s</div>
            <div><span class="label">Rotasjon Gamma:</span> <span class="value">${data.rotationRate.gamma.toFixed(2)}</span> °/s</div>
            <hr style="border-color:#333;margin:8px 0">
            <div><span class="label">Kompassretning:</span> <span class="value">${data.heading.toFixed(1)}°</span></div>
            <div><span class="label">Orientering Alpha:</span> <span class="value">${data.orientation.alpha.toFixed(1)}°</span></div>
            <div><span class="label">Orientering Beta:</span> <span class="value">${data.orientation.beta.toFixed(1)}°</span></div>
            <div><span class="label">Orientering Gamma:</span> <span class="value">${data.orientation.gamma.toFixed(1)}°</span></div>
            <hr style="border-color:#333;margin:8px 0">
            <div><span class="label">Skritt:</span> <span class="value">${data.stepCount}</span></div>
            <div><span class="label">Skrittlengde:</span> <span class="value">${sensors.strideLength.toFixed(2)} m</span></div>
            <div><span class="label">Distanse:</span> <span class="value">${dist.toFixed(1)} m</span></div>
            <div><span class="label">Posisjon:</span> <span class="value">X: ${navigator.position.x.toFixed(2)}, Y: ${navigator.position.y.toFixed(2)}</span></div>
            <div><span class="label">Etasje:</span> <span class="value">${navigator.floor}</span></div>
        `;
    }

    // Step callback
    sensors.onStep = function (count, heading) {
        navigator.addStep(heading);
    };

    // Event listeners
    btnStart.addEventListener('click', toggleTracking);

    btnReset.addEventListener('click', () => {
        sensors.reset();
        navigator.reset();
        renderer.centerOnPosition();
        stepCountEl.textContent = '0 skritt';
    });

    btnSetFloor.addEventListener('click', () => {
        floorPanel.classList.toggle('hidden');
        calibrationPanel.classList.add('hidden');
    });

    document.getElementById('btn-close-floor').addEventListener('click', () => {
        floorPanel.classList.add('hidden');
    });

    btnCalibrate.addEventListener('click', () => {
        calibrationPanel.classList.toggle('hidden');
        floorPanel.classList.add('hidden');
    });

    document.getElementById('btn-close-calibration').addEventListener('click', () => {
        calibrationPanel.classList.add('hidden');
    });

    document.getElementById('btn-do-calibrate').addEventListener('click', async () => {
        const btn = document.getElementById('btn-do-calibrate');
        btn.textContent = 'Kalibrerer...';
        btn.disabled = true;
        await sensors.calibrate();
        btn.textContent = 'Ferdig!';
        setTimeout(() => {
            btn.textContent = 'Kalibrer sensorer';
            btn.disabled = false;
        }, 1000);
    });

    strideSlider.addEventListener('input', () => {
        const val = parseFloat(strideSlider.value);
        strideValue.textContent = `${val.toFixed(2)} m`;
        sensors.strideLength = val;
        navigator.strideLength = val;
    });

    // Bottom navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentView = btn.dataset.view;

            if (currentView === 'info') {
                infoPanel.classList.remove('hidden');
            } else {
                infoPanel.classList.add('hidden');
            }
        });
    });

    // Zoom buttons
    document.getElementById('zoom-in').addEventListener('click', () => renderer.zoomIn());
    document.getElementById('zoom-out').addEventListener('click', () => renderer.zoomOut());

    // Double-tap to re-center
    let lastTapTime = 0;
    canvas.addEventListener('touchend', (e) => {
        const now = Date.now();
        if (now - lastTapTime < 300 && e.changedTouches.length === 1) {
            renderer.centerOnPosition();
        }
        lastTapTime = now;
    });

    // Init
    initFloorButtons();

    // Initial render
    renderer.render(navigator.position, navigator.path, 0, 0);
})();
