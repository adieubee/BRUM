/* ==========================================================================
   FILE: js/auth.js
   PURPOSE: Handles Login, Logout, and Registration.
   Stores a signed server token in localStorage and attaches it to every
   authenticated API call via the Authorization header.
   ========================================================================== */

const Auth = {
    // A. LOGIN FUNCTION (Async API Call)
    login: async function (username, password) {
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const result = await response.json();

            if (result.success) {
                localStorage.setItem('currentUser', JSON.stringify(result.user));
                localStorage.setItem('authToken', result.token || '');
                return { success: true, role: result.role, user: result.user };
            } else {
                return { success: false, message: result.message || 'Invalid Username or Password' };
            }
        } catch (error) {
            console.error('Login API error:', error);
            return { success: false, message: 'Server connection failed' };
        }
    },

    // B. REGISTER FUNCTION (Async API Call)
    register: async function (name, username, email, password) {
        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, username, email, password })
            });
            const result = await response.json();

            if (result.success) {
                localStorage.setItem('currentUser', JSON.stringify(result.user));
                localStorage.setItem('authToken', result.token || '');
                return { success: true };
            } else {
                return { success: false, message: result.message || 'Registration failed' };
            }
        } catch (error) {
            console.error('Register API error:', error);
            return { success: false, message: 'Server connection failed' };
        }
    },

    // C. LOGOUT FUNCTION
    logout: function () {
        localStorage.removeItem('currentUser');
        localStorage.removeItem('authToken');
        const path = window.location.pathname;
        if (path.includes('/client/') || path.includes('/admin/') || path.includes('/staff/')) {
            window.location.href = '../login.html';
        } else {
            window.location.href = 'login.html';
        }
    },

    // D. CHECK IF LOGGED IN (returns the user object stored at login time)
    getUser: function () {
        const userStr = localStorage.getItem('currentUser');
        if (userStr) {
            try { return JSON.parse(userStr); } catch { return null; }
        }
        return null;
    },

    // E. Get the auth token
    getToken: function () {
        return localStorage.getItem('authToken') || '';
    },

    // F. Build authenticated fetch headers (merges with any extra headers provided)
    authHeaders: function (extra = {}) {
        const token = this.getToken();
        const headers = { 'Content-Type': 'application/json', ...extra };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return headers;
    },

    // G. Convenience: authenticated fetch wrapper
    apiFetch: async function (url, options = {}) {
        const headers = this.authHeaders(options.headers || {});
        const response = await fetch(url, { ...options, headers });
        // If token expired/invalid, redirect to login
        if (response.status === 401) {
            this.logout();
            return null;
        }
        return response;
    },

    // H. PROTECT PAGE
    requireLogin: function () {
        const user = this.getUser();
        if (!user || !this.getToken()) {
            console.log('You must login first!');
            window.location.href = '../login.html';
        }
    }
};