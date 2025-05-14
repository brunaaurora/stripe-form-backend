import Stripe from 'stripe';
import { google } from 'googleapis';
import { buffer } from 'micro';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Disable body parsing, we need raw body for webhook signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

// Initialize Google Sheets
const initGoogleSheets = async () => {
  const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '{}');
  
  const auth = new google.auth.GoogleAuth({
    credentials: credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  return sheets;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook Error:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    try {
      // Extract metadata
      const metadata = session.metadata || {};
      const timestamp = new Date().toISOString();
      
      // Parse photo URLs if they exist
      const photoUrls = metadata.photoUrls ? metadata.photoUrls.split(',') : [];
      
      // Initialize Google Sheets
      const sheets = await initGoogleSheets();
      
      // Prepare the row data
      const rowData = [
        timestamp,                          // Timestamp
        session.customer_details.name,      // Customer Name
        session.customer_details.email,     // Email
        metadata.age || '',                 // Age
        metadata.primaryConcern || '',      // Primary Concern
        metadata.additionalConcerns || '',  // Additional Concerns
        metadata.goals || '',               // Goals
        session.amount_total / 100,         // Amount (convert from cents)
        'Paid',                            // Payment Status
        session.payment_intent,             // Payment Intent ID
        metadata.photoCount || '0',         // Photo Count
        photoUrls.join('\n'),              // Photo URLs (each on new line)
      ];
      
      // Append to Google Sheet
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Sheet1!A:L', // Adjust based on your sheet structure
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [rowData],
        },
      });
      
      console.log('Sheet updated successfully:', response.data);
      
    } catch (error) {
      console.error('Error updating Google Sheet:', error);
      // Don't return error to Stripe - we still want to acknowledge receipt
    }
  }

  // Return a 200 response to acknowledge receipt of the event
  res.status(200).json({ received: true });
}
