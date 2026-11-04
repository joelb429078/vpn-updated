import { contextBridge, ipcRenderer } from 'electron';

// Expose only the specific actions the UI needs. The page itself gets no
// access to Node or Electron, so injected content can't touch the system.
contextBridge.exposeInMainWorld('vpn', {
    getServers: (): Promise<string[]> => ipcRenderer.invoke('get-servers'),
    connect: (password: string, configName: string) =>
        ipcRenderer.invoke('connect-vpn', { password, configName }),
    disconnect: () => ipcRenderer.invoke('disconnect-vpn'),
    onStatus: (cb: (status: string) => void) => {
        ipcRenderer.on('vpn-status', (_e, status: string) => cb(status));
    },
    onLog: (cb: (log: string) => void) => {
        ipcRenderer.on('vpn-log', (_e, log: string) => cb(log));
    },
});
