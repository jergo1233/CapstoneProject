import { getServices } from "../firebase/client.js";
import { authMessage } from "../firebase/auth.js";
import { createUserWithEmailAndPassword, deleteUser, signOut, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

// PASSWORD FIELD
const password = document.getElementById("password");
const togglePassword = document.getElementById("togglePassword");
const eyeIcon = document.getElementById("eyeIcon");

// CONFIRM PASSWORD FIELD
const confirmPassword = document.getElementById("confirmPassword");
const toggleConfirmPassword = document.getElementById("toggleConfirmPassword");
const confirmEyeIcon = document.getElementById("confirmEyeIcon");

// SHOW/HIDE PASSWORD
togglePassword.addEventListener("click", function () {
    if (password.type === "password") {
        password.type = "text";
        eyeIcon.src = "register/assets_reg/eye.png";
    } else {
        password.type = "password";
        eyeIcon.src = "register/assets_reg/hides.png";
    }
});

// SHOW/HIDE CONFIRM PASSWORD
toggleConfirmPassword.addEventListener("click", function () {
    if (confirmPassword.type === "password") {
        confirmPassword.type = "text";
        confirmEyeIcon.src = "register/assets_reg/eye.png";
    } else {
        confirmPassword.type = "password";
        confirmEyeIcon.src = "register/assets_reg/hides.png";
    }
});

document.getElementById("registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const feedback = document.getElementById("registerFeedback");
    const button = event.currentTarget.querySelector('[type="submit"]');
    feedback.hidden = false;
    if (password.value !== confirmPassword.value) {
        feedback.textContent = "Passwords do not match.";
        return;
    }
    const fullName = document.getElementById("fullName").value.trim();
    const homeBarangay = document.getElementById("barangayInput").value.trim();
    if (!fullName || !homeBarangay) {
        feedback.textContent = "Enter your name and home barangay.";
        return;
    }
    button.disabled = true;
    feedback.textContent = "Creating your account…";
    try {
        const { auth, db } = await getServices();
        await setPersistence(auth, browserSessionPersistence);
        const { user } = await createUserWithEmailAndPassword(auth, document.getElementById("email").value.trim(), password.value);
        try {
            await setDoc(doc(db, "residents", user.uid), {
                fullName, homeBarangay, emailAddress: user.email,
                dateRegistered: serverTimestamp(), role: "Resident",
            });
        } catch (error) {
            try { await deleteUser(user); }
            catch {
                await signOut(auth);
                throw new Error("Your account was created, but its profile could not be saved. Contact the project administrator before registering again.");
            }
            throw error;
        }
        window.location.href = "interface/home.html";
    } catch (error) {
        feedback.textContent = authMessage(error);
    } finally {
        button.disabled = false;
    }
});
