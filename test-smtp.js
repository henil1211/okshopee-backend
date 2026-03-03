import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
dotenv.config({ path: path.join(__dirname, '.env') });

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_IGNORE_TLS = process.env.SMTP_IGNORE_TLS === 'true';
const SMTP_REQUIRE_TLS = process.env.SMTP_REQUIRE_TLS === 'true';
const SMTP_TLS_REJECT_UNAUTHORIZED = process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || '';

console.log('--- Testing SMTP Configuration ---');
console.log(`Host: ${SMTP_HOST}`);
console.log(`Port: ${SMTP_PORT}`);
console.log(`Secure: ${SMTP_SECURE}`);
console.log(`Ignore TLS: ${SMTP_IGNORE_TLS}`);
console.log(`Reject Unauthorized: ${SMTP_TLS_REJECT_UNAUTHORIZED}`);
console.log(`User: ${SMTP_USER}`);
console.log(`From: ${SMTP_FROM}`);

async function testConnection() {
    const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        ignoreTLS: SMTP_IGNORE_TLS,
        requireTLS: SMTP_REQUIRE_TLS,
        tls: {
            rejectUnauthorized: SMTP_TLS_REJECT_UNAUTHORIZED
        },
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS
        }
    });

    try {
        console.log('\nVerifying connection...');
        const verified = await transporter.verify();
        if (verified) {
            console.log('✅ Connection verified successfully!');

            console.log('\nAttempting to send test email...');
            const info = await transporter.sendMail({
                from: SMTP_FROM,
                to: 'henilpatel5050@gmail.com', // User requested default
                subject: 'SMTP Test - Support',
                text: 'This is a test email to verify SMTP configuration.'
            });
            console.log('✅ Email sent successfully!');
            console.log('Message ID:', info.messageId);
        }
    } catch (error) {
        console.error('❌ Connection failed:');
        console.error(error.message);
        if (error.code) console.error('Error Code:', error.code);
        if (error.command) console.error('Command:', error.command);
    }
}

testConnection();
