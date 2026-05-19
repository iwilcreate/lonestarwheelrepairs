// api/submit.js — Vercel Serverless Function
// Receives lead JSON from the quote form and dispatches SMS to shops via Twilio.
// Runs alongside Formspree (which handles email backup).

const twilio = require('twilio');

module.exports = async function handler(req, res) {
  // CORS — allow the site to call this endpoint
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      name, phone, email,
      city, zip,
      vehicle_year, vehicle_make, vehicle_model,
      wheel_count, repair_type, damage_desc,
      submitted_at
    } = req.body || {};

    // ── Build SMS message ────────────────────────────────────────
    const location = city ? `${city}, TX` : zip ? `ZIP ${zip}, TX` : 'Texas';
    const vehicle  = [vehicle_year, vehicle_make, vehicle_model].filter(Boolean).join(' ') || 'Not specified';
    const wheels   = wheel_count ? `${wheel_count} wheel(s)` : '';
    const repair   = [repair_type, wheels].filter(Boolean).join(' — ') || 'Not specified';

    const smsBody = [
      `🔧 NEW LEAD — Lone Star Wheel Repairs`,
      `📍 ${location}`,
      `🚗 ${vehicle}`,
      `🔩 Repair: ${repair}`,
      damage_desc ? `⚠️  "${damage_desc}"` : null,
      ``,
      `👤 ${name || 'Unknown'}`,
      `📞 ${phone || 'N/A'}`,
      `✉️  ${email || 'N/A'}`,
      ``,
      `⏰ ${submitted_at || new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} CST`,
      ``,
      `Reply to the customer directly to claim this lead.`,
      `─ lonestarwheelrepairs.com ─`
    ].filter(line => line !== null).join('\n');

    // ── Load shop phone numbers ──────────────────────────────────
    // Set SHOP_PHONE_NUMBERS in Vercel env vars as a comma-separated list:
    //   e.g.  +12145550001,+17135550002,+12105550003
    // You can also use SHOP_NUMBERS_JSON for city-specific routing (see README comment below).
    let shopNumbers = [];

    // Option A: flat comma-separated list (easiest to start)
    const flat = (process.env.SHOP_PHONE_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);
    if (flat.length) {
      shopNumbers = flat;
    }

    // Option B: JSON map keyed by city slug — overrides Option A if present
    // Format: { "dallas": ["+12145550001"], "houston": ["+17135550002"], "default": ["+12145550001"] }
    if (process.env.SHOP_NUMBERS_JSON) {
      try {
        const registry = JSON.parse(process.env.SHOP_NUMBERS_JSON);
        const key = (city || '').toLowerCase().replace(/[^a-z]/g, '_').replace(/_+/g, '_');
        shopNumbers = registry[key] || registry['default'] || flat;
      } catch (parseErr) {
        console.warn('SHOP_NUMBERS_JSON parse error — falling back to SHOP_PHONE_NUMBERS');
      }
    }

    // Cap at 5 shops per lead
    shopNumbers = shopNumbers.slice(0, 5);

    if (!shopNumbers.length) {
      console.warn('No shop numbers configured. Set SHOP_PHONE_NUMBERS in Vercel env vars.');
      return res.status(200).json({ success: true, sent: 0, warning: 'No shop numbers configured' });
    }

    // ── Send SMS via Twilio ──────────────────────────────────────
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const results = await Promise.allSettled(
      shopNumbers.map(to =>
        client.messages.create({
          body: smsBody,
          from: process.env.TWILIO_PHONE_NUMBER,
          to
        })
      )
    );

    const sent   = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').map(r => r.reason?.message);

    console.log(`[submit] SMS sent: ${sent}/${shopNumbers.length}`, failed.length ? `Errors: ${failed}` : '');

    return res.status(200).json({ success: true, sent, failed: failed.length });

  } catch (err) {
    // Never block the user's form submission because of an SMS error
    console.error('[submit] Unhandled error:', err.message);
    return res.status(200).json({ success: true, sms_error: err.message });
  }
};

/*
──────────────────────────────────────────────
  CITY-BASED ROUTING (future upgrade)
──────────────────────────────────────────────
  When you have multiple shops per city, set SHOP_NUMBERS_JSON:

  {
    "dallas":      ["+12145550001", "+12145550002"],
    "houston":     ["+17135550001", "+17135550002"],
    "san_antonio": ["+12105550001"],
    "austin":      ["+15125550001"],
    "default":     ["+12145550001"]   <- fallback for other cities
  }

  Lone Star sends the lead to shops in the matching city only.
  "default" is used when no city match is found.
──────────────────────────────────────────────
*/
