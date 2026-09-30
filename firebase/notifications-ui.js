import { getServices } from './client.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { collection, query, where, onSnapshot, doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
const host = document.querySelector('.dashboard_header, .app_header');
const isAdmin = Boolean(document.querySelector('.dashboard_header'));
const root = new URL('../', import.meta.url);
const element = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const widget = element('div'); widget.className = 'notification_widget';
const bell = element('button'); bell.type = 'button'; bell.className = 'notification_bell';
bell.textContent = '🔔'; bell.setAttribute('aria-label','Notifications'); bell.setAttribute('aria-expanded','false');
const badge = element('span'); badge.className = 'notification_badge'; badge.hidden = true; badge.setAttribute('aria-live','polite'); bell.append(badge);
const panel = element('section'); panel.id = 'notificationPanel'; panel.className = 'notification_panel'; panel.hidden = true;
panel.setAttribute('aria-label','Notifications'); bell.setAttribute('aria-controls',panel.id);
const heading = element('h2','Notifications');
const message = element('p','Connect to load notifications.'); message.setAttribute('role','status');
const list = element('ul'); panel.append(heading,message,list); widget.append(bell,panel); host?.append(widget);
function close() { panel.hidden = true; bell.setAttribute('aria-expanded','false'); }
bell.addEventListener('click',()=>{panel.hidden=!panel.hidden;bell.setAttribute('aria-expanded',String(!panel.hidden));});
document.addEventListener('click',event=>{if(!widget.contains(event.target))close();});
widget.addEventListener('keydown',event=>{if(event.key==='Escape'){close();bell.focus();}});
let authStop, disposed=false, generation=0, stops=[], events=[], reads=new Set(), uid=null, db, cached=false, eventsReady=false, readsReady=false;
function clear() { stops.forEach(stop=>stop());stops=[];events=[];reads.clear();list.replaceChildren();badge.hidden=true;badge.textContent='';bell.setAttribute('aria-label','Notifications');eventsReady=false;readsReady=false;close(); }
function render() {
    list.replaceChildren();
    if(!eventsReady || !readsReady) { message.textContent='Loading notifications…';return; }
    const unread=events.filter(event=>!reads.has(event.id)).length;
    badge.hidden=!unread;badge.textContent=String(unread);bell.setAttribute('aria-label',`Notifications, ${unread} unread`);
    message.textContent=cached?'Showing cached updates. Connect for the latest notifications.':events.length?'':'No notifications yet. New updates will appear here.';
    for(const item of events) {
        const row=element('li'), button=element('button');button.type='button';button.className=reads.has(item.id)?'notification_item':'notification_item unread';
        button.append(element('strong',item.kind==='new-report'?'New report received':`Report update: ${item.reportStatus}`),element('span',`${item.category} · ${item.barangay}`));
        if(item.kind==='report-update')button.append(element('span','Referral destination: '+(item.referredTo || 'Not assigned')));
        if(item.createdAt?.toDate)button.append(element('small',item.createdAt.toDate().toLocaleString('en-PH',{timeZone:'Asia/Manila'})));
        button.append(element('small',reads.has(item.id)?'View report →':'Unread · View report →'));
        button.addEventListener('click',async()=>{
            const current=generation, viewer=uid;button.disabled=true;
            try {
                if(!navigator.onLine)throw new Error('Reconnect to mark this notification as read and open its report.');
                await setDoc(doc(db,'notificationUsers',viewer,'reads',item.id),{readAt:serverTimestamp()});
                if(current!==generation)return;
                const path=isAdmin?(/^\/admin(?:\/|$)/.test(location.pathname)?new URL('/admin/reports',location.origin):new URL('admin_interface/report_management.html',root)):new URL('interface/tracking_reports.html',root);
                path.hash='report='+encodeURIComponent(item.reportId);
                if(location.href === path.href) window.dispatchEvent(new Event('hashchange'));
                else location.assign(path.href);
                close();
            }catch(error){if(current===generation){message.textContent=error.message||'Could not open notification. Please retry.';button.disabled=false;}}
        });row.append(button);list.append(row);
    }
}
async function start() {
 try {
    const services=await getServices();if(disposed)return;db=services.db;
    authStop = onAuthStateChanged(services.auth,user=>{
        if(disposed)return;
        const current=++generation;clear();uid=user?.uid;
        if(!uid || user.isAnonymous){message.textContent='Sign in to view notifications.';return;}
        const fail=()=>{if(current===generation){++generation;clear();message.textContent='Notifications unavailable. Reconnect and reload to retry.';}};
        const subscribe=()=>{
            stops.push(onSnapshot(query(collection(db,'notifications'),where('kind','==',isAdmin?'new-report':'report-update'),...(isAdmin?[]:[where('recipient','==',uid)])),{includeMetadataChanges:true},snapshot=>{
                if(current!==generation)return;
                events=snapshot.docs.filter(doc=>!doc.metadata.hasPendingWrites).map(doc=>({...doc.data(),id:doc.id})).sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
                cached=snapshot.metadata.fromCache;eventsReady=true;render();
            },fail));
            stops.push(onSnapshot(collection(db,'notificationUsers',uid,'reads'),snapshot=>{
                if(current!==generation)return;reads=new Set(snapshot.docs.map(doc=>doc.id));readsReady=true;render();
            },fail));
        };
        if(isAdmin){let subscribed=false;stops.push(onSnapshot(doc(db,'admins',uid),snapshot=>{
            if(current!==generation || snapshot.metadata.fromCache)return;
            if(!snapshot.exists() || snapshot.data().role!=='Admin'){fail();return;}
            if(!subscribed){subscribed=true;subscribe();}
        },fail));}else subscribe();
    });
 }catch{message.textContent='Notifications unavailable. Reconnect and reload to retry.';}
}
window.addEventListener('pagehide',()=>{disposed=true;++generation;authStop?.();clear();});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
void start();
