"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Expose only the specific actions the UI needs. The page itself gets no
// access to Node or Electron, so injected content can't touch the system.
electron_1.contextBridge.exposeInMainWorld('vpn', {
    getServers: () => electron_1.ipcRenderer.invoke('get-servers'),
    connect: (password, configName) => electron_1.ipcRenderer.invoke('connect-vpn', { password, configName }),
    disconnect: () => electron_1.ipcRenderer.invoke('disconnect-vpn'),
    onStatus: (cb) => {
        electron_1.ipcRenderer.on('vpn-status', (_e, status) => cb(status));
    },
    onLog: (cb) => {
        electron_1.ipcRenderer.on('vpn-log', (_e, log) => cb(log));
    },
});
