"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs-extra"));
const crypto = __importStar(require("crypto"));
const child_process_1 = require("child_process");
// Global variables to keep track of state
let mainWindow = null;
let vpnProcess = null;
// Path to where configs are stored
const CONFIG_DIR = path.join(electron_1.app.getPath('userData'), 'configs');
// Auth files live in the app's own data folder (not the shared temp folder)
// and are deleted as soon as OpenVPN exits.
const AUTH_DIR = path.join(electron_1.app.getPath('userData'), 'auth');
function listConfigs() {
    return __awaiter(this, void 0, void 0, function* () {
        yield fs.ensureDir(CONFIG_DIR); // Make sure folder exists
        const files = yield fs.readdir(CONFIG_DIR);
        // Filter for .ovpn files only
        // Returns list like ['vpnbook-us16-tcp443.ovpn', 'vpnbook-de20-tcp443.ovpn']
        return files.filter(f => f.endsWith('.ovpn'));
    });
}
function removeAuthFile(authPath) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield fs.remove(authPath);
        }
        catch (e) { }
    });
}
// --- 1. SERVER SCANNER ---
electron_1.ipcMain.handle('get-servers', () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        return yield listConfigs();
    }
    catch (e) {
        console.error("Could not scan configs:", e);
        return [];
    }
}));
// --- 2. CONNECT ---
electron_1.ipcMain.handle('connect-vpn', (event_1, _a) => __awaiter(void 0, [event_1, _a], void 0, function* (event, { password, configName }) {
    var _b, _c;
    // Rejections are logged and also returned so the UI can leave the 'Connecting...' state
    const fail = (error) => {
        event.sender.send('vpn-log', error);
        return { ok: false, error };
    };
    // Basic Validation
    if (typeof configName !== 'string' || !configName) {
        return fail('Error: No server selected.');
    }
    // Only accept a config that actually exists in CONFIG_DIR (blocks paths like "..\\..\\evil.ovpn")
    const available = yield listConfigs().catch(() => []);
    if (path.basename(configName) !== configName || !available.includes(configName)) {
        return fail('Error: Invalid server selection.');
    }
    // Password must be a single line, otherwise it could inject extra lines into the auth file
    if (typeof password !== 'string' || !password || /[\r\n]/.test(password)) {
        return fail('Error: Invalid password.');
    }
    const configPath = path.join(CONFIG_DIR, configName);
    // Kill any existing connection before starting a new one
    if (vpnProcess) {
        try {
            vpnProcess.kill();
        }
        catch (e) { }
        vpnProcess = null;
    }
    // Create Auth File (unique name per connection, owner-only permissions where supported)
    yield fs.ensureDir(AUTH_DIR);
    const authPath = path.join(AUTH_DIR, `auth-${crypto.randomBytes(8).toString('hex')}.txt`);
    yield fs.writeFile(authPath, `vpnbook\n${password}`, { mode: 0o600 });
    console.log(`Connecting to ${configName}...`);
    // IMPORTANT: Make sure this path is still correct for your PC
    const openVpnCmd = 'C:\\Program Files\\OpenVPN\\bin\\openvpn.exe';
    try {
        const proc = (0, child_process_1.spawn)(openVpnCmd, [
            '--config', configPath,
            '--auth-user-pass', authPath
        ]);
        vpnProcess = proc;
        (_b = proc.stdout) === null || _b === void 0 ? void 0 : _b.on('data', (d) => {
            const log = d.toString();
            event.sender.send('vpn-log', log);
            if (log.includes('Initialization Sequence Completed')) {
                event.sender.send('vpn-status', 'Connected');
            }
            if (log.includes('AUTH_FAILED')) {
                event.sender.send('vpn-status', 'AuthFailed');
                // Don't kill automatically yet, let user read the error
            }
        });
        (_c = proc.stderr) === null || _c === void 0 ? void 0 : _c.on('data', (d) => console.error(`VPN Error: ${d}`));
        // spawn failures (e.g. openvpn.exe not found) arrive here, not in the catch below
        proc.on('error', (e) => {
            event.sender.send('vpn-log', `CRITICAL ERROR: ${e.message}`);
        });
        // cleanup on exit
        proc.on('close', (code) => {
            console.log(`OpenVPN exited with code ${code}`);
            removeAuthFile(authPath);
            // Ignore exits from an old process that was replaced by a newer connection
            if (vpnProcess === proc) {
                event.sender.send('vpn-status', 'Disconnected');
                vpnProcess = null;
            }
        });
    }
    catch (e) {
        removeAuthFile(authPath);
        return fail(`CRITICAL ERROR: ${e.message}`);
    }
    return { ok: true };
}));
// --- 3. DISCONNECT ---
electron_1.ipcMain.handle('disconnect-vpn', () => __awaiter(void 0, void 0, void 0, function* () {
    if (vpnProcess) {
        vpnProcess.kill();
    }
    return 'Disconnected';
}));
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 500,
        height: 750,
        webPreferences: {
            // The page only talks to the main process through preload.ts
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });
    // Never open new windows or navigate away from the local UI
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
    mainWindow.loadFile(path.join(__dirname, '../src/index.html'));
}
electron_1.app.whenReady().then(() => __awaiter(void 0, void 0, void 0, function* () {
    // Remove any password files left behind by a crash
    yield fs.remove(AUTH_DIR).catch(() => { });
    // ...and the plaintext file older versions of this app left in the temp folder
    yield fs.remove(path.join(electron_1.app.getPath('temp'), 'vpn_auth.txt')).catch(() => { });
    createWindow();
}));
electron_1.app.on('will-quit', () => {
    if (vpnProcess) {
        try {
            vpnProcess.kill();
        }
        catch (e) { }
    }
    // Synchronous so it completes before the app exits
    try {
        fs.removeSync(AUTH_DIR);
    }
    catch (e) { }
});
