
import Stripe from 'stripe';
import { config } from './config.js';
import { addCredits } from './credits.js';
import logger from './logger.js';

let stripe;

function getStripe() {
    if (!stripe) {
        if (!process.env.STRIPE_SECRET_KEY) {
            throw new Error('STRIPE_SECRET_KEY is not set');
        }
        stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    }
    return stripe;
}

export async function createCheckoutSession(userId, amount, origin) {
    if (amount < 1000) {
        throw new Error('Minimum purchase is 1000 credits ($10)');
    }

    try {
        const stripe = getStripe();
        const session = await stripe.checkout.sessions.create({
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
                    quantity: amount,
                },
            ],
            mode: 'payment',
            success_url: `${origin}/#/credits?purchase=success`,
            cancel_url: `${origin}/#/credits?purchase=cancel`,
            client_reference_id: userId,
            metadata: {
                userId: userId,
                credits: amount
            }
        });

        return session.url;
    } catch (error) {
        logger.error('Stripe session creation failed:', error);
        throw error;
    }
}

export async function handleWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        const stripe = getStripe();
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        logger.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.metadata.userId;
        const credits = parseInt(session.metadata.credits, 10);

        if (userId && credits) {
            await addCredits(userId, credits);
            logger.info(`Added ${credits} credits to user ${userId}`);
        }
    }

    res.json({ received: true });
}
