const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const PHONE_NUMBERS = [
    "8801787686086",
    "8801717583501"
];

const MESSAGE =
    "Hello Anwar Sir. Notification server is ok. The Message is Coming From VPS.";

const TIME_ZONE = "Asia/Dhaka";
const SCHEDULE_HOURS = [10, 22];

// Create WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: "/app/.wwebjs_auth"
    }),
    puppeteer: {
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox"
        ]
    }
});

let scheduleTimer = null;
let isReady = false;
let isSending = false;

// QR code
client.on("qr", (qr) => {
    console.log("Scan this QR code with WhatsApp:");
    qrcode.generate(qr, { small: true });
});

// Authentication
client.on("authenticated", () => {
    console.log("WhatsApp authenticated successfully.");
});

// Ready
client.on("ready", () => {
    console.log("WhatsApp client is ready.");

    if (isReady) {
        console.log("Schedule already active; ignoring duplicate ready event.");
        return;
    }

    isReady = true;

    console.log(
        "Daily schedule: 10:00 AM and 10:00 PM Asia/Dhaka."
    );

    scheduleNextMessage();
});

// Authentication failure
client.on("auth_failure", (message) => {
    console.error("Authentication failed:", message);
});

// Disconnected
client.on("disconnected", (reason) => {
    console.log("WhatsApp disconnected:", reason);

    isReady = false;

    if (scheduleTimer !== null) {
        clearTimeout(scheduleTimer);
        scheduleTimer = null;
    }
});

// Get current Bangladesh date and time
function getDhakaTimeParts() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date());

    return Object.fromEntries(
        parts
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, Number(part.value)])
    );
}

// Find the next 10 AM or 10 PM Bangladesh time
function getNextScheduledTime() {
    const dhaka = getDhakaTimeParts();

    // Convert Bangladesh wall-clock components to a UTC-based
    // representation so daily scheduling is independent of VPS timezone.
    const dhakaDateAsUtc = Date.UTC(
        dhaka.year,
        dhaka.month - 1,
        dhaka.day
    );

    const now = new Date();

    for (const hour of SCHEDULE_HOURS) {
        const targetUtc =
            dhakaDateAsUtc +
            hour * 60 * 60 * 1000 -
            6 * 60 * 60 * 1000;

        if (targetUtc > now.getTime()) {
            return new Date(targetUtc);
        }
    }

    // Both scheduled times have passed today.
    // Schedule tomorrow at 10 AM Bangladesh time.
    const tomorrowAt10Utc =
        dhakaDateAsUtc +
        24 * 60 * 60 * 1000 +
        10 * 60 * 60 * 1000 -
        6 * 60 * 60 * 1000;

    return new Date(tomorrowAt10Utc);
}

// Schedule the next notification
function scheduleNextMessage() {
    if (!isReady || !client.info) {
        console.log("WhatsApp is not ready; scheduling paused.");
        return;
    }

    if (scheduleTimer !== null) {
        clearTimeout(scheduleTimer);
        scheduleTimer = null;
    }

    const nextTime = getNextScheduledTime();
    const delay = Math.max(1000, nextTime.getTime() - Date.now());

    console.log(
        `Next notification: ${nextTime.toLocaleString("en-GB", {
            timeZone: TIME_ZONE,
            dateStyle: "medium",
            timeStyle: "medium"
        })} (${TIME_ZONE})`
    );

    scheduleTimer = setTimeout(async () => {
        scheduleTimer = null;

        try {
            await sendMessages();
        } finally {
            // Schedule the next run only if WhatsApp remains ready.
            if (isReady && client.info) {
                scheduleNextMessage();
            }
        }
    }, delay);
}

// Send the message to both recipients
async function sendMessages() {
    if (!isReady || !client.info) {
        console.log("WhatsApp is not ready. Skipping this send.");
        return;
    }

    if (isSending) {
        console.log("A previous send is still running. Skipping this run.");
        return;
    }

    isSending = true;

    try {
        for (const phoneNumber of PHONE_NUMBERS) {
            // Stop sending if WhatsApp disconnects mid-run.
            if (!isReady || !client.info) {
                console.log("WhatsApp disconnected. Stopping this send cycle.");
                break;
            }

            const chatId = `${phoneNumber}@c.us`;

            try {
                console.log(`Sending message to ${phoneNumber}...`);

                await client.sendMessage(chatId, MESSAGE);

                console.log(
                    `Message sent successfully to ${phoneNumber}.`
                );
            } catch (error) {
                console.error(
                    `Failed to send message to ${phoneNumber}:`,
                    error.message || error
                );
            }
        }
    } finally {
        isSending = false;
    }
}

// Initialize the client once
client.initialize();