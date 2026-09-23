import { login, logout, hasRole, authMessage } from "../../firebase/auth.js";
import { getServices } from "../../firebase/client.js";

const shortRoutes = /^\/admin(?:\/|$)/.test(window.location.pathname);
const isLoginPage = Boolean(document.getElementById('admin_email'));
const loginPath = shortRoutes ? '/admin' : 'admin_login/admin.html';
if (shortRoutes) {
    const routes = { 'dashboard.html': '/admin/dashboard', 'report_management.html': '/admin/reports',
        'analytics.html': '/admin/analytics', 'admin_announcement.html': '/admin/announcements' };
    document.querySelectorAll('a[href]').forEach(link => {
        const route = routes[link.getAttribute('href')];
        if (route) link.setAttribute('href', route);
    });
}
window.handleLogout = async (event) => {
    event?.preventDefault();
    try {
        await logout();
        window.location.replace(loginPath);
    } catch (error) { alert(authMessage(error)); }
};
if (isLoginPage) {
    const form = document.getElementById("loginForm");
    const password = document.getElementById("admin_password");
    document.getElementById("togglePassword").addEventListener("click", () => {
        password.type = password.type === "password" ? "text" : "password";
        document.getElementById("eyeIcon").src = `../assets_admin/${password.type === "password" ? "hides" : "eye"}.png`;
    });
    const feedback = document.createElement("p");
    feedback.setAttribute("role", "alert");
    form.after(feedback);
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector('[type="submit"]');
        button.disabled = true;
        feedback.textContent = "";
        try {
            await login(document.getElementById("admin_email").value, password.value, "Admin");
            window.location.replace(shortRoutes ? "/admin/dashboard" : "../dashboard.html");
        } catch (error) { feedback.textContent = authMessage(error); }
        finally { button.disabled = false; }
    });
} else if (!document.body.hasAttribute("data-report-page")) {
    try {
        const { auth } = await getServices();
        if (!await hasRole(auth.currentUser, "Admin")) window.location.replace(loginPath);
    } catch (error) {
        alert(authMessage(error));
        window.location.replace(loginPath);
    }
}
