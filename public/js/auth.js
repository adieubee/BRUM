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
        // Accept the raw token and older values that may already include "Bearer ".
        return (localStorage.getItem('authToken') || '')
            .trim()
            .replace(/^Bearer\s+/i, '');
    },

    // F. Build authenticated fetch headers (merges with any extra headers provided)
    authHeaders: function (extra = {}) {
        const token = this.getToken();
        const headers = { 'Content-Type': 'application/json', ...extra };

        // Header names are case-insensitive, but normalize the key so a stale
        // lower-case Authorization header cannot override the current login token.
        delete headers.authorization;
        delete headers.Authorization;
        if (token) headers.Authorization = `Bearer ${token}`;
        return headers;
    },

    // G. Convenience: authenticated fetch wrapper
    apiFetch: async function (url, options = {}) {
        const headers = this.authHeaders(options.headers || {});
        try {
            const response = await fetch(url, { ...options, headers });

            // Only trigger a full logout if the core token verification/session check fails.
            // Do NOT log out when regular operational endpoints (like booking, branches, services)
            // fail or return 401/403, as that might be a route/permission or role error.
            if (response.status === 401) {
                const isAuthCheckEndpoint = url.includes('/api/auth/verify') ||
                    url.includes('/api/auth/me') ||
                    url.includes('/api/auth/validate');

                if (isAuthCheckEndpoint) {
                    console.warn('Session expired. Logging out.');
                    this.logout();
                    return null;
                }

                console.warn(`Request to ${url} returned 401, but keeping user session intact.`);
            }

            return response;
        } catch (error) {
            console.error(`apiFetch failed for ${url}:`, error);
            throw error;
        }
    },

    // H. PROTECT PAGE
    requireLogin: function () {
        const user = this.getUser();
        const token = this.getToken();

        if (!user || !token) {
            console.warn('You must login first!');
            const path = window.location.pathname;
            if (path.includes('/client/') || path.includes('/admin/') || path.includes('/staff/')) {
                window.location.href = '../login.html';
            } else {
                window.location.href = 'login.html';
            }
        }
    }
};