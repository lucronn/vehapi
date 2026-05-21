import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Prefer vehapiproxi/.env next to this file so `node` cwd (repo root vs vehapiproxi) does not matter.
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config();

export const config = {
    // Authentication credentials
    // On Cloud Run, these come from environment / project settings
    // Locally, these come from .env file
    libraryBarcode: process.env.LIBRARY_BARCODE || '',
    ebscoUser: process.env.EBSCO_USER || '',
    ebscoPassword: process.env.EBSCO_PASSWORD || '',
    ebscoProfile: process.env.EBSCO_PROFILE || 'autorepso',
    ebscoGroupId: process.env.EBSCO_GROUP_ID || 'remote',

    // API configuration
    motorApiBase: process.env.MOTOR_API_BASE || 'https://sites.motor.com/m1',
    proxyPort: parseInt(process.env.PORT || process.env.PROXY_PORT || '3001', 10),
    debugApiKey: process.env.DEBUG_API_KEY,

    // Session management
    maxSessionAge: 24 * 60 * 60 * 1000, // 24 hours in milliseconds

    // URLs from the authentication flow
    urls: {
        libraryPortal: 'https://e-resources.powerlibrary.org/ext/econtent/BarcodeEntry/index.php?lid=PL7321R&dataid=2145&libname=E-Card+or+public+library',
        ebscoLogin: 'https://search.ebscohost.com/login.aspx',
        motorBase: 'https://sites.motor.com'
    },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

    // Demo mode — set DEMO_MODE=true in .env to enable for ALL users
    demoMode: String(process.env.DEMO_MODE || '').toLowerCase() === 'true',
};

// Validate required configuration
export function validateConfig() {
    const required = ['motorApiBase'];
    const missing = required.filter(key => !config[key] || config[key].trim() === '');

    if (missing.length > 0) {
        const errorMsg = `Missing required configuration: ${missing.join(', ')}. ` +
            `Please set these as environment variables: ${missing.map(k => k.toUpperCase()).join(', ')}`;
        logger.error(errorMsg);
        // Don't throw for now, just log error. 
        // This allows the function to start even if config is impartial.
        // throw new Error(errorMsg); 
    }
}
