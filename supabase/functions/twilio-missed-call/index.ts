import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const bodyText = await req.text();
    const params = new URLSearchParams(bodyText);
    const callStatus = params.get('CallStatus') || params.get('DialCallStatus');
    const fromNumber = params.get('From');
    const toNumber = params.get('To');

    console.log(`[Twilio Webhook] CallStatus: ${callStatus}, From: ${fromNumber}, To: ${toNumber}`);

    // Standard missed call statuses from Twilio
    const missedStatuses = ['no-answer', 'busy', 'canceled', 'failed'];

    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

    if (missedStatuses.includes(callStatus?.toLowerCase() || '')) {
      const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
      const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
      const twilioPhoneNumber = Deno.env.get('TWILIO_PHONE_NUMBER') || toNumber;

      if (twilioAccountSid && twilioAuthToken && fromNumber && twilioPhoneNumber) {
        const smsMessage = "Sorry we missed your call! This is Sherman Oaks Home Pros. How can we help you with your tree service needs today?";
        
        const smsUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
        const authHeader = "Basic " + btoa(`${twilioAccountSid}:${twilioAuthToken}`);

        const formData = new URLSearchParams();
        formData.append('To', fromNumber);
        formData.append('From', twilioPhoneNumber);
        formData.append('Body', smsMessage);

        const smsRes = await fetch(smsUrl, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData,
        });

        console.log(`[Twilio SMS Response] Status: ${smsRes.status}`);
      } else {
        console.warn("[Twilio Webhook] Missing TWILIO environment variables or phone numbers.");
      }
    }

    return new Response(twimlResponse, {
      headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
      status: 200,
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[Twilio Webhook Error]", error);
    return new Response(JSON.stringify({ error }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
