const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const sendVerificationEmail = async (email, username, token) => {
  const verifyUrl = `${FRONTEND_URL}/verify-email/${token}`;

  await transporter.sendMail({
    from: `"Imposter Game" <${process.env.SMTP_USER}>`,
    to: email,
    subject: '🕵️ Verify your Imposter Game account',
    html: `
      <div style="font-family: monospace; max-width: 600px; margin: 0 auto; background: #282828; color: #ebdbb2; padding: 40px; border-radius: 8px;">
        <h1 style="color: #d79921;">🕵️ Imposter Game</h1>
        <h2>Hey ${username}!</h2>
        <p>Verify your email to make your account permanent (otherwise it expires in 30 days).</p>
        <a href="${verifyUrl}" style="display: inline-block; background: #458588; color: #ebdbb2; padding: 12px 24px; border-radius: 4px; text-decoration: none; margin: 20px 0;">
          Verify Email
        </a>
        <p style="color: #928374; font-size: 12px;">Link expires in 24 hours. If you didn't sign up, ignore this.</p>
      </div>
    `,
  });
};

const sendPasswordResetEmail = async (email, username, token) => {
  const resetUrl = `${FRONTEND_URL}/reset-password/${token}`;

  await transporter.sendMail({
    from: `"Imposter Game" <${process.env.SMTP_USER}>`,
    to: email,
    subject: '🔑 Reset your Imposter Game password',
    html: `
      <div style="font-family: monospace; max-width: 600px; margin: 0 auto; background: #282828; color: #ebdbb2; padding: 40px; border-radius: 8px;">
        <h1 style="color: #d79921;">🕵️ Imposter Game</h1>
        <h2>Password Reset for ${username}</h2>
        <p>Click below to reset your password. This link expires in 1 hour.</p>
        <a href="${resetUrl}" style="display: inline-block; background: #cc241d; color: #ebdbb2; padding: 12px 24px; border-radius: 4px; text-decoration: none; margin: 20px 0;">
          Reset Password
        </a>
        <p style="color: #928374; font-size: 12px;">If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
};

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
