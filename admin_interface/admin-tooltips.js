// Delegated events also cover report actions created by live updates.
const descriptions = {
    'Export PDF': 'Download a PDF of the current analytics filters.',
    'Reset filters': 'Show analytics for all dates, barangays and categories.',
    'View details / process': 'View the report, photo and map pin, or update its processing details.',
    'Save changes': 'Save the status, priority, routing and referral details.',
    'Reload saved values': 'Replace your unsaved edits with the latest saved values.',
    'Create Announcement': 'Write a new public announcement for residents.',
    'Post Announcement': 'Publish this announcement and its selected image.',
    'Delete': 'Delete this announcement after confirmation.',
    'View details': 'Read the full announcement and view its image.',
    'Refresh announcements': 'Reload the announcement list.',
    'Retry': 'Try loading the reports again.',
    'Retry loading': 'Check access and load the data again.',
    'Retry photo': 'Try downloading this report photo again.',
    'Remove image': 'Remove the selected image before publishing.',
};
const tip = document.createElement('div');
tip.id = 'adminActionTooltip'; tip.className = 'admin_action_tooltip'; tip.setAttribute('role','tooltip'); tip.hidden = true;
document.body.append(tip);
let active, previous;
function hide() {
    if (active) {
        if (previous) active.setAttribute('aria-describedby',previous);
        else active.removeAttribute('aria-describedby');
    }
    active = null; tip.hidden = true;
}
function show(event) {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    const description = descriptions[button.textContent.trim()] || button.getAttribute('aria-label');
    if (!description || active === button) return;
    hide(); active = button; previous = button.getAttribute('aria-describedby');
    button.setAttribute('aria-describedby', [previous,tip.id].filter(Boolean).join(' '));
    tip.textContent = description; tip.hidden = false;
    const rect = button.getBoundingClientRect();
    tip.style.left = Math.max(8,Math.min(rect.left,window.innerWidth-tip.offsetWidth-8))+'px';
    tip.style.top = Math.max(8,rect.top-tip.offsetHeight-8)+'px';
}
document.addEventListener('pointerover',show);
document.addEventListener('focusin',show);
document.addEventListener('pointerout',event=>{if(active?.contains(event.target) && !active.contains(event.relatedTarget)) hide();});
document.addEventListener('focusout',hide);
document.addEventListener('keydown',event=>{if(event.key === 'Escape') hide();});
window.addEventListener('scroll',hide,true);
window.addEventListener('resize',hide);
