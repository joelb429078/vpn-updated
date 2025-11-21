import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import axios from 'axios';
import * as fs from 'fs-extra';
import AdmZip from 'adm-zip';
import { spawn, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let vpnProcess: ChildProcess | null = null;

// Headers to trick Cloudflare during config download
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
};

// --- 1. CONFIG DOWNLOADER ---
async function downloadConfigs() {
    // We try to download the US16 bundle. 
    // If this link dies in the future, change it to another one from vpnbook.com
    const configUrl = 'https://www.vpnbook.com/free-openvpn-account/VPNBook.com-OpenVPN-US16.zip';
    const downloadPath = path.join(app.getPath('userData'), 'configs');
    const zipPath = path.join(downloadPath, 'us16.zip');

    await fs.ensureDir(downloadPath);

    try {
        console.log(`Downloading configs from: ${configUrl}...`);
        const response = await axios({
            method: 'get',
            url: configUrl,
            responseType: 'arraybuffer',
            headers: HEADERS
        });
        await fs.writeFile(zipPath, response.data);
        
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(downloadPath, true);
        console.log("Configs extracted successfully to:", downloadPath);
    } catch (error: any) {
        console.error("Config download failed (likely 403/404). Expected if VPNBook blocked bots.");
        console.error("You can manually download the zip and unzip it into:", downloadPath);
    }
}

// --- 2. VPN CONNECTION LOGIC ---
ipcMain.handle('connect-vpn', async (event, { password }) => {
    const configDir = path.join(app.getPath('userData'), 'configs');
    
    // 1. Check if configs exist
    let files: string[] = [];
    try {
        files = await fs.readdir(configDir);
    } catch (e) {
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
    const authPath = path.join(app.getPath('temp'), 'vpn_auth.txt');
    
    // 3. Write credentials
    // Username is always 'vpnbook' for this provider
    await fs.writeFile(authPath, `vpnbook\n${password}`);

    console.log(`Connecting to ${ovpnFile}...`);

    // 4. Spawn OpenVPN
    // IMPORTANT: Ensure this path matches your OpenVPN installation
    const openVpnCmd = 'C:\\Program Files\\OpenVPN\\bin\\openvpn.exe';
    
    if (vpnProcess) vpnProcess.kill();

    try {
        vpnProcess = spawn(openVpnCmd, [
            '--config', configPath,
            '--auth-user-pass', authPath
        ]);

        // 5. Handle Logs
        vpnProcess.stdout?.on('data', (d) => {
            const log = d.toString();
            event.sender.send('vpn-log', log);
            
            if (log.includes('Initialization Sequence Completed')) {
                event.sender.send('vpn-status', 'Connected');
            }
            if (log.includes('AUTH_FAILED')) {
                event.sender.send('vpn-status', 'AuthFailed');
                vpnProcess?.kill();
            }
        });

        vpnProcess.stderr?.on('data', (d) => console.error(`VPN Error: ${d}`));
        
    } catch (e: any) {
        event.sender.send('vpn-log', `CRITICAL ERROR: Could not start OpenVPN. Is it installed? \n${e.message}`);
    }
});

function createWindow() {
    mainWindow = new BrowserWindow({
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

app.whenReady().then(createWindow);