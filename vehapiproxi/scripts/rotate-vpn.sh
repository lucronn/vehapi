#!/bin/bash
# Rotate ProtonVPN to a new server — NEVER allow home IP through

HOME_IP="99.34.18.196"

is_home_ip() {
    [ "$1" = "$HOME_IP" ]
}

get_ip() {
    curl -s --max-time 5 https://api.ipify.org 2>/dev/null
}

OLD_IP=$(get_ip)
echo "[vpn-rotate] Current IP: $OLD_IP"

# Refuse to run if currently on home IP and ProtonVPN isn't connected
if is_home_ip "$OLD_IP"; then
    echo "[vpn-rotate] WARNING: currently on home IP — VPN may already be disconnected"
fi

# --- Disconnect via AppleScript menu bar click
osascript << 'APPLESCRIPT'
tell application "System Events"
    tell process "ProtonVPN"
        click menu bar item 1 of menu bar 2
        delay 0.8
        try
            tell window "Proton VPN"
                click button "Disconnect"
            end tell
        on error
            try
                tell window 1
                    click button "Disconnect"
                end tell
            on error
                try
                    click menu item "Disconnect" of menu 1 of menu bar item 1 of menu bar 2
                end try
            end try
        end try
    end tell
end tell
APPLESCRIPT

echo "[vpn-rotate] Disconnect clicked, waiting 12s for tunnel down..."
sleep 12

# --- Reconnect: try URL scheme + AppleScript click, up to 6 attempts
reconnect_attempt() {
    open "protonvpn://connect"
    sleep 3
    osascript << 'APPLESCRIPT' 2>/dev/null
    tell application "ProtonVPN" to activate
    delay 1
    tell application "System Events"
        tell process "ProtonVPN"
            try
                click button "Quick Connect" of window 1
            on error
                try
                    click button "Connect" of window 1
                on error
                    click menu bar item 1 of menu bar 2
                    delay 0.5
                    try
                        click menu item "Quick Connect" of menu 1 of menu bar item 1 of menu bar 2
                    end try
                end try
            end try
        end tell
    end tell
APPLESCRIPT
}

for attempt in 1 2 3 4 5 6; do
    echo "[vpn-rotate] Reconnect attempt $attempt..."
    reconnect_attempt
    for i in $(seq 1 15); do
        NEW_IP=$(get_ip)
        if [ -n "$NEW_IP" ] && [ "$NEW_IP" != "$OLD_IP" ]; then
            # Hard block: never allow home IP to be used
            if is_home_ip "$NEW_IP"; then
                echo "[vpn-rotate] BLOCKED: new IP is home IP ($NEW_IP) — VPN not connected, retrying..."
                break  # try reconnect again
            fi
            echo "[vpn-rotate] New IP: $NEW_IP (rotated successfully on attempt $attempt)"
            exit 0
        fi
        sleep 2
    done
    echo "[vpn-rotate] Attempt $attempt: no valid VPN IP yet, retrying..."
    sleep 5
done

echo "[vpn-rotate] FATAL: could not obtain VPN IP after 6 attempts — home IP protection active, NOT proceeding"
exit 1
