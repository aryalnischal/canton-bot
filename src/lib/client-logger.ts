// Client-Side Logger that forwards to /api/log
// Use this instead of console.log for critical events.

const sendLog = async (level: string, message: string, meta: any = {}) => {
    // 1. Always Log to Browser Console (for DevTools)
    const style = level === 'error' ? 'color: red; font-weight: bold' :
        level === 'warn' ? 'color: orange' : 'color: cyan';
    console.log(`%c[APP] ${message}`, style, meta);

    // 2. Dispatch to UI (Activity Log)
    if (typeof window !== 'undefined') {
        const event = new CustomEvent('canton-log', {
            detail: { timestamp: Date.now(), level, message, meta }
        });
        window.dispatchEvent(event);
    }

    // 3. Forward to Server (Fire and Forget)
    try {
        fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level, message, ...meta })
        }).catch(err => {
            // Squelch network errors to prevent loops
            console.warn("Log upload failed", err);
        });
    } catch (e) { }
};

export const clientLogger = {
    info: (msg: string, meta?: any) => sendLog('info', msg, meta),
    warn: (msg: string, meta?: any) => sendLog('warn', msg, meta),
    error: (msg: string, meta?: any) => sendLog('error', msg, meta),
    // Critical Trade Events
    trade: (msg: string, meta?: any) => sendLog('crit', msg, meta),
};
