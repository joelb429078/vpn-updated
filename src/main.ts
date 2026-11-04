import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';

// Global variables to keep track of state
let mainWindow: BrowserWindow | null = null;
let vpnProcess: ChildProcess | null = null;

// Path to where configs are stored
const CONFIG_DIR = path.join(app.getPath('userData'), 'configs');

// Auth files live in the app's own data folder (not the shared temp folder)
// and are deleted as soon as OpenVPN exits.
const AUTH_DIR = path.join(app.getPath('userData'), 'auth');

async function listConfigs(): Promise<string[]> {
    await fs.ensureDir(CONFIG_DIR); // Make sure folder exists
    const files = await fs.readdir(CONFIG_DIR);
    // Filter for .ovpn files only
    // Returns list like ['vpnbook-us16-tcp443.ovpn', 'vpnbook-de20-tcp443.ovpn']
    return files.filter(f => f.endsWith('.ovpn'));
}

async function removeAuthFile(authPath: string) {
    try { await fs.remove(authPath); } catch (e) {}
}

// --- 1. SERVER SCANNER ---
ipcMain.handle('get-servers', async () => {
    try {
        return await listConfigs();
    } catch (e) {
        console.error("Could not scan configs:", e);
        return [];
    }
});

// --- 2. CONNECT ---
ipcMain.handle('connect-vpn', async (event, { password, configName }) => {
    // Rejections are logged and also returned so the UI can leave the 'Connecting...' state
    const fail = (error: string) => {
        event.sender.send('vpn-log', error);
        return { ok: false, error };
    };

    // Basic Validation
    if (typeof configName !== 'string' || !configName) {
        return fail('Error: No server selected.');
    }
    // Only accept a config that actually exists in CONFIG_DIR (blocks paths like "..\\..\\evil.ovpn")
    const available = await listConfigs().catch(() => [] as string[]);
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
        try { vpnProcess.kill(); } catch(e) {}
        vpnProcess = null;
    }

    // Create Auth File (unique name per connection, owner-only permissions where supported)
    await fs.ensureDir(AUTH_DIR);
    const authPath = path.join(AUTH_DIR, `auth-${crypto.randomBytes(8).toString('hex')}.txt`);
    await fs.writeFile(authPath, `vpnbook\n${password}`, { mode: 0o600 });

    console.log(`Connecting to ${configName}...`);

    // IMPORTANT: Make sure this path is still correct for your PC
    const openVpnCmd = 'C:\\Program Files\\OpenVPN\\bin\\openvpn.exe';

    try {
        const proc = spawn(openVpnCmd, [
            '--config', configPath,
            '--auth-user-pass', authPath
        ]);
        vpnProcess = proc;

        proc.stdout?.on('data', (d) => {
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

        proc.stderr?.on('data', (d) => console.error(`VPN Error: ${d}`));

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

    } catch (e: any) {
        removeAuthFile(authPath);
        return fail(`CRITICAL ERROR: ${e.message}`);
    }
    return { ok: true };
});

// --- 3. DISCONNECT ---
ipcMain.handle('disconnect-vpn', async () => {
    if (vpnProcess) {
        vpnProcess.kill();
    }
    return 'Disconnected';
});

function createWindow() {
    mainWindow = new BrowserWindow({
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

app.whenReady().then(async () => {
    // Remove any password files left behind by a crash
    await fs.remove(AUTH_DIR).catch(() => {});
    // ...and the plaintext file older versions of this app left in the temp folder
    await fs.remove(path.join(app.getPath('temp'), 'vpn_auth.txt')).catch(() => {});
    createWindow();
});

app.on('will-quit', () => {
    if (vpnProcess) {
        try { vpnProcess.kill(); } catch (e) {}
    }
    // Synchronous so it completes before the app exits
    try { fs.removeSync(AUTH_DIR); } catch (e) {}
});
