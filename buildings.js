// Buildings — each building has its own set of places (POIs).
// Persisted in localStorage together with the currently selected building.
class BuildingStore {
    constructor(storageKey = 'indoornav-buildings', currentKey = 'indoornav-building') {
        this.storageKey = storageKey;
        this.currentKey = currentKey;
        this.buildings = this._load();
        if (this.buildings.length === 0) {
            this.buildings.push(this._make('Mitt bygg'));
            this._save();
        }
        let current = null;
        try { current = localStorage.getItem(this.currentKey); } catch (e) { /* ignore */ }
        this.currentId = this.get(current) ? current : this.buildings[0].id;
    }

    _load() {
        try {
            const data = JSON.parse(localStorage.getItem(this.storageKey));
            if (!Array.isArray(data)) return [];
            return data.filter(b => b && typeof b.id === 'string' && typeof b.name === 'string');
        } catch (e) {
            return [];
        }
    }

    _save() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.buildings));
            return true;
        } catch (e) {
            return false;
        }
    }

    _make(name) {
        return {
            id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name,
            createdAt: new Date().toISOString(),
        };
    }

    list() {
        return this.buildings;
    }

    get(id) {
        return this.buildings.find(b => b.id === id) || null;
    }

    current() {
        return this.get(this.currentId);
    }

    setCurrent(id) {
        if (!this.get(id)) return false;
        this.currentId = id;
        try { localStorage.setItem(this.currentKey, id); } catch (e) { /* ignore */ }
        return true;
    }

    add(name) {
        const b = this._make(name.trim() || this.defaultName());
        this.buildings.push(b);
        this._save();
        return b;
    }

    rename(id, name) {
        const b = this.get(id);
        if (!b || !name.trim()) return false;
        b.name = name.trim();
        return this._save();
    }

    // The last building cannot be removed
    remove(id) {
        if (this.buildings.length <= 1) return false;
        this.buildings = this.buildings.filter(b => b.id !== id);
        if (this.currentId === id) this.setCurrent(this.buildings[0].id);
        return this._save();
    }

    defaultName() {
        return `Bygg ${this.buildings.length + 1}`;
    }
}
