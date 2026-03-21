#Requires AutoHotkey v2.0
#SingleInstance Force
; Repo root = two levels up from scripts\automation
repo := A_ScriptDir "\..\.."
once := repo "\scripts\continue-once.ps1"

; Ctrl+Alt+F9 — one continue (clipboard refresh + focus Cursor + paste + Enter)
^!F9:: {
    global once
    try {
        RunWait(Format('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{1}"', once),, "Hide")
    } catch Error as e {
        MsgBox("Failed: " e.Message, "cursor-continue-hotkey", "Icon!")
    }
}
