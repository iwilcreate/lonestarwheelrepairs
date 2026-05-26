// api/shop-apply.js — Vercel Serverless Function
// Saves shop application to Supabase shop_applications table
// and sends email notification via Formspree

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      shop_name, owner_name, phone, email,
      zip, city, tier, radius
    } = req.body || {};

    // ── 1. Save application to Supabase ────────────────────────
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: application, error: appError } = await supabase
      .from('shop_applications')
      .insert({
        shop_name,
        owner_name,
        phone,
        email,
        zip,
        city,
        tier,
        radius: radius ? parseInt(radius, 10) : null
      })
      .select('id')
      .single();

    if (appError) {
      console.error('[shop-apply] Supabase insert error:', appError.message);
      // Don't block the user — still return success
    } else {
      console.log('[shop-apply] Application saved:', application.id);
    }

    // ── 2. Email notification via Formspree ─────────────────────
    if (process.env.FORMSPREE_SHOP_APPLY_ID) {
      const formspreeRes = await fetch(
        `https://formspree.io/f/${process.env.FORMSPREE_SHOP_APPLY_ID}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            subject:    `New Shop Application — ${shop_name}`,
            shop_name,
            owner_name,
            phone,
            email,
            city,
            zip,
            tier,
            radius:     radius ? `${radius} miles` : 'Not specified',
            submitted:  new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }) + ' CST'
          })
        }
      ).catch(err => console.warn('[shop-apply] Formspree error:', err));

      if (formspreeRes && !formspreeRes.ok) {
        console.warn('[shop-apply] Formspree returned non-OK status');
      }
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[shop-apply] Unhandled error:', err.message);
    // Never block the user's form submission
    return res.status(200).json({ success: true, error: err.message });
  }
};
