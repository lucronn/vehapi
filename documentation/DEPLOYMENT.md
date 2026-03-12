# Deployment Guide

This Angular application can be deployed to various platforms. Here are the recommended options:

## 🚀 Quick Deploy Options

### 1. **Vercel** (Recommended - Easiest)
1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Import your repository
4. Vercel will auto-detect Angular and use the `vercel.json` config
5. Deploy!

**Pros:** Zero config, automatic HTTPS, global CDN, preview deployments

---

### 2. **Netlify**
1. Push your code to GitHub
2. Go to [netlify.com](https://netlify.com)
3. Import your repository
4. Netlify will use the `netlify.toml` config
5. Deploy!

**Pros:** Easy setup, form handling, serverless functions support

---

### 3. **GitHub Pages** (Free)
1. Push your code to GitHub
2. Go to repository Settings → Pages
3. Select source: "GitHub Actions"
4. The workflow in `.github/workflows/deploy.yml` will auto-deploy on push to `main`

**Pros:** Free, integrated with GitHub, automatic deployments

**Note:** Update `angular.json` to set `baseHref` if deploying to a subdirectory:
```json
"baseHref": "/your-repo-name/"
```

---

### 4. **Firebase Hosting**
1. Install Firebase CLI: `npm install -g firebase-tools`
2. Login: `firebase login`
3. Initialize: `firebase init hosting`
4. Build: `npm run build`
5. Deploy: `firebase deploy`

**Pros:** Google infrastructure, fast CDN, easy rollbacks

---

### 5. **Cloudflare Pages**
1. Push your code to GitHub
2. Go to [pages.cloudflare.com](https://pages.cloudflare.com)
3. Connect repository
4. Build settings:
   - Build command: `npm run build`
   - Build output: `dist/browser`
5. Deploy!

**Pros:** Free, fast, unlimited bandwidth

---

## 📋 Manual Build Steps

Before deploying anywhere, test locally:

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Preview production build locally
npm run preview
```

The built files will be in `dist/browser/`

---

## 🔧 Environment Variables

If you need to configure the API base URL, you can:

1. Create `src/environments/environment.prod.ts`:
```typescript
export const environment = {
  production: true,
  apiUrl: 'https://your-api-url.com'
};
```

2. Update `motor-api.service.ts` to use it

---

## 🌐 Custom Domain

All platforms above support custom domains:
- **Vercel/Netlify:** Add domain in dashboard, update DNS
- **GitHub Pages:** Add CNAME file in repository
- **Firebase:** `firebase hosting:channel:deploy production --only hosting`

---

## 📝 Notes

- The app uses hash routing (`#`), so all routes work with static hosting
- No server-side rendering needed
- All platforms support automatic deployments from Git pushes

