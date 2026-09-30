import { login, authMessage } from "../firebase/auth.js";

const togglePassword = document.getElementById("togglePassword");
const password = document.getElementById("password");
const eyeIcon = document.getElementById("eyeIcon");
const loginForm = document.getElementById("loginForm");
const email = document.getElementById("email");
const loginFeedback = document.getElementById("loginFeedback");

togglePassword.addEventListener("click", () => {
    if(password.type === "password"){
        password.type = "text";
        eyeIcon.src = "assets_log/eye.png";
    }else{
        password.type = "password";
        eyeIcon.src = "assets_log/hides.png";
    }
});

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginFeedback.hidden = true;
    const button = loginForm.querySelector('[type="submit"]');
    button.disabled = true;
    try {
        await login(email.value, password.value, "Resident", document.getElementById("rememberDevice").checked);
        window.location.href = "interface/home.html";
    } catch (error) {
        loginFeedback.textContent = authMessage(error);
        loginFeedback.hidden = false;
    } finally {
        button.disabled = false;
    }
});
