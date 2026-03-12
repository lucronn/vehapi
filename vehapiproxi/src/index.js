import { app } from './function.js';
import { config } from './config.js';
import { authManager } from './auth.js';
import logger from './logger.js';

// Start server in Local Development Mode
async function start() {
    try {
        logger.info('Motor API Proxy (Local Dev Mode) starting...');
        logger.info(`Target API: ${config.motorApiBase}`);
        logger.info(`Proxy port: ${config.proxyPort}`);

        // Try to load existing session
        const loaded = await authManager.loadSession();

        // If no valid session, authenticate now
        if (!loaded) {
            logger.info('No session found, starting authentication...');
            try {
                await authManager.authenticate();
            } catch (authError) {
                logger.error('Initial authentication failed, but server will start anyway:', authError);
            }
        }

        // Start Express server using the app defined in function.js
        app.listen(config.proxyPort, () => {
            logger.info(`✓ Proxy server listening on http://localhost:${config.proxyPort}`);
            logger.info(`  Health check: http://localhost:${config.proxyPort}/health`);
            logger.info(`  API proxy: http://localhost:${config.proxyPort}/v1/*`);
            logger.info('Ready to proxy requests!');
        });

    } catch (error) {
        logger.error('Failed to start proxy server:', error);
        process.exit(1);
    }
}

// Handle shutdown
process.on('SIGINT', () => {
    logger.info('Shutting down proxy server...');
    process.exit(0);
});

start();
