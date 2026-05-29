#!/bin/bash
# Rotate ProtonVPN to a new server — robust reconnect with retries

OLD_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null)
echo "[vpn-rotate] Current IP: $OLD_IP"

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
                -- Try menu bar item directly
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

# --- Reconnect: try URL scheme + AppleScript click, up to 4 attempts
reconnect_attempt() {
    # Try URL scheme first
    open "protonvpn://connect"
    sleep 3
    # Also try AppleScript Quick Connect button
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

for attempt in 1 2 3 4; do
    echo "[vpn-rotate] Reconnect attempt $attempt..."
    reconnect_attempt
    # Wait for new IP — up to 20 seconds per attempt
    for i in $(seq 1 10); do
        NEW_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null)
        if [ -n "$NEW_IP" ] && [ "$NEW_IP" != "$OLD_IP" ]; then
            echo "[vpn-rotate] New IP: $NEW_IP (rotated successfully on attempt $attempt)"
            exit 0
        fi
        sleep 2
    done
    echo "[vpn-rotate] Attempt $attempt: still no new IP, retrying..."
    sleep 5
done

echo "[vpn-rotate] WARNING: IP did not change after 4 reconnect attempts"
exit 1
