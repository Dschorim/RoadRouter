// auth.js - Authentication and User Profile module
import CONFIG from '../config.js';

export const AUTH = {
    user: null, // { username, role, token }
    subscribers: [],

    init() {
        const stored = localStorage.getItem('route_planner_auth');
        if (stored) {
            try {
                this.user = JSON.parse(stored);
                this.notify();
            } catch (e) {
                this.logout();
            }
        }
    },

    subscribe(callback) {
        this.subscribers.push(callback);
    },

    notify() {
        this.subscribers.forEach(cb => cb(this.user));
    },

    async login(username, password) {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || `Login failed (${response.status})`);
        }

        const data = await response.json();
        this.user = data;
        localStorage.setItem('route_planner_auth', JSON.stringify(data));
        this.notify();
        return data;
    },

    async signup(username, password, confirmPassword) {
        const response = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, confirm_password: confirmPassword })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || `Signup failed (${response.status})`);
        }

        const data = await response.json();
        this.user = data;
        localStorage.setItem('route_planner_auth', JSON.stringify(data));
        this.notify();
        return data;
    },

    logout() {
        this.user = null;
        localStorage.removeItem('route_planner_auth');
        this.notify();
    },

    isAuthenticated() {
        return !!this.user && !!this.user.token;
    },

    getAuthHeader() {
        return this.user ? { 'Authorization': `Bearer ${this.user.token}` } : {};
    },

    async saveRoute(name, routeData) {
        if (!this.isAuthenticated()) throw new Error('Not authenticated');

        const response = await fetch('/api/user/routes', {
            method: 'POST',
            headers: {
                ...this.getAuthHeader(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, data: routeData })
        });

        if (!response.ok) throw new Error('Failed to save route');
        return await response.json();
    },

    async getSavedRoutes() {
        if (!this.isAuthenticated()) throw new Error('Not authenticated');

        const response = await fetch('/api/user/routes', {
            headers: this.getAuthHeader()
        });

        if (!response.ok) throw new Error('Failed to fetch routes');
        return await response.json();
    },

    async renameRoute(id, newName) {
        if (!this.isAuthenticated()) throw new Error('Not authenticated');

        const response = await fetch(`/api/user/routes/${id}`, {
            method: 'PATCH',
            headers: {
                ...this.getAuthHeader(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: newName })
        });

        if (!response.ok) throw new Error('Failed to rename route');
        return true;
    },

    async deleteRoute(id) {
        if (!this.isAuthenticated()) throw new Error('Not authenticated');

        const response = await fetch(`/api/user/routes/${id}`, {
            method: 'DELETE',
            headers: this.getAuthHeader()
        });

        if (!response.ok) throw new Error('Failed to delete route');
        return true;
    },

    async updateExistingRoute(id, name, routeData) {
        if (!this.isAuthenticated()) throw new Error('Not authenticated');

        const response = await fetch(`/api/user/routes/${id}`, {
            method: 'PATCH',
            headers: {
                ...this.getAuthHeader(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, data: routeData })
        });

        if (!response.ok) throw new Error('Failed to update route');
        return await response.json();
    },

    async adminListUsers() {
        if (this.user?.role !== 'ADMIN') throw new Error('Forbidden');

        const response = await fetch('/api/admin/users', {
            headers: this.getAuthHeader()
        });

        if (!response.ok) throw new Error('Failed to fetch users');
        return await response.json();
    }
};
