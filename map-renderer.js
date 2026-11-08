class MapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // View state
        this.scale = 40; // pixels per meter
        this.minScale = 5;
        this.maxScale = 200;
        this.offset = { x: 0, y: 0 }; // pan offset in pixels

        // Follow mode: camera follows user
        this.followMode = true;

        // Grid
        this.gridSize = 1; // meters
        this.showGrid = true;

        // Touch handling
        this._touches = {};
        this._lastPinchDist = 0;
        this._lastPanPos = null;
        this._isDragging = false;

        this._setupCanvas();
        this._setupTouchHandlers();

        // Auto-resize
        window.addEventListener('resize', () => this._setupCanvas());
    }

    _setupCanvas() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.width = rect.width;
        this.height = rect.height;
    }

    _setupTouchHandlers() {
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            for (const touch of e.changedTouches) {
                this._touches[touch.identifier] = { x: touch.clientX, y: touch.clientY };
            }
            if (Object.keys(this._touches).length === 1) {
                this._isDragging = true;
                this._lastPanPos = { ...Object.values(this._touches)[0] };
                this.followMode = false;
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            for (const touch of e.changedTouches) {
                this._touches[touch.identifier] = { x: touch.clientX, y: touch.clientY };
            }

            const touchList = Object.values(this._touches);

            if (touchList.length === 1 && this._isDragging && this._lastPanPos) {
                const dx = touchList[0].x - this._lastPanPos.x;
                const dy = touchList[0].y - this._lastPanPos.y;
                this.offset.x += dx;
                this.offset.y += dy;
                this._lastPanPos = { ...touchList[0] };
            } else if (touchList.length === 2) {
                const dist = Math.hypot(
                    touchList[0].x - touchList[1].x,
                    touchList[0].y - touchList[1].y
                );
                if (this._lastPinchDist > 0) {
                    const ratio = dist / this._lastPinchDist;
                    this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * ratio));
                }
                this._lastPinchDist = dist;
            }
        }, { passive: false });

        this.canvas.addEventListener('touchend', (e) => {
            for (const touch of e.changedTouches) {
                delete this._touches[touch.identifier];
            }
            if (Object.keys(this._touches).length < 2) {
                this._lastPinchDist = 0;
            }
            if (Object.keys(this._touches).length === 0) {
                this._isDragging = false;
                this._lastPanPos = null;
            }
        });

        // Mouse wheel zoom for desktop testing
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 0.9 : 1.1;
            this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
        }, { passive: false });

        // Mouse drag for desktop testing
        let mouseDown = false;
        let lastMousePos = null;
        this.canvas.addEventListener('mousedown', (e) => {
            mouseDown = true;
            lastMousePos = { x: e.clientX, y: e.clientY };
            this.followMode = false;
        });
        this.canvas.addEventListener('mousemove', (e) => {
            if (mouseDown && lastMousePos) {
                this.offset.x += e.clientX - lastMousePos.x;
                this.offset.y += e.clientY - lastMousePos.y;
                lastMousePos = { x: e.clientX, y: e.clientY };
            }
        });
        this.canvas.addEventListener('mouseup', () => {
            mouseDown = false;
            lastMousePos = null;
        });
    }

    zoomIn() {
        this.scale = Math.min(this.maxScale, this.scale * 1.3);
    }

    zoomOut() {
        this.scale = Math.max(this.minScale, this.scale / 1.3);
    }

    centerOnPosition() {
        this.followMode = true;
    }

    // Convert world position (meters) to screen pixels
    worldToScreen(worldX, worldY, centerX, centerY) {
        const sx = (worldX - centerX) * this.scale + this.width / 2 + this.offset.x;
        const sy = -(worldY - centerY) * this.scale + this.height / 2 + this.offset.y;
        return { x: sx, y: sy };
    }

    render(position, path, heading, floor) {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        // Background
        ctx.fillStyle = '#111111';
        ctx.fillRect(0, 0, this.width, this.height);

        // Center point for camera
        let centerX = 0, centerY = 0;
        if (this.followMode) {
            centerX = position.x;
            centerY = position.y;
            this.offset = { x: 0, y: 0 };
        }

        // Draw grid
        if (this.showGrid) {
            this._drawGrid(ctx, centerX, centerY);
        }

        // Draw path
        this._drawPath(ctx, path, floor, centerX, centerY);

        // Draw position marker with heading
        this._drawPositionMarker(ctx, position, heading, centerX, centerY);

        // Draw compass rose
        this._drawCompass(ctx, heading);

        // Draw scale bar
        this._drawScaleBar(ctx);
    }

    _drawGrid(ctx, centerX, centerY) {
        ctx.strokeStyle = '#222222';
        ctx.lineWidth = 0.5;

        const gridPixels = this.gridSize * this.scale;
        if (gridPixels < 10) return; // Don't draw if too dense

        const startWorldX = centerX - (this.width / 2 + this.offset.x) / this.scale;
        const endWorldX = centerX + (this.width / 2 - this.offset.x) / this.scale;
        const startWorldY = centerY - (this.height / 2 - this.offset.y) / this.scale;
        const endWorldY = centerY + (this.height / 2 + this.offset.y) / this.scale;

        const gridStart = Math.floor(startWorldX / this.gridSize) * this.gridSize;
        const gridEnd = Math.ceil(endWorldX / this.gridSize) * this.gridSize;

        for (let wx = gridStart; wx <= gridEnd; wx += this.gridSize) {
            const p = this.worldToScreen(wx, 0, centerX, centerY);
            ctx.beginPath();
            ctx.moveTo(p.x, 0);
            ctx.lineTo(p.x, this.height);
            ctx.stroke();
        }

        const gridStartY = Math.floor(startWorldY / this.gridSize) * this.gridSize;
        const gridEndY = Math.ceil(endWorldY / this.gridSize) * this.gridSize;

        for (let wy = gridStartY; wy <= gridEndY; wy += this.gridSize) {
            const p = this.worldToScreen(0, wy, centerX, centerY);
            ctx.beginPath();
            ctx.moveTo(0, p.y);
            ctx.lineTo(this.width, p.y);
            ctx.stroke();
        }
    }

    _drawPath(ctx, path, currentFloor, centerX, centerY) {
        const floorPath = path.filter(p => p.floor === currentFloor);
        if (floorPath.length < 2) return;

        ctx.beginPath();
        const first = this.worldToScreen(floorPath[0].x, floorPath[0].y, centerX, centerY);
        ctx.moveTo(first.x, first.y);

        for (let i = 1; i < floorPath.length; i++) {
            const p = this.worldToScreen(floorPath[i].x, floorPath[i].y, centerX, centerY);
            ctx.lineTo(p.x, p.y);
        }

        ctx.strokeStyle = '#007AFF';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Draw start point
        const start = this.worldToScreen(floorPath[0].x, floorPath[0].y, centerX, centerY);
        ctx.beginPath();
        ctx.arc(start.x, start.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#30D158';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    _drawPositionMarker(ctx, position, heading, centerX, centerY) {
        const p = this.worldToScreen(position.x, position.y, centerX, centerY);
        const headingRad = (-heading * Math.PI) / 180 + Math.PI / 2;

        ctx.save();
        ctx.translate(p.x, p.y);

        // Accuracy circle
        ctx.beginPath();
        ctx.arc(0, 0, 20, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 122, 255, 0.15)';
        ctx.fill();

        // Direction cone
        ctx.rotate(-headingRad + Math.PI);
        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.lineTo(-8, 10);
        ctx.lineTo(0, 6);
        ctx.lineTo(8, 10);
        ctx.closePath();
        ctx.fillStyle = '#007AFF';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Center dot
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();

        ctx.restore();
    }

    _drawCompass(ctx, heading) {
        const cx = 40;
        const cy = 40;
        const r = 25;

        ctx.save();
        ctx.translate(cx, cy);

        // Background circle
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(44, 44, 46, 0.8)';
        ctx.fill();

        // Rotate compass
        const rad = (-heading * Math.PI) / 180;
        ctx.rotate(rad);

        // North indicator
        ctx.beginPath();
        ctx.moveTo(0, -r + 5);
        ctx.lineTo(-5, 0);
        ctx.lineTo(0, -3);
        ctx.closePath();
        ctx.fillStyle = '#FF453A';
        ctx.fill();

        // South indicator
        ctx.beginPath();
        ctx.moveTo(0, r - 5);
        ctx.lineTo(5, 0);
        ctx.lineTo(0, 3);
        ctx.closePath();
        ctx.fillStyle = '#8E8E93';
        ctx.fill();

        ctx.rotate(-rad);

        // N label
        ctx.fillStyle = '#FF453A';
        ctx.font = 'bold 10px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('N', 0, -r - 4);

        ctx.restore();
    }

    _drawScaleBar(ctx) {
        const barWidthMeters = this._niceScaleValue(80 / this.scale);
        const barWidthPixels = barWidthMeters * this.scale;

        const x = 16;
        const y = this.height - 20;

        ctx.strokeStyle = '#8E8E93';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + barWidthPixels, y);
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x, y + 5);
        ctx.moveTo(x + barWidthPixels, y - 5);
        ctx.lineTo(x + barWidthPixels, y + 5);
        ctx.stroke();

        ctx.fillStyle = '#8E8E93';
        ctx.font = '11px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        const label = barWidthMeters >= 1 ? `${barWidthMeters} m` : `${Math.round(barWidthMeters * 100)} cm`;
        ctx.fillText(label, x + barWidthPixels / 2, y - 8);
    }

    _niceScaleValue(meters) {
        const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
        for (const n of nice) {
            if (n >= meters * 0.5) return n;
        }
        return nice[nice.length - 1];
    }
}
