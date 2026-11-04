// UI logic. Runs with no Node access; talks to the main process only
// through the `window.vpn` API defined in preload.ts.

const $ = (id) => document.getElementById(id);
const serverList = $('serverList');
const passwordInput = $('password');
const actionBtn = $('actionBtn');
const statusEl = $('status');
const substatusEl = $('substatus');
const pill = $('pill');
const logsEl = $('logs');

const COUNTRIES = { us: 'United States', ca: 'Canada', de: 'Germany', fr: 'France', pl: 'Poland', uk: 'United Kingdom' };
const LAST_SERVER_KEY = 'lastServer';

// State Tracking: 'disconnected' | 'connecting' | 'connected' | 'error'
let state = 'disconnected';
let connectedAt = 0;
let timer = null;

// "vpnbook-us16-tcp443.ovpn" -> "United States · US16 · TCP 443"
function prettyServer(file) {
    const name = file.replace(/\.ovpn$/i, '');
    const m = name.match(/([a-z]{2})(\d+)-(tcp|udp)(\d+)/i);
    if (!m) return name;
    const [, cc, num, proto, port] = m;
    const country = COUNTRIES[cc.toLowerCase()] || cc.toUpperCase();
    return `${country} · ${cc.toUpperCase()}${num} · ${proto.toUpperCase()} ${port}`;
}

function formatDuration(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function setState(next, message) {
    state = next;
    document.body.dataset.state = next;

    const locked = next === 'connecting' || next === 'connected';
    serverList.disabled = locked;
    passwordInput.disabled = locked;
    actionBtn.disabled = next === 'connecting';
    actionBtn.setAttribute('aria-label', next === 'connected' ? 'Disconnect' : 'Connect');

    clearInterval(timer);
    timer = null;

    const server = serverList.selectedOptions[0]?.text || '';
    if (next === 'connected') {
        pill.textContent = 'Protected';
        statusEl.textContent = 'Connected';
        connectedAt = Date.now();
        const tick = () => { substatusEl.textContent = `${server}  ·  ${formatDuration(Date.now() - connectedAt)}`; };
        tick();
        timer = setInterval(tick, 1000);
    } else if (next === 'connecting') {
        pill.textContent = 'Connecting';
        statusEl.textContent = 'Connecting...';
        substatusEl.textContent = server;
    } else if (next === 'error') {
        pill.textContent = 'Error';
        statusEl.textContent = 'Connection failed';
        substatusEl.textContent = message || 'Check the log below';
    } else {
        pill.textContent = 'Off';
        statusEl.textContent = 'Not connected';
        substatusEl.textContent = message || 'Pick a server and press the button';
    }
}

function appendLog(text, cls) {
    const empty = logsEl.querySelector('.empty');
    if (empty) empty.remove();
    const atBottom = logsEl.scrollHeight - logsEl.scrollTop - logsEl.clientHeight < 30;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const div = document.createElement('div');
        div.textContent = line;
        if (cls) div.className = cls;
        else if (/error|fail/i.test(line)) div.className = 'err';
        else if (/Initialization Sequence Completed/.test(line)) div.className = 'ok';
        logsEl.appendChild(div);
    }
    if (atBottom) logsEl.scrollTop = logsEl.scrollHeight;
}

// --- 1. LOAD SERVER LIST ON STARTUP ---
async function loadServers() {
    const servers = await window.vpn.getServers();
    serverList.innerHTML = ''; // Clear "Loading..."

    if (servers.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.text = 'No configs found (download manually)';
        serverList.add(opt);
        substatusEl.textContent = 'Add .ovpn files to the configs folder';
        return;
    }

    servers.forEach(file => {
        const opt = document.createElement('option');
        opt.value = file;
        opt.text = prettyServer(file);
        serverList.add(opt);
    });

    // Restore the last server used (the password is never stored)
    try {
        const last = localStorage.getItem(LAST_SERVER_KEY);
        if (last && servers.includes(last)) serverList.value = last;
    } catch (e) {}
}

// --- 2. MAIN BUTTON LOGIC ---
async function toggleConnection() {
    if (state === 'connected') {
        // UI updates happen in the onStatus listener below
        window.vpn.disconnect();
        return;
    }
    if (state === 'connecting') return;

    const password = passwordInput.value.trim();
    const configName = serverList.value;

    if (!configName) return setState('error', 'Please select a valid server');
    if (!password) {
        passwordInput.focus();
        return setState('error', 'Please enter the password');
    }

    try { localStorage.setItem(LAST_SERVER_KEY, configName); } catch (e) {}

    setState('connecting');
    appendLog(`Connecting to ${prettyServer(configName)}...`, 'ok');

    const result = await window.vpn.connect(password, configName);
    if (result && result.ok === false) setState('error', result.error);
}

actionBtn.addEventListener('click', toggleConnection);
passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') toggleConnection(); });
serverList.addEventListener('change', () => { if (state === 'error') setState('disconnected'); });

$('togglePw').addEventListener('click', () => {
    const show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    $('togglePw').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

$('clearLogs').addEventListener('click', () => {
    logsEl.innerHTML = '<div class="empty">Logs cleared</div>';
});

// --- 3. LISTEN FOR EVENTS ---
window.vpn.onStatus((status) => {
    if (status === 'Connected') {
        setState('connected');
    } else if (status === 'AuthFailed') {
        setState('error', 'Auth failed: check the password');
    } else if (status === 'Disconnected') {
        // Keep an auth error on screen when OpenVPN exits after it
        if (state !== 'error') setState('disconnected', 'Disconnected');
    }
});

window.vpn.onLog((log) => appendLog(log));

loadServers();
