// pages/api/webhook.js
import Stripe from 'stripe';
import { google } from 'googleapis';
import { buffer } from 'micro';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Configure body parser
export const config = {
  api: {
    bodyParser: false,
  },
};

// Store data in Google Sheets - DYNAMIC VERSION
async function storeDataInGoogleSheets(formData) {
  console.log("Starting storeDataInGoogleSheets function");
  console.log("Form data to be stored:", JSON.stringify(formData, null, 2));
  
  try {
    // Get the service account credentials from environment variable
    const credentialsString = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    
    if (!credentialsString) {
      console.error("GOOGLE_APPLICATION_CREDENTIALS_JSON is not set");
      return;
    }
    
    console.log("Credentials string length:", credentialsString?.length);
    
    let credentials;
    try {
      credentials = JSON.parse(credentialsString);
      console.log("Parsed credentials successfully");
      console.log("Client email:", credentials.client_email);
    } catch (parseError) {
      console.error("Error parsing Google credentials:", parseError);
      return;
    }
    
    if (!credentials.client_email || !credentials.private_key) {
      console.error('Missing or invalid Google credentials');
      return;
    }
    
    // Set up Google Sheets API
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    
    console.log("JWT auth created");
    
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.SPREADSHEET_ID;
    
    console.log("Spreadsheet ID:", spreadsheetId);
    
    if (!spreadsheetId) {
      console.error('Missing spreadsheet ID');
      return;
    }
    
    // First, get the headers from the first row (if they exist)
    let headers = [];
    try {
      const headerResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Sheet1!1:1',
      });
      
      headers = headerResponse.data.values?.[0] || [];
      console.log("Existing headers:", headers);
    } catch (error) {
      console.log("No existing headers found, will create them");
    }
    
    // Extract all field names from formData (dynamic approach)
    const formDataFields = Object.keys(formData).sort();
    
    // Create or update headers if needed
    const requiredHeaders = [
      'timestamp',
      'paymentStatus',
      'paymentId',
      'paymentAmount',
      ...formDataFields
    ];
    
    // Deduplicate headers
    const uniqueHeaders = [...new Set(requiredHeaders)];
    
    // If headers don't exist or are incomplete, update them
    if (headers.length === 0 || !uniqueHeaders.every(h => headers.includes(h))) {
      headers = uniqueHeaders;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Sheet1!A1',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [headers],
        },
      });
      console.log("Updated headers:", headers);
    }
    
    // Create data row based on header order
    const rowData = headers.map(header => {
      switch (header) {
        case 'timestamp':
          return formData.timestamp;
        case 'paymentStatus':
          return formData.paymentStatus;
        case 'paymentId':
          return formData.paymentId;
        case 'paymentAmount':
          return formData.paymentAmount;
        default:
          // For dynamic fields
          if (header === 'photoUrls' && Array.isArray(formData[header])) {
            // Join photo URLs with line breaks
            return formData[header].join('\n');
          }
          return formData[header] || '';
      }
    });
    
    console.log("Row data to append:", rowData);
    
    // Append data to the Google Sheet
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A:Z', // Extended range to accommodate dynamic fields
      valueInputOption: 'USER_ENTERED',
      resource: { values: [rowData] },
    });
    
    // Auto-resize all columns
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId: 0, // First sheet
                dimension: 'COLUMNS',
                startIndex: 0,
                endIndex: headers.length
              }
            }
          }
        ]
      }
    });
    
    console.log('Data stored in Google Sheets successfully');
    console.log('Response:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('Error storing data in Google Sheets:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

export default async function handler(req, res) {
  console.log("Webhook handler called");
  console.log("Request method:", req.method);
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  
  if (req.method !== 'POST') {
    console.log("Method not allowed:", req.method);
    return res.status(405).end('Method Not Allowed');
  }

  try {
    // Get raw body for Stripe webhook verification
    console.log("Getting raw body");
    const rawBody = await buffer(req);
    console.log("Raw body length:", rawBody.length);
    
    const sig = req.headers['stripe-signature'];
    console.log("Stripe signature present:", !!sig);
    
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    console.log("Webhook secret present:", !!endpointSecret);
    console.log("Webhook secret starts with:", endpointSecret?.substring(0, 8));
    
    let event;
    
    // Verify the event came from Stripe
    try {
      event = stripe.webhooks.constructEvent(
        rawBody, 
        sig, 
        endpointSecret
      );
      console.log('Webhook signature verified successfully');
      console.log('Event type:', event.type);
      console.log('Event ID:', event.id);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      console.error('Error type:', err.type);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
      console.log('Processing checkout.session.completed event');
      
      const session = event.data.object;
      console.log('Session ID:', session.id);
      console.log('Session metadata:', JSON.stringify(session.metadata, null, 2));
      
      // Extract ALL metadata from the session dynamically
      const metadata = session.metadata || {};
      
      // Get customer details from the session
      const customerDetails = session.customer_details;
      const customerEmail = customerDetails?.email;
      const customerName = customerDetails?.name || metadata.customerName || 'Unknown';
      
      console.log('Customer email:', customerEmail);
      console.log('Customer name:', customerName);
      
      // Create comprehensive data object with all fields
      const formData = {
        // System fields
        timestamp: new Date().toISOString(),
        paymentStatus: 'completed',
        paymentId: session.payment_intent,
        paymentAmount: session.amount_total / 100, // Convert from cents
        
        // Customer info
        name: customerName,
        email: customerEmail,
        
        // All dynamic form fields from metadata
        ...metadata,
        
        // Process photo URLs if they exist
        photoUrls: metadata.photoUrls ? metadata.photoUrls.split(',') : [],
      };
      
      // Remove duplicate or unnecessary fields
      if (formData.customerName && formData.name === formData.customerName) {
        delete formData.customerName;
      }
      
      console.log('Form data created:', JSON.stringify(formData, null, 2));
      console.log('Processing completed payment for:', customerEmail);
      
      try {
        // Store data in Google Sheets
        await storeDataInGoogleSheets(formData);
        console.log('Payment data successfully processed');
      } catch (error) {
        console.error('Error processing payment data:', error);
        // We still return 200 to Stripe so they don't retry the webhook
      }
    } else {
      console.log('Unhandled event type:', event.type);
    }

    // Return a 200 response to acknowledge receipt of the event
    console.log('Sending success response');
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
}
