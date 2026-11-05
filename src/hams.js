"use strict";

const { sleep, startWhatsApp, runWebSocketLoop } = require("./common");
function makeLogger(tag) {
    return (...args) => {
        const ts = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Dhaka" });
        console.log(`[${tag}] [${ts}]`, ...args);
    };
}



function idx(arr, i) {
    if (i >= arr.length) throw new RangeError("list index out of range");
    return arr[i];
}

// int("12") -> 12, int("abc") -> raises
function toInt(v) {
    const s = String(v).trim();
    if (!/^[+-]?\d+$/.test(s)) throw new TypeError(`invalid literal for int(): '${v}'`);
    return parseInt(s, 10);
}

// float("12.5") -> 12.5, float("abc") -> raises
function toFloat(v) {
    const s = String(v).trim();
    if (/^[+-]?(inf|infinity)$/i.test(s)) return s.startsWith("-") ? -Infinity : Infinity;
    if (/^[+-]?nan$/i.test(s)) return NaN;
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) {
        throw new TypeError(`could not convert string to float: '${v}'`);
    }
    return Number(s);
}


// ================= IPDU PORT HELPERS =================
// ---------- IPDU port logic shared by HAMS (HO) and HAMS FAC ----------
// S holds all ipdu counters/status values (names like
// e.g. S.ipdu1p2_counter, S.ipdu1p2_status, S.previous_ipdu1p2_status).

function logIpdu(log, n, raw, arr) {
    log(`IPDU${n}: `, raw);
    for (let p = 1; p <= 8; p++) log(`IPDU${n}${p}=`, idx(arr, p + 1));
}

// Port 1 of each IPDU. Note: the `else:` is attached to
// `if (HO_msg[n]):` (not to the port check) - kept as original.
function firstPort(S, log, name, outerTruthy, raw, c) {
    const c0 = `${name}_counter`, c1 = `${name}_counter1`;
    const st = `${name}_status`, pv = `previous_${name}_status`;
    const setMsg = (t) => { S.notification_msg = c.assign ? t : S.notification_msg + t; };
    if (outerTruthy) {
        if (String(raw) === "0") {
            S[c1] = 0;
            if (S[c0] < c.inc) S[c0] = S[c0] + 1;
            if (S[c0] >= c.failAt) {
                S[c0] = 0;
                S[st] = 0;
                if (S[st] !== S[pv]) {
                    setMsg(c.failText);
                    S[pv] = S[st];
                }
                log(`${st} value: `, S[st]);
            }
        }
    } else {
        S[c0] = 0;
        if (S[c1] < c.elseInc) S[c1] = S[c1] + 1;
        if (S[c1] >= c.elseAt) {
            S[c1] = 0;
            S[st] = c.okStatus;
            if (S[st] !== S[pv]) {
                setMsg(c.okText);
                S[pv] = S[st];
            }
            log(`${st} value: `, S[st]);
        }
    }
}

// Ports 2..8 of each IPDU.
// opts.alsoZero : also set this status to 0 on failure (ipdu2p5 does that to ipdu2p4_status)
// opts.noGate   : status=0 / message happen without waiting for the counter (ipdu2p7 quirk)
function stdPort(S, log, name, raw, okStatus, failText, okText, opts = {}) {
    if (raw === undefined) return; // this IPDU has no data in the message: skip its port checks
    const c0 = `${name}_counter`, c1 = `${name}_counter1`;
    const st = `${name}_status`, pv = `previous_${name}_status`;
    if (String(raw) === "0") {
        S[c1] = 0;
        if (S[c0] < 3) S[c0] = S[c0] + 1;
        if (opts.noGate) {
            if (S[c0] >= 3) S[c0] = 0;
            S[st] = 0;
            if (S[st] !== S[pv]) {
                S.notification_msg = S.notification_msg + failText;
                S[pv] = S[st];
            }
            log(`${st} value: `, S[st]);
        } else if (S[c0] >= 3) {
            S[c0] = 0;
            S[st] = 0;
            if (opts.alsoZero) S[opts.alsoZero] = 0;
            if (S[st] !== S[pv]) {
                S.notification_msg = S.notification_msg + failText;
                S[pv] = S[st];
            }
            log(`${st} value: `, S[st]);
        }
    } else {
        S[st] = okStatus;
        if (S[st] !== S[pv]) {
            S.notification_msg = S.notification_msg + okText;
            S[pv] = S[st];
        }
        log(`${st} value: `, S[st]);
    }
}

