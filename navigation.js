class IndoorNavigator {
    constructor() {
        // Position in meters from start point
        this.position = { x: 0, y: 0 };
        this.floor = 0;

        // Track the path
        this.path = [{ x: 0, y: 0, floor: 0 }];
        this.maxPathLength = 5000;

        // Stride length in meters
        this.strideLength = 0.7;

        // Heading filter (low-pass)
        this._filteredHeading = 0;
        this._headingAlpha = 0.3;

        // Position callbacks
        this.onPositionUpdate = null;
    }

    reset() {
        this.position = { x: 0, y: 0 };
        this.path = [{ x: 0, y: 0, floor: this.floor }];
    }

    // Start (or restart) dead reckoning from a known point, e.g. a saved place
    setStart(x, y, floor) {
        this.position = { x, y };
        this.floor = floor;
        this.path = [{ x, y, floor }];
    }

    setFloor(floor) {
        this.floor = floor;
    }

    // Called when a step is detected
    addStep(headingDegrees) {
        // Low-pass filter on heading to reduce noise
        this._filteredHeading = this._lerpAngle(
            this._filteredHeading,
            headingDegrees,
            this._headingAlpha
        );

        const headingRad = (this._filteredHeading * Math.PI) / 180;

        // Dead reckoning: update position
        // Heading 0 = North = positive Y, 90 = East = positive X
        const dx = this.strideLength * Math.sin(headingRad);
        const dy = this.strideLength * Math.cos(headingRad);

        this.position.x += dx;
        this.position.y += dy;

        this.path.push({
            x: this.position.x,
            y: this.position.y,
            floor: this.floor,
        });

        if (this.path.length > this.maxPathLength) {
            this.path.shift();
        }

        if (this.onPositionUpdate) {
            this.onPositionUpdate(this.position, this.path);
        }
    }

    // Get distance traveled in meters
    getDistanceTraveled() {
        return (this.path.length - 1) * this.strideLength;
    }

    // Interpolate between two angles
    _lerpAngle(a, b, t) {
        let diff = ((b - a + 540) % 360) - 180;
        return (a + diff * t + 360) % 360;
    }
}
