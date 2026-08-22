let mockAnnouncements = [
    {
        id: "1",
        title: "Drainage Clearing Activity",
        content: "announcement content....",
        images: []
    }
];

let selectedImages = [];

const announcementDB = {
    async getAnnouncements() {
        return mockAnnouncements;
    },

    async createAnnouncement(title, content, images) {
        const newAnnouncement = {
            id: Date.now().toString(),
            title: title,
            content: content,
            images: images
        };
        mockAnnouncements.push(newAnnouncement);
        return newAnnouncement;
    },

    async deleteAnnouncement(id) {
        mockAnnouncements = mockAnnouncements.filter(item => item.id !== id);
    }
};

async function renderAnnouncements() {
    const listContainer = document.getElementById("announcementsList");
    listContainer.innerHTML = "";

    const announcements = await announcementDB.getAnnouncements();

    announcements.forEach(item => {
        const imagesHTML = item.images && item.images.length > 0
            ? `<div class="card_images">
                ${item.images.map(img => `<img src="${img}" class="card_img_thumb" />`).join('')}
               </div>`
            : '';

        const card = document.createElement("div");
        card.className = "announcement_card";
        
        // Kapag clinic ang mismong Card, mag-o-open ang View Overlay
        card.addEventListener("click", () => openViewModal(item));

        card.innerHTML = `
            <div>
                <h3>${item.title}</h3>
                <p>${item.content}</p>
                ${imagesHTML}
            </div>
            <button class="btn_delete_announcement">Delete</button>
        `;

        // Para hindi mag-trigger ang View Overlay kapag 'Delete' ang pino-point/pindot
        const deleteBtn = card.querySelector(".btn_delete_announcement");
        deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation(); 
            handleDeleteAnnouncement(item.id);
        });

        listContainer.appendChild(card);
    });
}

// Function para Buksan at Ipakita ang Detalye ng Announcement sa Overlay
function openViewModal(item) {
    const viewModal = document.getElementById("viewAnnouncementModal");
    const viewTitle = document.getElementById("viewTitle");
    const viewContent = document.getElementById("viewContent");
    const viewImagesContainer = document.getElementById("viewImagesContainer");

    viewTitle.innerText = item.title;
    viewContent.innerText = item.content;

    // Render ng malalaking images kung mayroon
    if (item.images && item.images.length > 0) {
        viewImagesContainer.innerHTML = item.images
            .map(img => `<img src="${img}" class="view_full_img" />`)
            .join('');
    } else {
        viewImagesContainer.innerHTML = '';
    }

    viewModal.classList.add("active");
}

async function handleDeleteAnnouncement(id) {
    if (confirm("Are you sure you want to delete this announcement?")) {
        await announcementDB.deleteAnnouncement(id);
        renderAnnouncements();
    }
}

function renderPreviews() {
    const previewsContainer = document.getElementById("photoPreviews");
    previewsContainer.innerHTML = "";

    selectedImages.forEach((imgUrl, index) => {
        const itemWrapper = document.createElement("div");
        itemWrapper.className = "preview_item";

        itemWrapper.innerHTML = `
            <img src="${imgUrl}" class="photo_placeholder" />
            <button type="button" class="btn_remove_img" onclick="removeSelectedImage(${index})">&times;</button>
        `;

        previewsContainer.appendChild(itemWrapper);
    });
}

window.removeSelectedImage = function(index) {
    selectedImages.splice(index, 1);
    renderPreviews();
};

document.addEventListener("DOMContentLoaded", () => {
    // Create Modal Elements
    const createModal = document.getElementById("announcementModal");
    const openBtn = document.getElementById("openModalBtn");
    const postBtn = document.getElementById("postAnnouncementBtn");
    const titleInput = document.getElementById("announcementTitle");
    const contentInput = document.getElementById("announcementContent");
    const cameraInput = document.getElementById("imageUploadCamera");
    const fileInput = document.getElementById("imageUploadFile");

    // View Modal Elements
    const viewModal = document.getElementById("viewAnnouncementModal");
    const closeViewBtn = document.getElementById("closeViewModalBtn");

    // Controls para sa Create Modal
    openBtn.addEventListener("click", () => createModal.classList.add("active"));
    createModal.addEventListener("click", (e) => {
        if (e.target === createModal) createModal.classList.remove("active");
    });

    // Controls para sa View Overlay Modal
    closeViewBtn.addEventListener("click", () => viewModal.classList.remove("active"));
    viewModal.addEventListener("click", (e) => {
        if (e.target === viewModal) viewModal.classList.remove("active");
    });

    // Upload Files Handling
    const handleFiles = (files) => {
        Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onload = (event) => {
                selectedImages.push(event.target.result);
                renderPreviews();
            };
            reader.readAsDataURL(file);
        });
    };

    cameraInput.addEventListener("change", (e) => handleFiles(e.target.files));
    fileInput.addEventListener("change", (e) => handleFiles(e.target.files));

    // Post Announcement Event
    postBtn.addEventListener("click", async () => {
        const title = titleInput.value.trim();
        const content = contentInput.value.trim();

        if (!title || !content) {
            alert("Please fill in both title and content.");
            return;
        }

        await announcementDB.createAnnouncement(title, content, selectedImages);

        titleInput.value = "";
        contentInput.value = "";
        cameraInput.value = "";
        fileInput.value = "";
        selectedImages = [];
        renderPreviews();
        createModal.classList.remove("active");

        renderAnnouncements();
    });

    renderAnnouncements();
});