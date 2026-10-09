/* ==========================================================================
   FILE: js/main.js
   PURPOSE: Shared JavaScript logic used across multiple pages.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

    // ── Mobile Menu Toggle ──────────────────────────────────────────────
    const menuToggle = document.getElementById('menuToggle');
    const navLinks = document.getElementById('navLinks');

    if (menuToggle && navLinks) {
        menuToggle.addEventListener('click', () => {
            navLinks.classList.toggle('open');
            const icon = menuToggle.querySelector('i');
            if (navLinks.classList.contains('open')) {
                icon.classList.replace('fa-bars', 'fa-xmark');
            } else {
                icon.classList.replace('fa-xmark', 'fa-bars');
            }
        });

        // Close mobile menu on link click (but not the dropdown trigger)
        navLinks.querySelectorAll('a:not(.user-dropdown-trigger)').forEach(link => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('open');
                const icon = menuToggle.querySelector('i');
                icon.classList.replace('fa-xmark', 'fa-bars');
            });
        });
    }

    // ── Admin/Staff Portal Mobile Dropdown Toggle ───────────────────────
    window.toggleMobileMenu = function () {
        const adminNav = document.querySelector('.admin-nav');
        const adminLogoutBtn = document.querySelector('.admin-logout-btn');
        const menuBtnIcon = document.querySelector('.mobile-menu-btn i');

        if (adminNav) {
            adminNav.classList.toggle('show-mobile');
            if (adminLogoutBtn) adminLogoutBtn.classList.toggle('show-mobile');

            if (menuBtnIcon) {
                if (adminNav.classList.contains('show-mobile')) {
                    menuBtnIcon.classList.replace('fa-bars', 'fa-xmark');
                } else {
                    menuBtnIcon.classList.replace('fa-xmark', 'fa-bars');
                }
            }
        }
    };

    // ── Navbar Scroll Shadow ────────────────────────────────────────────
    const navbar = document.getElementById('navbar');
    if (navbar) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 10) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }
        });
    }

    // ── Sidebar Toggle (Admin pages) ────────────────────────────────────
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');

    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            if (sidebarOverlay) sidebarOverlay.classList.toggle('show');
        });

        if (sidebarOverlay) {
            sidebarOverlay.addEventListener('click', () => {
                sidebar.classList.remove('open');
                sidebarOverlay.classList.remove('show');
            });
        }
    }

    // ── Active sidebar link highlight ───────────────────────────────────
    const currentPage = window.location.pathname.split('/').pop();
    document.querySelectorAll('.sidebar-nav a').forEach(link => {
        const href = link.getAttribute('href');
        if (href && href.includes(currentPage)) {
            link.classList.add('active');
        }
    });

    // ── Active navbar link highlight ────────────────────────────────────
    document.querySelectorAll('.navbar-links a, .nav-links a').forEach(link => {
        const href = link.getAttribute('href');
        if (href && href.includes(currentPage) && currentPage !== '') {
            link.classList.add('active');
        }
    });

    // ── Navbar Auth State ───────────────────────────────────────────────
    const navBtn = document.getElementById('navAuthBtn');
    if (navBtn) {
        const user = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
        if (user) {
            const prefix = getRelativePath();

            // Build role-specific dropdown items
            let menuItems = '';
            let mobileMenuItems = '';

            if (user.role === 'owner') {
                const dashUrl = prefix + 'admin/dashboard.html';
                menuItems = `<a href="${dashUrl}"><i class="fas fa-tachometer-alt"></i> Dashboard</a>`;
                mobileMenuItems = `<a href="${dashUrl}"><i class="fas fa-tachometer-alt"></i> Dashboard</a>`;
            } else if (user.role === 'staff') {
                const dashUrl = prefix + 'staff/dashboard.html';
                menuItems = `<a href="${dashUrl}"><i class="fas fa-tachometer-alt"></i> Dashboard</a>`;
                mobileMenuItems = `<a href="${dashUrl}"><i class="fas fa-tachometer-alt"></i> Dashboard</a>`;
            } else {
                const acctUrl = prefix + 'client/dashboard.html';
                const apptUrl = prefix + 'client/my-appointments.html';
                menuItems = `
                    <a href="${acctUrl}"><i class="fas fa-user"></i> Account</a>
                    <a href="${apptUrl}"><i class="fas fa-calendar-alt"></i> My Appointments</a>`;
                mobileMenuItems = `
                    <a href="${acctUrl}"><i class="fas fa-user"></i> Account</a>
                    <a href="${apptUrl}"><i class="fas fa-calendar-alt"></i> My Appointments</a>`;
            }

            // Desktop dropdown
            const wrapper = document.createElement('div');
            wrapper.className = 'user-dropdown';

            const trigger = document.createElement('a');
            trigger.href = '#';
            trigger.className = 'nav-btn user-dropdown-trigger';
            trigger.innerHTML = `Hello, ${user.name}! <i class="fas fa-chevron-down" style="font-size:0.7rem; margin-left:5px;"></i>`;
            trigger.addEventListener('click', (e) => {
                e.preventDefault();
                wrapper.classList.toggle('open');
            });

            const menu = document.createElement('div');
            menu.className = 'user-dropdown-menu';
            menu.innerHTML = `
                ${menuItems}
                <a href="#" id="navLogoutBtn"><i class="fas fa-sign-out-alt"></i> Log Out</a>
            `;

            wrapper.appendChild(trigger);
            wrapper.appendChild(menu);
            navBtn.replaceWith(wrapper);

            // Stop menu clicks from bubbling to the outside-click handler
            menu.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // Logout handler
            const logoutBtn = document.getElementById('navLogoutBtn');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (confirm('Are you sure you want to logout?')) {
                        Auth.logout();
                    }
                });
            }

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!wrapper.contains(e.target)) {
                    wrapper.classList.remove('open');
                }
            });

            // ── Mobile: inject dropdown items directly into nav-links ──
            if (navLinks) {
                const mobileItems = document.createElement('div');
                mobileItems.className = 'mobile-user-links';
                mobileItems.innerHTML = `
                    <div class="mobile-user-divider"></div>
                    ${mobileMenuItems}
                    <a href="#" class="mobile-logout-btn"><i class="fas fa-sign-out-alt"></i> Log Out</a>
                `;
                navLinks.appendChild(mobileItems);

                // Mobile logout
                mobileItems.querySelector('.mobile-logout-btn').addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (confirm('Are you sure you want to logout?')) Auth.logout();
                });
            }
        }
    }
});

/* ── Helper: Detect path prefix ──────────────────────────────────────── */
function getRelativePath() {
    const path = window.location.pathname;
    if (path.includes('/client/') || path.includes('/admin/') || path.includes('/staff/')) {
        return '../';
    }
    return '';
}

/* ── Helper: Format currency ─────────────────────────────────────────── */
function formatCurrency(amount) {
    return '₱' + Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2 });
}
