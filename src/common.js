"use strict";


const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

class WebSocketError extends Error {}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- WhatsApp ----------

// Starts one WhatsApp Web session for a service and returns send(msg).
// Each service has its own clientId => its own saved login (scan QR once per service).
function startWhatsApp(serviceName, numbers, log) {
    const dataPath = process.env.WWEBJS_AUTH_PATH || path.join(process.cwd(), ".wwebjs_auth");

    // Remove stale Chromium lock files left by a previous container run
    const sessionDir = path.join(dataPath, `session-${serviceName}`);
    for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
        try { fs.rmSync(path.join(sessionDir, f), { force: true }); } catch (e) { /* ignore */ }
    }

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: serviceName, dataPath }),
        puppeteer: {
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu"
            ]
        }
    });

    let readyResolve;
    const readyPromise = new Promise((resolve) => { readyResolve = resolve; });

    client.on("qr", (qr) => {
        log("📱 Scan this QR code with WhatsApp (Linked devices):");
        qrcode.generate(qr, { small: true });
    });
    client.on("authenticated", () => log("🔐 WhatsApp authenticated successfully."));
    client.on("ready", () => {
        log("✅ WhatsApp client is ready.");
        readyResolve();
    });
    // On failure/disconnect exit, Docker (restart: always) starts it again
    client.on("auth_failure", (m) => { log("❌ WhatsApp authentication failed:", m); process.exit(1); });
    client.on("disconnected", (reason) => { log("⚠️ WhatsApp disconnected:", reason); process.exit(1); });

    client.initialize().catch((e) => {
        log("❌ WhatsApp initialize error:", e && e.message ? e.message : e);
        process.exit(1);
    });

    // Sends msg to every number, one after another (same order as the list)
    return async function sendWhatsappSms(msg) {
        await readyPromise; // wait until WhatsApp is logged in
        for (const num of numbers) {
            const chatId = `${num.replace(/\D/g, "")}@c.us`;
            try {
                log(`📤 Sending WhatsApp message to ${num} ...`);
                await client.sendMessage(chatId, msg);
                log(`✅ WhatsApp message sent to ${num}`);
            } catch (e) {
                log(`❌ Failed to send WhatsApp message to ${num}:`, e && e.message ? e.message : e);
            }
        }
    };
}

// ---------- WebSocket (recv() style) ----------

class Connection {
    constructor(ws) {
        this.ws = ws;
        this.queue = [];
        this.waiters = [];
        this.closed = false;
        this.pingTimer = null;
        this.pongTimer = null;

        ws.on("message", (data) => {
            const m = data.toString();
            const w = this.waiters.shift();
            if (w) w.resolve(m); else this.queue.push(m);
        });
        ws.on("error", () => { /* 'close' event follows */ });
        ws.on("close", (code) => {
            this.closed = true;
            clearInterval(this.pingTimer);
            clearTimeout(this.pongTimer);
            const err = new WebSocketError(`connection closed (code ${code})`);
            while (this.waiters.length) this.waiters.shift().reject(err);
        });
    }

    // ping every 30s, drop connection if no pong within 20s
    startHeartbeat() {
        this.ws.on("pong", () => clearTimeout(this.pongTimer));
        this.pingTimer = setInterval(() => {
            if (this.ws.readyState !== WebSocket.OPEN) return;
            this.ws.ping();
            this.pongTimer = setTimeout(() => this.ws.terminate(), 20000);
        }, 30000);
    }

    // Wait for next message; rejects when the connection is closed
    recv() {
        if (this.queue.length) return Promise.resolve(this.queue.shift());
        if (this.closed) return Promise.reject(new WebSocketError("connection closed"));
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    }

    // Close from our side (drops anything not yet read)
    async close() {
        this.queue.length = 0;
        if (this.closed) return;
        await new Promise((resolve) => {
            this.ws.once("close", resolve);
            this.ws.close();
        });
    }

    terminate() {
        try { this.ws.terminate(); } catch (e) { /* ignore */ }
    }
}

function connectWebSocket(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, { handshakeTimeout: 20000 });
        const conn = new Connection(ws);
        ws.once("open", () => { conn.startHeartbeat(); resolve(conn); });
        ws.once("error", (err) => reject(new WebSocketError(`connect failed: ${err.message}`)));
    });
}

// AUTO RECONNECT LOOP (while true + try/catch).
// onMessage(msg, ws) is called one message at a time, in order.
async function runWebSocketLoop(url, log, onMessage) {
    while (true) {
        let ws = null;
        try {
            log("🔄 Connecting to server...", url);
            ws = await connectWebSocket(url);
            log("✅ WebSocket Connected");
            while (true) {
                const msg = await ws.recv();
                log("[RECEIVED]", msg);
                await onMessage(msg, ws);
            }
        } catch (e) {
            if (e instanceof WebSocketError) {
                log("⚠️ WebSocket error:", e.message);
                log("♻️ Reconnecting in 5 seconds...\n");
            } else {
                log("❌ Unexpected error:", e && e.message ? e.message : e);
            }
            if (ws) ws.terminate();
            await sleep(5000);
        }
    }
}

// Process shutdown (docker stop)
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

module.exports = {
    sleep, WebSocketError,
    startWhatsApp, runWebSocketLoop
};