// Creates the ipdu state object (all counters/status start at 0)
function makeIpduState() {
    const S = { notification_msg: "", ipdu1_status: 0, ipdu2_status: 0, ipdu3_status: 0 };
    for (let d = 1; d <= 3; d++) {
        for (let p = 1; p <= 8; p++) {
            const n = `ipdu${d}p${p}`;
            S[`${n}_counter`] = 0;
            S[`${n}_counter1`] = 0;
            S[`${n}_status`] = 0;
            S[`previous_${n}_status`] = 0;
        }
    }
    return S;
}



const SERVER_URL = "ws://27.147.170.162:81";

const NUMBERS = [
    // "+8801612777111",
    // "+8801787686086",
    // "+8801792626679",
    // "+8801950848935",
    // "+8801762118356",
    // "+8801779463727"
    "+8801717583501"

];

const log = makeLogger("HAMS");
const sendWhatsappSms = startWhatsApp("hams", NUMBERS, log);

// ================= GLOBAL VARIABLES =================
let HO_msg = "";
let FAC1_msg = "";
let gencounter = 0;
let firecounter = 0;
let previous_status = 0;
let present_status = 0;
let notification_msg_gd = "";

// ipdu1/2/3 counters + statuses + notification_msg live in S
const S = makeIpduState();

let ipdu1, ipdu2, ipdu3, GD; // keep last parsed values between messages

let input_voltage_status = 0;
let ups1_status = 0;
let ups2_status = 0;
let batt1_status = 0;
let temp1_status = 0;
let humiid1_status = 0;
let water_leakage_status = 0;
let fire_status = 0;
let generator_status = 0;
let ups1_cb_status = 0;
let ups2_cb_status = 0;
let gd_status = 0;

