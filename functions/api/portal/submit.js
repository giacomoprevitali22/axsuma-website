// Cloudflare Pages Function — Portal form submission handler
// Stores submission in KV, sends email notification via Resend
// Environment variables needed: RESEND_API_KEY, PORTAL_KV (KV namespace binding)

export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const body = await context.request.json();
    const formType = body._formType || 'unknown';
    const submittedAt = body._submittedAt || new Date().toISOString();
    const submissionId = `${formType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Build submission record
    const submission = {
      id: submissionId,
      formType,
      submittedAt,
      status: 'new',
      data: body,
    };

    // Store in KV
    const kv = context.env.PORTAL_KV;
    if (kv) {
      // Store individual submission
      await kv.put(`submission:${submissionId}`, JSON.stringify(submission), {
        metadata: { formType, status: 'new', submittedAt },
      });

      // Update index (list of all submission IDs, newest first)
      let index = [];
      try {
        const raw = await kv.get('submissions:index');
        if (raw) index = JSON.parse(raw);
      } catch (e) { /* fresh start */ }
      index.unshift(submissionId);
      await kv.put('submissions:index', JSON.stringify(index));
    }

    // Determine contact email from form data
    const contactEmail = body.email || body.contact_email || body.appointor_email || '';
    const contactName = body.contact_name || body.appointor_name || '';
    const orgName = body.practice_name || body.organisation || body.company_name || '';

    // Friendly form type labels
    const typeLabels = {
      'company-formation-ltd': 'Company Formation — Private Limited',
      'company-formation-llp': 'Company Formation — LLP',
      'process-agent': 'Process Agent Order',
      'roe-new': 'ROE — New Registration',
      'roe-transfer': 'ROE — Transfer-In',
      'ma-enquiry': 'M&A Support Enquiry',
      'director-enquiry': 'Professional Director Services Enquiry',
      'address-for-service': 'UK Address for IP Service (IP)',
    };
    const typeLabel = typeLabels[formType] || formType;

    // Build HTML email body
    const rows = Object.entries(body)
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => {
        const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const val = Array.isArray(v) ? v.join(', ') : (v || '—');
        return `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:500;color:#2a2f36;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#3d434d">${val}</td></tr>`;
      })
      .join('');

    const htmlBody = `
      <div style="font-family:'DM Sans',Arial,sans-serif;max-width:680px;margin:0 auto">
        <div style="background:#00594a;padding:20px 24px;border-radius:8px 8px 0 0">
          <h2 style="color:#fff;margin:0;font-size:18px">New Portal Submission: ${typeLabel}</h2>
        </div>
        <div style="background:#fff;border:1px solid #e2e5e9;border-top:none;padding:24px;border-radius:0 0 8px 8px">
          <p style="color:#6b7280;font-size:14px;margin-bottom:16px">Submitted: ${new Date(submittedAt).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table>
          <p style="margin-top:20px;font-size:12px;color:#8a919c">Submission ID: ${submissionId}</p>
        </div>
      </div>
    `;

    // Send email via Resend
    const resendKey = context.env.RESEND_API_KEY;
    if (resendKey) {
      const recipients = ['enquiries@axsuma.co.uk'];

      // Send to Axsuma team
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Axsuma Portal <portal@axsuma.co.uk>',
          to: recipients,
          subject: `[Portal] ${typeLabel} — ${contactName || orgName || 'New Submission'}`,
          html: htmlBody,
        }),
      });

      // Send confirmation to client
      if (contactEmail) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Axsuma Portal <portal@axsuma.co.uk>',
            to: [contactEmail],
            subject: `Your ${typeLabel} has been received — Axsuma`,
            html: `
              <div style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;margin:0 auto">
                <div style="background:#00594a;padding:20px 24px;border-radius:8px 8px 0 0">
                  <h2 style="color:#fff;margin:0;font-size:18px">Submission Confirmed</h2>
                </div>
                <div style="background:#fff;border:1px solid #e2e5e9;border-top:none;padding:24px;border-radius:0 0 8px 8px">
                  <p style="color:#2a2f36;font-size:14px;line-height:1.7">Dear ${contactName || 'Client'},</p>
                  <p style="color:#3d434d;font-size:14px;line-height:1.7">Thank you for your submission. We have received your <strong>${typeLabel}</strong> and our team will review it shortly.</p>
                  <p style="color:#3d434d;font-size:14px;line-height:1.7">We will be in touch within two working days. If you have any urgent queries, please contact us at <a href="mailto:enquiries@axsuma.co.uk" style="color:#00594a">enquiries@axsuma.co.uk</a>.</p>
                  <p style="color:#8a919c;font-size:12px;margin-top:20px">Reference: ${submissionId}</p>
                </div>
              </div>
            `,
          }),
        });
      }
    }

    return new Response(JSON.stringify({ success: true, id: submissionId }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to process submission', detail: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
