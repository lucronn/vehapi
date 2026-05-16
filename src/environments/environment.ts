export const environment = {
    production: false,
    apiUrl: '/api',
    /** Dev-only: bypass all credit/paywall checks so article content loads without purchase. */
    debugBypassPaywall: false,
    features: {
        /** L2 semantic search panel on vehicle dashboard (dev on; prod off until QA). */
        l2Search: true
    },
    firebase: {
        // Get these values from: Firebase Console → Project Settings → Your apps → Web app
        // Project: vehapi-torque
        apiKey: 'AIzaSyAsS2U7n5tJhITB3enYdSYwIq9801hG2Rk',
        authDomain: 'vehapi-torque.firebaseapp.com',
        projectId: 'vehapi-torque',
        storageBucket: 'vehapi-torque.firebasestorage.app',
        messagingSenderId: '963068558024',
        appId: '1:963068558024:web:bc34a196bff6fa5ccf43fd'
    }
};
