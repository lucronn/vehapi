@echo off
SET "PATH=%PATH%;C:\Program Files\nodejs"
echo Environment configured. Node.js verified.

echo.
echo ==========================================
echo      STEP 1: FIREBASE AUTHENTICATION
echo ==========================================
echo A browser window will open. Please sign in to your Google account.
echo.
call npm run firebase:login

echo.
echo ==========================================
echo      STEP 2: DEPLOYING TO LIVE
echo ==========================================
call npm run firebase:deploy

echo.
echo ==========================================
echo      DEPLOYMENT COMPLETE
echo ==========================================

