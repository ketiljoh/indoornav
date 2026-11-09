// Points of interest — persisted in localStorage.
// Coordinates are in meters relative to the navigation start point,
// so they are only meaningful when navigation starts from the same physical spot.
// Every place belongs to one building; list()/add() work on the current building.
class PoiStore {
    constructor(buildingId, storageKey = 'indoornav-pois') {
        this.storageKey = storageKey;
        this.buildingId = buildingId;
        this.pois = this._load();
        // Places saved before buildings existed go into the initial building
        if (this.pois.some(p => !p.buildingId)) {
            this.pois.forEach(p => { if (!p.buildingId) p.buildingId = buildingId; });
            this._save();
        }
    }

    _load() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            const data = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(data)) return [];
            return data.filter(p =>
                p && typeof p.name === 'string' &&
                Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.floor)
            ).map(p => (p.id ? p : { ...p, id: this._newId() }));
        } catch (e) {
            return [];
        }
    }

    _save() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.pois));
            return true;
        } catch (e) {
            return false;
        }
    }

    _newId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    // Places in the current building
    list() {
        return this.pois.filter(p => p.buildingId === this.buildingId);
    }

    countIn(buildingId) {
        return this.pois.filter(p => p.buildingId === buildingId).length;
    }

    removeBuilding(buildingId) {
        this.pois = this.pois.filter(p => p.buildingId !== buildingId);
        return this._save();
    }

    get(id) {
        return this.pois.find(p => p.id === id) || null;
    }

    add(name, x, y, floor) {
        const poi = {
            id: this._newId(),
            name: name.trim() || this.defaultName(),
            x, y, floor,
            buildingId: this.buildingId,
            createdAt: new Date().toISOString(),
        };
        this.pois.push(poi);
        this._save();
        return poi;
    }

    rename(id, name) {
        const poi = this.get(id);
        if (!poi || !name.trim()) return false;
        poi.name = name.trim();
        return this._save();
    }

    remove(id) {
        this.pois = this.pois.filter(p => p.id !== id);
        return this._save();
    }

    defaultName() {
        return `Punkt ${this.list().length + 1}`;
    }
}
