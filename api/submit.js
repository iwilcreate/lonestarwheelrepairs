// api/submit.js — Vercel Serverless Function
// 1. Saves lead to Supabase (leads + lead_assignments tables)
// 2. Dispatches SMS to shops via Twilio

const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
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
      photos_count, language,
      submitted_at
    } = req.body || {};

    // ── 1. Save lead to Supabase ────────────────────────────
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    let leadId = null;

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .insert({
        name, phone, email,
        city, zip,
        vehicle_year, vehicle_make, vehicle_model,
        wheel_count, repair_type, damage_desc,
        photos_count: photos_count || 0,
        language:     language || 'English'
      })
      .select('id')
      .single();

    if (leadError) {
      console.error('[submit] Supabase lead insert error:', leadError.message);
    } else {
      leadId = lead.id;
    }

    // ── 2. Assign lead to all active shops ──────────────────
    if (leadId) {
      const { data: shops, error: shopsError } = await supabase
        .from('shops')
        .select('id')
        .eq('active', true);

      if (shopsError) {
        console.error('[submit] Supabase shops fetch error:', shopsError.message);
      } else if (shops && shops.length > 0) {
        const assignments = shops.slice(0, 5).map(s => ({
          lead_id: leadId,
          shop_id: s.id,
          status:  'new'
        }));

        const { error: assignError } = await supabase
          .from('lead_assignments')
          .insert(assignments);

        if (assignError) {
          console.error('[submit] Supabase assignment insert error:', assignError.message);
        } else {
          console.log(`[submit] Lead ${leadId} assigned to ${assignments.length} shop(s)`);
        }
      }
    }

    // ── 3. Build SMS message ────────────────────────────────
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
      `Reply to customer directly to claim this lead.`,
      `─ lonestarwheelrepairs.com/dashboard ─`
    ].filter(l => l !== null).join('\n');

    // ── 4. Send SMS via Twilio ──────────────────────────────
    let shopNumbers = (process.env.SHOP_PHONE_NUMBERS || '')
      .split(',').map(n => n.trim()).filter(Boolean);

    if (process.env.SHOP_NUMBERS_JSON) {
      try {
        const registry = JSON.parse(process.env.SHOP_NUMBERS_JSON);
        const key = (city || '').toLowerCase().replace(/[^a-z]/g, '_').replace(/_+/g, '_');
        shopNumbers = registry[key] || registry['default'] || shopNumbers;
      } catch (e) {
        console.warn('[submit] SHOP_NUMBERS_JSON parse error — using SHOP_PHONE_NUMBERS');
      }
    }

    shopNumbers = shopNumbers.slice(0, 5);

    if (shopNumbers.length > 0 && process.env.TWILIO_ACCOUNT_SID) {
      const twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );

      const results = await Promise.allSettled(
        shopNumbers.map(to =>
          twilioClient.messages.create({
            body: smsBody,
            from: process.env.TWILIO_PHONE_NUMBER,
            to
          })
        )
      );

      const sent   = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      console.log(`[submit] SMS: ${sent} sent, ${failed} failed`);
    } else if (!process.env.TWILIO_ACCOUNT_SID) {
      console.warn('[submit] Twilio not configured — SMS skipped');
    }

    return res.status(200).json({ success: true, lead_id: leadId });

  } catch (err) {
    console.error('[submit] Unhandled error:', err.message);
    // Never block the user's form submission
    return res.status(200).json({ success: true, error: err.message });
  }
};
