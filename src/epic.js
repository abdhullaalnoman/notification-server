"use strict";

const { sleep, startWhatsApp, runWebSocketLoop } = require("./common");


function makeLogger(tag) {
    return (...args) => {
        const ts = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Dhaka" });
        console.log(`[${tag}] [${ts}]`, ...args);
    };
}


// list[i] -> raises "index out of range"
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



const SERVER_URL = "ws://27.147.170.162:81";

const NUMBERS = [
    // "+8801787686086",
    // "+8801610043800",
    // "+8801686039445",
    // "+8801717943243"
       "+8801717583501"
];

const log = makeLogger("EPIC");
const sendWhatsappSms = startWhatsApp("epic", NUMBERS, log);

// ================= GLOBAL VARIABLES =================
let HO_msg = "";
let previous_status = 0;
let gencounter = 0;
let firecounter = 0;
let present_status = 0;
let notification_msg_gd = "";
let GD;

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
let cb1_counter = 0;
let cb2_counter = 0;
let water_counter = 0;

// ================= ONE WEBSOCKET MESSAGE =================
async function handleMessage(msg, ws) {

    if (msg.includes("Epic_HO")) {
        HO_msg = msg;
        log("[EPIC] ===== EPIC HO data received =====");
        log("[MSG]", HO_msg);
        await ws.close();   // close, then reconnect after 5s
        await sleep(1000);
        HO_msg = HO_msg.split(":");
        if (idx(HO_msg, 0)) {
            log("Arr1: ", HO_msg[0]);
        }
        if (idx(HO_msg, 1)) {
            log("GD: ", HO_msg[1]);
        }
        GD = String(idx(HO_msg, 1)).split(",");
        log("PDB:", idx(GD, 0));
        log("UPS1:", idx(GD, 1));
        log("UPS2:", idx(GD, 2));
        log("BATT1:", idx(GD, 3));
        log("BATT2:", idx(GD, 4));
        log("TEMP1:", idx(GD, 5));
        log("TEMP2:", idx(GD, 6));
        log("HUMID1:", idx(GD, 7));
        log("HUMID2:", idx(GD, 8));
        log("WS:", idx(GD, 9));
        log("FS:", idx(GD, 10));
        log("GS:", idx(GD, 11));
        log("UPS1_CB:", idx(GD, 12));
        log("UPS2_CB:", idx(GD, 13));
        notification_msg_gd = "";

        // Input voltage
        if (toInt(GD[0]) < 276) {
            input_voltage_status = 0;
            if (input_voltage_status !== previous_input_voltage_status) {
                notification_msg_gd = "Input Voltage is OK (<276V).";
                previous_input_voltage_status = input_voltage_status;
            }
            log("input_voltage_status value: ", input_voltage_status);
        } else {
            input_voltage_status = 1;
            if (input_voltage_status !== previous_input_voltage_status) {
                notification_msg_gd = notification_msg_gd + "Input Voltage is High (>275V).";
                previous_input_voltage_status = input_voltage_status;
            }
            log("input_voltage_status value: ", input_voltage_status);
        }

        // UPS1
        if (toInt(GD[1]) > 180) {
            ups1_status = 0;
            if (ups1_status !== previous_ups1_status) {
                notification_msg_gd = notification_msg_gd + "UPS1 is OK.";
                previous_ups1_status = ups1_status;
            }
            log("ups1_status value: ", ups1_status);
        } else {
            ups1_status = 2;
            if (ups1_status !== previous_ups1_status) {
                notification_msg_gd = notification_msg_gd + "UPS1 is Failed.";
                previous_ups1_status = ups1_status;
            }
            log("ups1_status value: ", ups1_status);
        }

        // UPS2
        if (toInt(GD[2]) > 180) {
            ups2_status = 0;
            if (ups2_status !== previous_ups2_status) {
                notification_msg_gd = notification_msg_gd + "UPS2 is OK.";
                previous_ups2_status = ups2_status;
            }
            log("ups2_status value: ", ups2_status);
        } else {
            ups2_status = 3;
            if (ups2_status !== previous_ups2_status) {
                notification_msg_gd = notification_msg_gd + "UPS2 is Failed.";
                previous_ups2_status = ups2_status;
            }
            log("ups2_status value: ", ups2_status);
        }

        // Battery
        if (toFloat(GD[3]) > 185) {
            log("Battery Voltage", toFloat(GD[4]));
            batt1_status = 0;
            if (batt1_status !== previous_batt1_status) {
                notification_msg_gd = notification_msg_gd + "Battery Voltage is OK.";
                previous_batt1_status = batt1_status;
            }
            log("Batt1_status value: ", batt1_status);
        } else {
            log("Battery Voltage is LOW");
            batt1_status = 4;
            if (batt1_status !== previous_batt1_status) {
                notification_msg_gd = notification_msg_gd + "Battery Voltage is Low.";
                previous_batt1_status = batt1_status;
            }
            log("Batt1_status value: ", batt1_status);
        }

        // Temperature
        if (toFloat(GD[5]) < 28) {
            temp1_status = 0;
            if (temp1_status !== previous_temp1_status) {
                notification_msg_gd = notification_msg_gd + "Temperature is OK (<28 degree).";
                previous_temp1_status = temp1_status;
            }
            log("temp1_status value: ", temp1_status);
        } else {
            temp1_status = 5;
            if (temp1_status !== previous_temp1_status) {
                notification_msg_gd = notification_msg_gd + "Temperature is High (>=28 degree).";
                previous_temp1_status = temp1_status;
            }
            log("temp1_status value: ", temp1_status);
        }

        // Humidity
        if (toInt(GD[7]) < 95) {
            humiid1_status = 0;
            log("humiid1_status value: ", humiid1_status);
        } else {
            humiid1_status = 6;
            log("humiid1_status value: ", humiid1_status);
        }

        // Water leakage (uses cb1_counter here, kept as original)
        if (toInt(GD[9]) !== 0) {
            water_counter = 0;
            water_leakage_status = 0;
            if (water_leakage_status !== previous_water_leakage_status) {
                notification_msg_gd = notification_msg_gd + "No water detected at HQ server room.";
                previous_water_leakage_status = water_leakage_status;
            }
            log("water_leakage_status value: ", water_leakage_status);
        } else {
            if (water_counter < 7) {
                water_counter = cb1_counter + 1;
                if (water_counter >= 6) {
                    water_counter = 0;
                    water_leakage_status = 7;
                    if (water_leakage_status !== previous_water_leakage_status) {
                        notification_msg_gd = notification_msg_gd + "Water detected at HQ server room.";
                        previous_water_leakage_status = water_leakage_status;
                    }
                    log("water_leakage_status value: ", water_leakage_status);
                }
            }
        }

        // Fire alarm
        if (toInt(GD[10]) !== 0) {
            fire_status = 0;
            firecounter = 0;
            if (fire_status !== previous_fire_status) {
                notification_msg_gd = notification_msg_gd + "No Fire alarm at  Epic HQ server room.";
                previous_fire_status = fire_status;
            }
            log("fire_status value: ", fire_status);
        } else {
            if (firecounter < 7) {
                firecounter = firecounter + 1;
                log("firecounter Counter", firecounter);
                if (firecounter >= 7) {
                    firecounter = 0;
                    fire_status = 8;
                    if (fire_status !== previous_fire_status) {
                        notification_msg_gd = notification_msg_gd + "Fire alarm at HQ server room.";
                        previous_fire_status = fire_status;
                    }
                    log("fire_status value: ", fire_status);
                }
            }
        }

        await sleep(5000); // wait 5 seconds

        // Generator
        if (toInt(GD[0]) > 71 && toInt(GD[11]) === 1) {
            generator_status = 0;
            if (generator_status !== previous_generator_status) {
                notification_msg_gd = notification_msg_gd + "Generator stopped.(PDB is available).";
                previous_generator_status = generator_status;
            }
            log("generator_status value: ", generator_status);
        } else if (toInt(GD[11]) === 1 && toInt(GD[0]) < 70) {
            if (gencounter < 3) {
                gencounter = gencounter + 1;
                log("Generator Counter", gencounter);
                if (gencounter >= 3) {
                    gencounter = 0;
                    generator_status = 9;
                    if (generator_status !== previous_generator_status) {
                        notification_msg_gd = notification_msg_gd + "Generator is not started.(PDB not available).";
                        previous_generator_status = generator_status;
                    }
                }
            }
            log("generator_status: ", generator_status);
        } else if (toInt(GD[0]) < 70 && toInt(GD[11]) === 0) {
            generator_status = 10;
            if (generator_status !== previous_generator_status) {
                notification_msg_gd = notification_msg_gd + "Generator started.(PDB is not available).";
                previous_generator_status = generator_status;
            }
            log("generator_status value: ", generator_status);
        }

        // UPS1 circuit breaker
        if (toInt(GD[12]) !== 0) {
            cb1_counter = 0;
            ups1_cb_status = 0;
            if (ups1_cb_status !== previous_ups1_cb_status) {
                notification_msg_gd = notification_msg_gd + "UPS1 CB is OK.";
                previous_ups1_cb_status = ups1_cb_status;
            }
            log("ups1_cb_status: ", ups1_cb_status);
        } else {
            if (cb1_counter < 42) {
                cb1_counter = cb1_counter + 1;
                if (cb1_counter >= 42) {
                    cb1_counter = 0;
                    ups1_cb_status = 11;
                    if (ups1_cb_status !== previous_ups1_cb_status) {
                        notification_msg_gd = notification_msg_gd + "UPS1 CB is Tripped.";
                        previous_ups1_cb_status = ups1_cb_status;
                    }
                    log("ups1_cb_status value: ", ups1_cb_status);
                }
            }
        }

        // UPS2 circuit breaker
        if (toInt(GD[13]) !== 0) {
            cb2_counter = 0;
            ups2_cb_status = 0;
            if (ups2_cb_status !== previous_ups2_cb_status) {
                notification_msg_gd = notification_msg_gd + "UPS2 CB is OK.";
                previous_ups2_cb_status = ups2_cb_status;
            }
            log("ups2_cb_status: ", ups2_cb_status);
        } else {
            if (cb2_counter < 7) {
                cb2_counter = cb2_counter + 1;
                if (cb2_counter >= 6) {
                    cb2_counter = 0;
                    ups2_cb_status = 12;
                    if (ups2_cb_status !== previous_ups2_cb_status) {
                        notification_msg_gd = notification_msg_gd + "UPS2 CB is Tripped.";
                        previous_ups2_cb_status = ups2_cb_status;
                    }
                    log("ups2_cb_status value: ", ups2_cb_status);
                }
            }
        }

        gd_status = input_voltage_status + ups1_status + ups2_status + batt1_status + temp1_status +
            humiid1_status + water_leakage_status + fire_status + generator_status + ups1_cb_status + ups2_cb_status;
        log("GD_Notification Message:", notification_msg_gd);
    }

    // ---------- status comparison (runs for every message) ----------
    present_status = gd_status;

    log("GD Status Value:", gd_status);
    log("Present Status Value:", present_status);
    log("Previous Status Value:", previous_status);
    if (present_status !== previous_status) {
        log("🚨 STATUS CHANGED -> sending WhatsApp notification");
        previous_status = present_status;
        notification_msg_gd = "*" + notification_msg_gd + "*" + " This is a system generated text(EPIC) , no need to reply. Thanks for your support.";
        previous_status = present_status;
        log("[SEND] ", notification_msg_gd);
        await sendWhatsappSms(notification_msg_gd);
        notification_msg_gd = "";
        await sleep(2000); // wait 2 seconds
        await sleep(1000); // wait 1 second
    }
}

// ================= ENTRY POINT =================
log("🚀 EPIC service starting...");
runWebSocketLoop(SERVER_URL, log, handleMessage);
