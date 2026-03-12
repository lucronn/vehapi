# Firebase Hosting Setup Guide

## Step 1: Install Firebase CLI

```bash
npm install -g firebase-tools
```

Or use npx (no global install needed):
```bash
npx firebase-tools --version
```

## Step 2: Login to Firebase

```bash
firebase login
```

This will open your browser to authenticate with your Google account.

## Step 3: Initialize Firebase Hosting

```bash
firebase init hosting
```

When prompted:
1. **Select an existing project** or create a new one
2. **What do you want to use as your public directory?** → `dist/browser`
3. **Configure as a single-page app?** → **Yes** (important for Angular routing)
4. **Set up automatic builds and deploys with GitHub?** → Optional (you can skip this)
5. **File dist/browser/index.html already exists. Overwrite?** → **No**

## Step 4: Build Your App

```bash
npm run build
```

This creates the production build in `dist/browser/`.

## Step 5: Deploy

```bash
npm run firebase:deploy
```

Or manually:
```bash
firebase deploy --only hosting
```

## Quick Commands

- **Build and deploy:** `npm run firebase:deploy`
- **Test locally:** `npm run firebase:serve` (serves at http://localhost:5000)
- **Deploy only:** `firebase deploy --only hosting`
- **View deployments:** `firebase hosting:channel:list`

## Custom Domain

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project → Hosting
3. Click "Add custom domain"
4. Follow the DNS setup instructions

## Environment Setup

The `.firebaserc` file will be created automatically when you run `firebase init`. It contains your project ID.

## Troubleshooting

**Build fails:**
- Make sure dependencies are installed: `npm install`
- Check Node.js version (Angular 21 requires Node 18+)

**Deploy fails:**
- Ensure you're logged in: `firebase login`
- Check that `dist/browser` exists after building
- Verify `firebase.json` is in the project root

**Routes not working:**
- Make sure `firebase.json` has the rewrite rule (already configured)
- Since you're using hash routing (`#`), routes should work automatically

## Continuous Deployment

To auto-deploy on git push:

1. Install GitHub Actions:
```bash
firebase init hosting:github
```

2. Or manually create `.github/workflows/firebase-deploy.yml`:
```yaml
name: Deploy to Firebase

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: '${{ secrets.GITHUB_TOKEN }}'
          firebaseServiceAccount: '${{ secrets.FIREBASE_SERVICE_ACCOUNT }}'
          channelId: live
          projectId: your-project-id
```

