
// Temporary development-only account. Replace with Firebase Authentication.
const DEVELOPMENT_ACCOUNT = {
    email: "resident@test.local",
    password: "Test1234!",
};

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

loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loginFeedback.hidden = true;

    const enteredEmail = email.value.trim().toLowerCase();
    const enteredPassword = password.value;

    if (
        enteredEmail === DEVELOPMENT_ACCOUNT.email &&
        enteredPassword === DEVELOPMENT_ACCOUNT.password
    ) {
        sessionStorage.setItem("dev-resident-session", "true");
        window.location.href = "interface/home.html";
        return;
    }

    loginFeedback.textContent = "Incorrect email or password. Use the development test account provided by the team.";
    loginFeedback.hidden = false;
    password.value = "";
    password.focus();
});
