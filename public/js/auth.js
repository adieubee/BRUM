/* BRUMS authentication: short-lived server-validated sessions with idle warnings. */
const Auth = {
    _idleMs: 20 * 60 * 1000,
    _warningMs: 2 * 60 * 1000,
    _lastInteraction: Date.now(),
    _checking: null,
    getUser() { try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch { return null; } },
    getToken() { return (localStorage.getItem('authToken') || '').trim().replace(/^Bearer\s+/i,''); },
    authHeaders(extra = {}) {
        const h = { 'Content-Type':'application/json', ...extra };
        delete h.Authorization; delete h.authorization;
        if(this.getToken()) h.Authorization = 'Bearer ' + this.getToken();
        return h;
    },
    async login(username,password) {
        try {
            const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
            const data=await r.json();
            if(!data.success) return {success:false,message:data.message||'Login failed.',retry_after_seconds:data.retry_after_seconds};
            localStorage.setItem('currentUser',JSON.stringify(data.user));
            localStorage.setItem('authToken',data.token);
            this._lastInteraction=Date.now();
            return {success:true,role:data.role,user:data.user};
        }catch(err){return {success:false,message:'Cannot connect to login service.'};}
    },
    async register(name,username,email,password) {
        try {
            const r=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,username,email,password})});
            const data=await r.json();
            if(!data.success)return {success:false,message:data.message||'Registration failed.'};
            localStorage.setItem('currentUser',JSON.stringify(data.user));
            localStorage.setItem('authToken',data.token);
            this._lastInteraction=Date.now();
            return {success:true};
        }catch(err){return {success:false,message:'Cannot connect to registration service.'};}
    },
    async logout(message='') {
        const token=this.getToken();
        // The server session is revoked even if another tab still has the old token.
        if(token){try {await fetch('/api/auth/logout',{method:'POST',headers:this.authHeaders(),keepalive:true});}catch(_){}}
        localStorage.removeItem('currentUser'); localStorage.removeItem('authToken');
        const isNested=/\/(client|admin|staff)\//.test(window.location.pathname);
        window.location.replace((isNested?'../':'')+'login.html'+(message?'?expired=1':''));
    },
    async me() {
        if(!this.getToken())return null;
        if(this._checking)return this._checking;
        this._checking=(async()=>{
            try{
                const r=await fetch('/api/auth/me',{headers:this.authHeaders(),cache:'no-store'});
                if(!r.ok)return null;
                const data=await r.json();
                if(data.success) localStorage.setItem('currentUser',JSON.stringify({...this.getUser(),...data.user}));
                return data.success?data.user:null;
            }catch(_){return undefined;} // Offline: do not guess the validity of the session.
            finally{this._checking=null;}
        })();
        return this._checking;
    },
    async apiFetch(url,options={}) {
        try{
            const r=await fetch(url,{...options,headers:this.authHeaders(options.headers||{}),cache:'no-store'});
            if(r.status===401 && this.getToken() && /\/(admin|staff|client)\//.test(location.pathname)){
                this.notify('Your session is no longer valid. Please sign in again.');
                this.logout('expired');
                return null;
            }
            return r;
        }catch(err){console.error('Request failed:',url,err);throw err;}
    },
    requireLogin(){
        if(!this.getUser()||!this.getToken())this.logout('expired');
    },
    notify(message){
        let el=document.getElementById('brumsToast');
        if(!el){el=document.createElement('div');el.id='brumsToast';el.setAttribute('role','status');el.style.cssText='position:fixed;bottom:20px;right:20px;z-index:99999;background:#8b2d2d;color:#fff;padding:16px 22px;border-radius:10px;max-width:340px;box-shadow:0 5px 24px #3335;font:14px system-ui';document.body.appendChild(el);}
        el.textContent=message;
    },
    startSessionWatch(){
        const isProtected=/\/(admin|staff|client)\//.test(location.pathname);
        if(!isProtected)return;
        const user=this.getUser();
        if(!user||!this.getToken()){this.logout('expired');return;}
        const isAllowed=location.pathname.includes('/admin/')?user.role==='admin':location.pathname.includes('/staff/')?user.role==='staff':user.role==='client';
        if(!isAllowed){this.logout('expired');return;}
        this.me().then(current=>{if(current===null)this.logout('expired');else if(current && current.role!==user.role)this.logout('expired');});
        for(const name of ['click','keydown','pointerdown','touchstart'])document.addEventListener(name,()=>{this._lastInteraction=Date.now();},{passive:true});
        const warning=document.createElement('div');warning.id='brumsIdleWarning';
        warning.style.cssText='position:fixed;bottom:22px;left:22px;z-index:100000;max-width:340px;background:#fff;border:2px solid #8b2d2d;color:#222;border-radius:12px;padding:18px;box-shadow:0 5px 20px #3334;display:none;font:14px system-ui';
        const line=document.createElement('p');line.textContent='Your session will expire soon due to inactivity.';
        const btn=document.createElement('button');btn.textContent='Stay signed in';btn.type='button';btn.style.cssText='background:#8b2d2d;color:white;padding:9px 15px;border:0;border-radius:6px;cursor:pointer';
        btn.onclick=async()=>{const current=await this.me();if(current){this._lastInteraction=Date.now();warning.style.display='none';this.notify('Session extended.');}else this.logout('expired');};
        warning.append(line,btn);document.body.appendChild(warning);
        window.setInterval(()=>{
            const idle=Date.now()-this._lastInteraction;
            if(idle>=this._idleMs){this.logout('expired');return;}
            warning.style.display=idle>=this._idleMs-this._warningMs?'block':'none';
        },15000);
        // A long-idle background tab expires on returning to focus.
        document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-this._lastInteraction>=this._idleMs)this.logout('expired');});
    }
};
document.addEventListener('DOMContentLoaded',()=>Auth.startSessionWatch());
