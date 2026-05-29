#!/bin/bash
# Rotate ProtonVPN to a new server

OLD_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null)
echo "[vpn-rotate] Current IP: $OLD_IP"

# Open ProtonVPN window and click Disconnect
osascript << 'EOF'
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
            end try
        end try
    end tell
end tell
EOF

echo "[vpn-rotate] Disconnect clicked, waiting for tunnel down..."
sleep 8

# Use URL scheme to Quick Connect (new fastest server)
open "protonvpn://connect"
echo "[vpn-rotate] Quick Connect triggered"
sleep 10

# Wait for new IP
for i in $(seq 1 20); do
    NEW_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null)
    if [ -n "$NEW_IP" ] && [ "$NEW_IP" != "$OLD_IP" ]; then
        echo "[vpn-rotate] New IP: $NEW_IP (rotated successfully)"
        exit 0
    fi
    echo "[vpn-rotate] Waiting for new IP... attempt $i (current: $NEW_IP)"
    sleep 3
done

echo "[vpn-rotate] WARNING: IP did not change after rotation"
exit 1
