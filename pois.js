// Points of interest — persisted in localStorage.
// Coordinates are in meters relative to the navigation start point,
// so they are only meaningful when navigation starts from the same physical spot.
class PoiStore {
    constructor(storageKey = 'indoornav-pois') {
        this.storageKey = storageKey;
        this.pois = this._load();
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

    list() {
        return this.pois;
    }

    get(id) {
        return this.pois.find(p => p.id === id) || null;
    }

    add(name, x, y, floor) {
        const poi = {
            id: this._newId(),
            name: name.trim() || `Punkt ${this.pois.length + 1}`,
            x, y, floor,
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
        return `Punkt ${this.pois.length + 1}`;
    }
}
