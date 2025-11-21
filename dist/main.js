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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
const fs = __importStar(require("fs-extra"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const child_process_1 = require("child_process");
let mainWindow = null;
let vpnProcess = null;
// Headers to trick Cloudflare during config download
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
};
// --- 1. CONFIG DOWNLOADER ---
function downloadConfigs() {
    return __awaiter(this, void 0, void 0, function* () {
        // We try to download the US16 bundle. 
        // If this link dies in the future, change it to another one from vpnbook.com
        const configUrl = 'https://www.vpnbook.com/free-openvpn-account/VPNBook.com-OpenVPN-US16.zip';
        const downloadPath = path.join(electron_1.app.getPath('userData'), 'configs');
        const zipPath = path.join(downloadPath, 'us16.zip');
        yield fs.ensureDir(downloadPath);
        try {
            console.log(`Downloading configs from: ${configUrl}...`);
            const response = yield (0, axios_1.default)({
                method: 'get',
                url: configUrl,
                responseType: 'arraybuffer',
                headers: HEADERS
            });
            yield fs.writeFile(zipPath, response.data);
            const zip = new adm_zip_1.default(zipPath);
            zip.extractAllTo(downloadPath, true);
            console.log("Configs extracted successfully to:", downloadPath);
        }
        catch (error) {
            console.error("Config download failed (likely 403/404). Expected if VPNBook blocked bots.");
            console.error("You can manually download the zip and unzip it into:", downloadPath);
        }
    });
}
// --- 2. VPN CONNECTION LOGIC ---
electron_1.ipcMain.handle('connect-vpn', (event_1, _a) => __awaiter(void 0, [event_1, _a], void 0, function* (event, { password }) {
    var _b, _c;
    const configDir = path.join(electron_1.app.getPath('userData'), 'configs');
    // 1. Check if configs exist
    let files = [];
    try {
        files = yield fs.readdir(configDir);
    }
    catch (e) {
        return event.sender.send('vpn-log', `Error: Config folder missing at ${configDir}`);
    }
    // 2. Find a valid .ovpn file (looks for TCP 443 usually)
    const ovpnFile = files.find(f => f.includes('tcp443') && f.endsWith('.ovpn'));
    if (!ovpnFile) {
        event.sender.send('vpn-log', 'Error: No .ovpn file found! Please download configs manually.');
        event.sender.send('vpn-log', `Please unzip VPNBook configs into: ${configDir}`);
        return;
    }
    const configPath = path.join(configDir, ovpnFile);
    const authPath = path.join(electron_1.app.getPath('temp'), 'vpn_auth.txt');
    // 3. Write credentials
    // Username is always 'vpnbook' for this provider
    yield fs.writeFile(authPath, `vpnbook\n${password}`);
    console.log(`Connecting to ${ovpnFile}...`);
    // 4. Spawn OpenVPN
    // IMPORTANT: Ensure this path matches your OpenVPN installation
    const openVpnCmd = 'C:\\Program Files\\OpenVPN\\bin\\openvpn.exe';
    if (vpnProcess)
        vpnProcess.kill();
    try {
        vpnProcess = (0, child_process_1.spawn)(openVpnCmd, [
            '--config', configPath,
            '--auth-user-pass', authPath
        ]);
        // 5. Handle Logs
        (_b = vpnProcess.stdout) === null || _b === void 0 ? void 0 : _b.on('data', (d) => {
            const log = d.toString();
            event.sender.send('vpn-log', log);
            if (log.includes('Initialization Sequence Completed')) {
                event.sender.send('vpn-status', 'Connected');
            }
            if (log.includes('AUTH_FAILED')) {
                event.sender.send('vpn-status', 'AuthFailed');
                vpnProcess === null || vpnProcess === void 0 ? void 0 : vpnProcess.kill();
            }
        });
        (_c = vpnProcess.stderr) === null || _c === void 0 ? void 0 : _c.on('data', (d) => console.error(`VPN Error: ${d}`));
    }
    catch (e) {
        event.sender.send('vpn-log', `CRITICAL ERROR: Could not start OpenVPN. Is it installed? \n${e.message}`);
    }
}));
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 500,
        height: 700,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    mainWindow.loadFile(path.join(__dirname, '../src/index.html'));
    // Try to download configs on launch
    downloadConfigs();
}
electron_1.app.whenReady().then(createWindow);