let previous_input_voltage_status = 0;
let previous_ups1_status = 0;
let previous_ups2_status = 0;
let previous_batt1_status = 0;
let previous_temp1_status = 0;
let previous_humiid1_status = 0;
let previous_water_leakage_status = 0;
let previous_fire_status = 0;
let previous_generator_status = 0;
let previous_ups1_cb_status = 0;
let previous_ups2_cb_status = 0;
// ================= ONE WEBSOCKET MESSAGE =================
async function handleMessage(msg, ws) {

    if (msg.includes("Hams_HO")) {
    // if (msg.includes("Hams_HO")) {
        HO_msg = msg;
        log("[HO] ===== HAMS HO data received =====");
        log("[HO]", HO_msg);

        HO_msg = HO_msg.split(":");
        if (idx(HO_msg, 0)) {
            log("Arr1: ", HO_msg[0]);
        }

        // ---------------- IPDU 1 ----------------
        log("[HO] --- Checking IPDU1 ---");
        const outer1 = idx(HO_msg, 1);
        if (outer1) {
            ipdu1 = String(HO_msg[1]).split(",");
            logIpdu(log, 1, HO_msg[1], ipdu1);
        }
        firstPort(S, log, "ipdu1p1", outer1, outer1 ? ipdu1[2] : undefined, {
            inc: 3, failAt: 3, elseInc: 3, elseAt: 3, okStatus: 1, assign: true,
            failText: "R750(1) PSU2 Failed.", okText: "R750(1) PSU1 OK."
        });
        stdPort(S, log, "ipdu1p2", ipdu1 ? idx(ipdu1, 3) : undefined, 2, "SAN(1) PSU2 Failed.", "SAN(1) PSU2 OK.");
        stdPort(S, log, "ipdu1p3", ipdu1 ? idx(ipdu1, 4) : undefined, 3, "R720(1) PSU2 Failed.", "R720(1) PSU2 OK.");
        stdPort(S, log, "ipdu1p4", ipdu1 ? idx(ipdu1, 5) : undefined, 4, "R730(1) PSU2 Failed.", "R730(1) PSU2 OK.");
        stdPort(S, log, "ipdu1p5", ipdu1 ? idx(ipdu1, 6) : undefined, 5, "Check P. PSU1 Failed.", "Check P. PSU1 OK.");
        stdPort(S, log, "ipdu1p6", ipdu1 ? idx(ipdu1, 7) : undefined, 6, "Check P. PSU2 Failed.", "Check P. PSU2 OK.");
        stdPort(S, log, "ipdu1p7", ipdu1 ? idx(ipdu1, 8) : undefined, 7, "Core Router PSU Failed.", "Core Router PSU OK.");
        stdPort(S, log, "ipdu1p8", ipdu1 ? idx(ipdu1, 9) : undefined, 8, "LAN Router PSU Failed.", "LAN Router PSU OK.");

        S.ipdu1_status = S.ipdu1p1_status + S.ipdu1p2_status + S.ipdu1p3_status + S.ipdu1p4_status +
            S.ipdu1p5_status + S.ipdu1p6_status + S.ipdu1p7_status + S.ipdu1p8_status;
        log("IPDU1 Status value:", S.ipdu1_status);

        // ---------------- IPDU 2 ----------------
        log("[HO] --- Checking IPDU2 ---");
        const outer2 = idx(HO_msg, 2);
        if (outer2) {
            ipdu2 = String(HO_msg[2]).split(",");
            logIpdu(log, 2, HO_msg[2], ipdu2);
        }
        firstPort(S, log, "ipdu2p1", outer2, outer2 ? ipdu2[2] : undefined, {
            inc: 3, failAt: 9, elseInc: 9, elseAt: 3, okStatus: 9, assign: false,
            failText: "CISCO Dist PSU Failed.", okText: "CISCO Dist PSU OK."
        });
        stdPort(S, log, "ipdu2p2", ipdu2 ? idx(ipdu2, 3) : undefined, 10, "HO DR PSU1 Failed.", "HO DR PSU1 OK.");
        stdPort(S, log, "ipdu2p3", ipdu2 ? idx(ipdu2, 4) : undefined, 11, "HO DR PSU2 Failed.", "HO DR PSU2 OK.");
        // ipdu2p4: OK status stays 0 (the 12 is overwritten by 0 in the original logic)
        stdPort(S, log, "ipdu2p4", ipdu2 ? idx(ipdu2, 5) : undefined, 0, "HO S PSU1 Failed.", "HO S PSU1 OK.");
        // ipdu2p5: on failure it also sets ipdu2p4_status=0
        stdPort(S, log, "ipdu2p5", ipdu2 ? idx(ipdu2, 6) : undefined, 13, "HO S PSU2 Failed.", "HO S PSU2 OK.", { alsoZero: "ipdu2p4_status" });
        stdPort(S, log, "ipdu2p6", ipdu2 ? idx(ipdu2, 7) : undefined, 14, "NVR PSU Failed.", "NVR PSU OK.");
        // ipdu2p7: failure branch does not wait for the counter
        stdPort(S, log, "ipdu2p7", ipdu2 ? idx(ipdu2, 8) : undefined, 15, "R730-1 PSU1 Failed.", "R730-1 PSU1 OK.", { noGate: true });
        stdPort(S, log, "ipdu2p8", ipdu2 ? idx(ipdu2, 9) : undefined, 16, "R730-1 PSU2 Failed.", "R730-1 PSU2 OK.");

        S.ipdu2_status = S.ipdu2p1_status + S.ipdu2p2_status + S.ipdu2p3_status + S.ipdu2p4_status +
            S.ipdu2p5_status + S.ipdu2p6_status + S.ipdu2p7_status + S.ipdu2p8_status;
        log("IPDU2 Status value:", S.ipdu2_status);

        // ---------------- IPDU 3 ----------------
        log("[HO] --- Checking IPDU3 ---");
        const outer3 = idx(HO_msg, 3);
        if (outer3) {
            ipdu3 = String(HO_msg[3]).split(",");
            logIpdu(log, 3, HO_msg[3], ipdu3);
        }
        firstPort(S, log, "ipdu3p1", outer3, outer3 ? ipdu3[2] : undefined, {
            inc: 6, failAt: 6, elseInc: 6, elseAt: 6, okStatus: 17, assign: false,
            failText: "R730-2 PSU1 Failed.", okText: "R730-2 PSU1 OK."
        });
        stdPort(S, log, "ipdu3p2", ipdu3 ? idx(ipdu3, 3) : undefined, 18, "R730-2 PSU2 Failed.", "R730-2 PSU2 OK.");
        stdPort(S, log, "ipdu3p3", ipdu3 ? idx(ipdu3, 4) : undefined, 19, "SAN SW 1 PSU1 Failed.", "SAN SW 1 PSU1 OK.");
        stdPort(S, log, "ipdu3p4", ipdu3 ? idx(ipdu3, 5) : undefined, 20, "R730(1) PSU1 Failed.", "R730(1) PSU1 OK.");
        stdPort(S, log, "ipdu3p5", ipdu3 ? idx(ipdu3, 6) : undefined, 21, "SAN SW PSU1 Failed.", "SAN SW PSU1 OK.");
        stdPort(S, log, "ipdu3p6", ipdu3 ? idx(ipdu3, 7) : undefined, 22, "R720(1) PSU1 Failed.", "R720(1) PSU1 OK.");
        stdPort(S, log, "ipdu3p7", ipdu3 ? idx(ipdu3, 8) : undefined, 23, "SAN1 PSU1 Failed.", "SAN1 PSU1 OK.");
        stdPort(S, log, "ipdu3p8", ipdu3 ? idx(ipdu3, 9) : undefined, 24, "R750 PSU1 Failed.", "R750 PSU1 OK.");

        S.ipdu3_status = S.ipdu3p1_status + S.ipdu3p2_status + S.ipdu3p3_status + S.ipdu3p4_status +
            S.ipdu3p5_status + S.ipdu3p6_status + S.ipdu3p7_status + S.ipdu3p8_status;
        log("IPDU3 Status value:", S.ipdu3_status);

        // ---------------- GD (generator / UPS / environment) ----------------
        if (idx(HO_msg, 4)) {
            log("[HO] --- Checking GD (power / UPS / temperature / fire / water) ---");
            log("GD: ", HO_msg[4]);
            GD = String(HO_msg[4]).split(",");
            log("PDB:", idx(GD, 1));
            log("UPS1:", idx(GD, 2));
            log("UPS2:", idx(GD, 3));
            log("BATT:", idx(GD, 4));
            log("TEMP:", idx(GD, 5));
            log("HUMID:", idx(GD, 6));
            log("WS:", idx(GD, 7));
            log("FS:", idx(GD, 8));
            log("GS:", idx(GD, 9));
            log("UPS1_CB:", idx(GD, 10));
            log("UPS2_CB:", idx(GD, 11));
            notification_msg_gd = "";

            // Input voltage
            if (toInt(GD[1]) < 276) {
                input_voltage_status = 0;
                if (input_voltage_status !== previous_input_voltage_status) {
                    notification_msg_gd = "Input Voltage is OK (<276V).";
                    previous_input_voltage_status = input_voltage_status;
                }
                log("input_voltage_status value: ", input_voltage_status);
            } else {
                input_voltage_status = 25;
                if (input_voltage_status !== previous_input_voltage_status) {
                    notification_msg_gd = notification_msg_gd + "Input Voltage is High (>275V).";
                    previous_input_voltage_status = input_voltage_status;
                }
                log("input_voltage_status value: ", input_voltage_status);
            }

            // UPS1
            if (toInt(GD[2]) > 180) {
                ups1_status = 0;
                if (ups1_status !== previous_ups1_status) {
                    notification_msg_gd = notification_msg_gd + "UPS1 is OK.";
                    previous_ups1_status = ups1_status;
                }
                log("ups1_status value: ", ups1_status);
            } else {
                ups1_status = 26;
                if (ups1_status !== previous_ups1_status) {
                    notification_msg_gd = notification_msg_gd + "UPS1 is Failed.";
                    previous_ups1_status = ups1_status;
                }
                log("ups1_status value: ", ups1_status);
            }

            // UPS2
            if (toInt(GD[3]) > 180) {
                ups2_status = 0;
                if (ups2_status !== previous_ups2_status) {
                    notification_msg_gd = notification_msg_gd + "UPS2 is OK.";
                    previous_ups2_status = ups2_status;
                }
                log("ups2_status value: ", ups2_status);
            } else {
                ups2_status = 27;
                if (ups2_status !== previous_ups2_status) {
                    notification_msg_gd = notification_msg_gd + "UPS2 is Failed.";
                    previous_ups2_status = ups2_status;
                }
                log("ups2_status value: ", ups2_status);
            }

            // Battery
            if (toFloat(GD[4]) > 240) {
                log("Battery Voltage", toFloat(GD[4]));
                batt1_status = 0;
                if (batt1_status !== previous_batt1_status) {
                    notification_msg_gd = notification_msg_gd + "Battery Voltage is OK.";
                    previous_batt1_status = batt1_status;
                }
                log("Batt1_status value: ", batt1_status);
            } else {
                log("Battery Voltage is LOW");
                batt1_status = 28;
                if (batt1_status !== previous_batt1_status) {
                    notification_msg_gd = notification_msg_gd + "Battery Voltage is Low.";
                    previous_batt1_status = batt1_status;
                }
                log("Batt1_status value: ", batt1_status);
            }

            // Temperature
            if (toFloat(GD[5]) < 25) {
                temp1_status = 0;
                if (temp1_status !== previous_temp1_status) {
                    notification_msg_gd = notification_msg_gd + "Temperature is OK (<25 degree).";
                    previous_temp1_status = temp1_status;
                }
                log("temp1_status value: ", temp1_status);
            } else {
                temp1_status = 29;
                if (temp1_status !== previous_temp1_status) {
                    notification_msg_gd = notification_msg_gd + "Temperature is High (>=25 degree).";
                    previous_temp1_status = temp1_status;
                }
                log("temp1_status value: ", temp1_status);
            }

            // Humidity
            if (toInt(GD[6]) < 95) {
                humiid1_status = 0;
                log("humiid1_status value: ", humiid1_status);
            } else {
                humiid1_status = 30;
                log("humiid1_status value: ", humiid1_status);
            }

            // Water leakage
            if (toInt(GD[7]) !== 0) {
                water_leakage_status = 0;
                if (water_leakage_status !== previous_water_leakage_status) {
                    notification_msg_gd = notification_msg_gd + "No water detected at HQ server room.";
                    previous_water_leakage_status = water_leakage_status;
                }
                log("water_leakage_status value: ", water_leakage_status);
            } else {
                water_leakage_status = 31;
                if (water_leakage_status !== previous_water_leakage_status) {
                    notification_msg_gd = notification_msg_gd + "Water detected at HQ server room.";
                    previous_water_leakage_status = water_leakage_status;
                }
                log("water_leakage_status value: ", water_leakage_status);
            }

            // Fire alarm
            if (toInt(GD[8]) !== 0) {
                fire_status = 0;
                firecounter = 0;
                if (fire_status !== previous_fire_status) {
                    notification_msg_gd = notification_msg_gd + "No Fire alarm at HQ server room.";
                    previous_fire_status = fire_status;
                }
                log("fire_status value: ", fire_status);
            } else {
                if (firecounter < 35) {
                    firecounter = firecounter + 1;
                    log("firecounter Counter", firecounter);
                    if (firecounter >= 35) {
                        firecounter = 0;
                        fire_status = 32;
                        if (fire_status !== previous_fire_status) {
                            notification_msg_gd = notification_msg_gd + "Fire alarm at HQ server room.";
                            previous_fire_status = fire_status;
                        }
                        log("fire_status value: ", fire_status);
                    }
                }
            }

            // Generator
            if (toInt(GD[1]) > 71 && toInt(GD[9]) === 1) {
                generator_status = 0;
                if (generator_status !== previous_generator_status) {
                    notification_msg_gd = notification_msg_gd + "Generator stopped.(PDB is available).";
                    previous_generator_status = generator_status;
                }
                log("generator_status value: ", generator_status);
            } else if (toInt(GD[9]) === 1 && toInt(GD[1]) < 70) {
                if (gencounter < 3) {
                    gencounter = gencounter + 1;
                    log("Generator Counter", gencounter);
                    if (gencounter >= 3) {
                        gencounter = 0;
                        generator_status = 33;
                        if (generator_status !== previous_generator_status) {
                            notification_msg_gd = notification_msg_gd + "Generator is not started.(PDB not available).";
                            previous_generator_status = generator_status;
                        }
                    }
                }
                log("generator_status: ", generator_status);
            } else if (toInt(GD[1]) < 70 && toInt(GD[9]) === 0) {
                generator_status = 133;
                if (generator_status !== previous_generator_status) {
                    notification_msg_gd = notification_msg_gd + "Generator started.(PDB is not available).";
                    previous_generator_status = generator_status;
                }
                log("generator_status value: ", generator_status);
            }

            // UPS1 circuit breaker
            if (toInt(GD[10]) !== 0) {
                ups1_cb_status = 0;
                if (ups1_cb_status !== previous_ups1_cb_status) {
                    notification_msg_gd = notification_msg_gd + "UPS1 CB is OK.";
                    previous_ups1_cb_status = ups1_cb_status;
                }
                log("ups1_cb_status: ", ups1_cb_status);
            } else {
                ups1_cb_status = 34;
                if (ups1_cb_status !== previous_ups1_cb_status) {
                    notification_msg_gd = notification_msg_gd + "UPS1 CB is Tripped.";
                    previous_ups1_cb_status = ups1_cb_status;
                }
                log("ups1_cb_status value: ", ups1_cb_status);
            }

            // UPS2 circuit breaker
            if (toInt(GD[11]) !== 0) {
                ups2_cb_status = 0;
                if (ups2_cb_status !== previous_ups2_cb_status) {
                    notification_msg_gd = notification_msg_gd + "UPS2 CB is OK.";
                    previous_ups2_cb_status = ups2_cb_status;
                }
                log("ups2_cb_status: ", ups2_cb_status);
            } else {
                ups2_cb_status = 35;
                if (ups2_cb_status !== previous_ups2_cb_status) {
                    notification_msg_gd = notification_msg_gd + "UPS2 CB is Tripped.";
                    previous_ups2_cb_status = ups2_cb_status;
                }
                log("ups2_cb_status value: ", ups2_cb_status);
            }
        }

        gd_status = input_voltage_status + ups1_status + ups2_status + batt1_status + temp1_status +
            humiid1_status + water_leakage_status + fire_status + generator_status + ups1_cb_status + ups2_cb_status;
        log("GD_Notification Message:", notification_msg_gd);
    }

    // ---------- status comparison (runs for every message) ----------
    present_status = gd_status;

    log("PDU1 Status Value:", S.ipdu1_status);
    log("PDU2 Status Value:", S.ipdu2_status);
    log("PDU3 Status Value:", S.ipdu3_status);
    log("GD Status Value:", gd_status);
    log("Present Status Value:", present_status);
    log("Previous Status Value:", previous_status);
    if (present_status !== previous_status) {
        log("🚨 STATUS CHANGED -> sending WhatsApp notification");
        previous_status = present_status;
        notification_msg_gd = "*" + notification_msg_gd + "*" + " This is a system generated text from HAMS HO Server room, no need to reply. Thanks for your support.";
        previous_status = present_status;
        log("[SEND] ", notification_msg_gd);
        await sendWhatsappSms(notification_msg_gd);
        S.notification_msg = "";
        notification_msg_gd = "";

        await sleep(0); // yield control safely
    }

    if (msg.includes("Hams_FAC1")) {
        FAC1_msg = msg;
        log("[FAC1]", FAC1_msg);
    }

    // ===== FINAL STATUS CHECK =====
    present_status = gd_status;

    if (present_status !== previous_status) {
        previous_status = present_status;
        const alert = `*${notification_msg_gd}* This is a system generated text.`;
        log("🚨 FINAL STATUS CHECK -> sending WhatsApp notification");
        await sendWhatsappSms(alert);
        S.notification_msg = "";
        notification_msg_gd = "";
    }
}

// ================= PROGRAM ENTRY =================
log("🚀 HAMS HO service starting...");
runWebSocketLoop(SERVER_URL, log, handleMessage);