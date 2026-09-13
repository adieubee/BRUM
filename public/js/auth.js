/* ==========================================================================
   FILE: js/auth.js
   PURPOSE: Handles Login, Logout, and Registration using LocalStorage.
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
                // Save complete user object to LocalStorage for session
                localStorage.setItem('currentUser', JSON.stringify(result.user));
                return { success: true, role: result.role, user: result.user };
            } else {
                return { success: false, message: result.message || "Invalid Username or Password" };
            }
        } catch (error) {
            console.error('Login API error:', error);
            return { success: false, message: "Server connection failed" };
        }
    },

    // B. REGISTER FUNCTION (Async API Call)
    register: async function (name, username, password, phone) {
        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, username, password, phone })
            });
            const result = await response.json();

            if (result.success) {
                // Automatically log them in after registration
                localStorage.setItem('currentUser', JSON.stringify(result.user));
                return { success: true };
            } else {
                return { success: false, message: result.message || "Registration failed" };
            }
        } catch (error) {
            console.error('Register API error:', error);
            return { success: false, message: "Server connection failed" };
        }
    },

    // C. LOGOUT FUNCTION
    logout: function () {
        localStorage.removeItem('currentUser');
        // Smart redirect: detect if we're in a subfolder
        const path = window.location.pathname;
        if (path.includes('/client/') || path.includes('/admin/') || path.includes('/staff/')) {
            window.location.href = '../login.html';
        } else {
            window.location.href = 'login.html';
        }
    },

    // D. CHECK IF LOGGED IN
    getUser: function () {
        const userStr = localStorage.getItem('currentUser');
        if (userStr) return JSON.parse(userStr);
        return null; // Guest
    },

    // E. PROTECT PAGE (Put this at top of Booking/Admin pages)
    requireLogin: function () {
        const user = this.getUser();
        if (!user) {
            console.log("You must login first!");
            window.location.href = '../login.html';
        }
    }
};