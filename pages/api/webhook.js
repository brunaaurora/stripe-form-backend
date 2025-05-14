import Stripe from 'stripe';
import { google } from 'googleapis';
import { buffer } from 'micro';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    try {
      const metadata = session.metadata || {};
      const timestamp = new Date().toISOString();
      
      // Parse photo URLs if they exist
      const photoUrls = metadata.photoUrls ? metadata.photoUrls.split(',') : [];
      
      // Initialize Google Sheets
      const sheets = await initGoogleSheets();
      
      // Get the customer's first and last name
      const fullName = session.customer_details.name || '';
      const [firstName, ...lastNameParts] = fullName.split(' ');
      const lastName = lastNameParts.join(' ');
      
      // Prepare the row data - ORDER MUST MATCH YOUR SHEET COLUMNS
      const rowData = [
        timestamp,                          // A: Timestamp
        firstName,                          // B: First Name
        lastName,                           // C: Last Name
        session.customer_details.email,     // D: Email
        metadata.age || '',                 // E: Age
        metadata.primaryConcern || '',      // F: Primary Concern
        metadata.additionalConcerns || '',  // G: Additional Concerns
        metadata.goals || '',               // H: Goals
        metadata.previousProcedures || '',  // I: Previous Procedures (NEW)
        session.amount_total / 100,         // J: Amount
        'Paid',                            // K: Payment Status
        session.payment_intent,             // L: Payment ID
        metadata.photoCount || '0',         // M: Photo Count
        photoUrls.join('\n'),              // N: Photo URLs
      ];
      
      // IMPORTANT: Use "stripe" sheet name, not "Sheet1"
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'stripe!A:N', // Updated to use correct sheet name
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [rowData],
        },
      });
      
      console.log('Sheet updated successfully:', response.data);
      
    } catch (error) {
      console.error('Error updating Google Sheet:', error);
      console.error('Error details:', error.message);
    }
  }

  res.status(200).json({ received: true });
}
