
import Stripe from 'stripe';
import { config } from './config.js';
import { addCredits, setStripeCustomerId } from './credits.js';
import logger from './logger.js';

let stripe;

function getStripe() {
    if (!stripe) {
        const secretKey = (process.env.STRIPE_SANDBOX_SKEY || process.env.STRIPE_SECRET_KEY || '').trim();

        if (!secretKey) {
            throw new Error('Neither STRIPE_SANDBOX_SKEY nor STRIPE_SECRET_KEY is set');
        }
        stripe = new Stripe(secretKey);
    }
    return stripe;
}

export async function createCheckoutSession(userId, amount, origin) {
    const parsedAmount = parseInt(amount, 10);
    if (isNaN(parsedAmount) || parsedAmount < 1000) {
        throw new Error('Minimum purchase is 1000 credits ($10)');
    }

    try {
        const s = getStripe();
        const session = await s.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: 'Torque Credits',
                            description: 'Credits for unlocking premium vehicle data modules.',
                        },
                        unit_amount: 1, // 1 credit = 1 cent ($0.01)
                    },
                    quantity: parsedAmount,
                },
            ],
            mode: 'payment',
            success_url: `${origin}/#/account?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${origin}/#/account?purchase=cancel`,
            client_reference_id: userId,
            metadata: {
                userId: String(userId),
                credits: String(parsedAmount)
            }
        });

        return session.url;
    } catch (error) {
        logger.error('Stripe session creation failed:', error);
        throw error;
    }
}

/**
 * Create a Stripe Customer Billing Portal session.
 * Customer must have made at least one purchase (customer ID stored in Supabase).
 * @param {string} customerId - Stripe customer ID (cus_xxx)
 * @param {string} returnUrl - URL to redirect after portal (e.g. origin + /#/account)
 */
export async function createBillingPortalSession(customerId, returnUrl) {
    if (!customerId) {
        throw new Error('No billing account. Make a purchase first to manage payment methods.');
    }
    try {
        const s = getStripe();
        const session = await s.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl
        });
        return session.url;
    } catch (error) {
        logger.error('Stripe billing portal session failed:', error);
        throw error;
    }
}

/**
 * Verify a completed checkout session and add credits if not already fulfilled.
 * Called by the frontend on return from Stripe checkout as a reliable fallback
 * for when webhooks are unavailable (e.g. local dev without Stripe CLI).
 */
export async function verifyAndFulfillSession(sessionId, callerUserId) {
    const s = getStripe();
    const session = await s.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
        return { fulfilled: false, reason: 'Payment not completed' };
    }

    const userId = session.metadata?.userId || session.client_reference_id;
    const credits = parseInt(session.metadata?.credits, 10);

    if (!userId || !credits) {
        return { fulfilled: false, reason: 'Missing user or credits metadata' };
    }

    if (userId !== callerUserId) {
        logger.warn(`[verify] Ownership mismatch: caller ${callerUserId} tried to verify session owned by ${userId}`);
        return { fulfilled: false, reason: 'Session does not belong to this user' };
    }

    const usdCents = session.amount_total;

    const result = await addCredits(userId, credits, {
        stripeSessionId: sessionId,
        stripePaymentIntent: session.payment_intent,
        usdCents
    });
    logger.info(`[verify] Fulfilled session ${sessionId} for user ${userId}`);

    if (session.customer) {
        await setStripeCustomerId(userId, session.customer);
    }

    return { fulfilled: true, credits: result.credits, unlocks: result.unlocks };
}

export async function handleWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();

    let event;

    try {
        const s = getStripe();
        event = s.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        logger.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.metadata.userId || session.client_reference_id;
        const credits = parseInt(session.metadata.credits, 10);
        const usdCents = session.amount_total;
        const stripeCustomerId = session.customer;

        if (userId && credits) {
            await addCredits(userId, credits, {
                stripeSessionId: session.id,
                stripePaymentIntent: session.payment_intent,
                usdCents
            });
            logger.info(`Added ${credits} credits to user ${userId}`);

            // Store stripe customer ID for future portal access
            if (stripeCustomerId) {
                await setStripeCustomerId(userId, stripeCustomerId);
            }
        }
    }

    res.json({ received: true });
}