document.addEventListener("DOMContentLoaded", () => {
    const currentPage = window.location.pathname.split("/").pop();

    // 1. KUNG NASA LOGIN PAGE (admin.html)
    if (currentPage === "admin.html" || currentPage === "") {
        // Kapag naka-login na, bawal na bumalik sa login screen
        if (sessionStorage.getItem("isLoggedIn") === "true") {
            window.location.replace("../dashboard.html");
            return;
        }

       // Toggle Password Visibility
    const togglePassword = document.getElementById("togglePassword");
    const password = document.getElementById("admin_password");
    const eyeIcon = document.getElementById("eyeIcon");

    if (togglePassword && password && eyeIcon) {
        togglePassword.addEventListener("click", () => {
            if (password.type === "password") {
                password.type = "text";
                // Inaayos ang path ng icon batay sa kasalukuyang nakalagay na image
                eyeIcon.src = eyeIcon.src.replace("hides.png", "eye.png");
            } else {
                password.type = "password";
                eyeIcon.src = eyeIcon.src.replace("eye.png", "hides.png");
            }
        });
    }

        // Login Form Submit
        const loginForm = document.getElementById("loginForm");
        if (loginForm) {
            loginForm.addEventListener("submit", (e) => {
                e.preventDefault();
                sessionStorage.setItem("isLoggedIn", "true");
                window.location.replace("../dashboard.html");
            });
        }
    } 
    // 2. KUNG NASA PROTECTED DASHBOARD PAGES
    else {
        // Kapag WALA pang session, itapon agad sa login page
        if (sessionStorage.getItem("isLoggedIn") !== "true") {
            window.location.replace("admin_login/admin.html");
        }
    }
});

// Logout Function (Tumatakbo kapag cliniclick ang logout button)
function handleLogout(event) {
    if (event) event.preventDefault();
    if (confirm("Are you sure you want to log out?")) {
        sessionStorage.clear();
        localStorage.clear();
        window.location.replace("admin_login/admin.html");
    }
}