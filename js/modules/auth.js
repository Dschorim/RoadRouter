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

    async login(username, password, mfaCode = null) {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, mfa_code: mfaCode })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || `Login failed (${response.status})`);
        }

        const data = await response.json();

        if (data.mfa_required) {
            return { mfa_required: true };
        }

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

    async changePassword(oldPassword, newPassword, confirmNewPassword) {
        if (!this.isAuthenticated()) throw new Error('Not authenticated');

        const response = await fetch('/api/user/change-password', {
            method: 'POST',
            headers: {
                ...this.getAuthHeader(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                old_password: oldPassword,
                new_password: newPassword,
                confirm_new_password: confirmNewPassword
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to change password');
        }
        return true;
    },

    async setupMFA() {
        if (!this.isAuthenticated()) throw new Error('Not authenticated');

        const response = await fetch('/api/user/mfa/setup', {
            method: 'POST',
            headers: this.getAuthHeader()
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to setup MFA');
        }
        return await response.json();
    },

    async updateProfile(profileData) {
        if (!this.isAuthenticated()) throw new Error('Not authenticated');

        const response = await fetch('/api/user/profile', {
            method: 'PATCH',
            headers: {
                ...this.getAuthHeader(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(profileData)
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to update profile');
        }

        const updated = await response.json();
        this.user = { ...this.user, ...updated };
        localStorage.setItem('route_planner_auth', JSON.stringify(this.user));
        this.notify();
        return true;
    },

    async verifyMFA(code) {
        if (!this.isAuthenticated()) throw new Error('Not authenticated');

        const response = await fetch('/api/user/mfa/verify', {
            method: 'POST',
            headers: {
                ...this.getAuthHeader(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code: code })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to verify MFA');
        }
        return true;
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
    },

    async adminResetPassword(username, newPassword) {
        if (this.user?.role !== 'ADMIN') throw new Error('Forbidden');

        const response = await fetch('/api/admin/reset-password', {
            method: 'POST',
            headers: {
                ...this.getAuthHeader(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, new_password: newPassword })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to reset password');
        }
        return true;
    },

    async adminResetMfa(username) {
        if (this.user?.role !== 'ADMIN') throw new Error('Forbidden');

        const response = await fetch('/api/admin/reset-mfa', {
            method: 'POST',
            headers: {
                ...this.getAuthHeader(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to reset MFA');
        }
        return true;
    },

    async adminDeleteUser(username) {
        if (this.user?.role !== 'ADMIN') throw new Error('Forbidden');

        const response = await fetch(`/api/admin/users/${username}`, {
            method: 'DELETE',
            headers: this.getAuthHeader()
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to delete user');
        }
        return true;
    },

    async adminPromoteUser(username) {
        if (this.user?.role !== 'ADMIN') throw new Error('Forbidden');

        const response = await fetch('/api/admin/promote', {
            method: 'POST',
            headers: {
                ...this.getAuthHeader(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to promote user');
        }
        return true;
    },

    async adminDemoteUser(username) {
        if (this.user?.role !== 'ADMIN') throw new Error('Forbidden');

        const response = await fetch('/api/admin/demote', {
            method: 'POST',
            headers: {
                ...this.getAuthHeader(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to demote user');
        }
        return true;
    }
};
