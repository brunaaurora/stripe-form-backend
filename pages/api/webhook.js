export default async function handler(req, res) {
    // ... existing setup code ...
    
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        
        try {
            const metadata = session.metadata || {};
            const timestamp = new Date().toISOString();
            
            // Initialize Google Sheets
            const sheets = await initGoogleSheets();
            
            // Get the headers from the sheet to know the column order
            const headerResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: process.env.GOOGLE_SHEET_ID,
                range: 'stripe!1:1', // First row with headers
            });
            
            const headers = headerResponse.data.values[0];
            
            // Build row data dynamically based on headers
            const rowData = headers.map(header => {
                // Map common fields
                switch(header.toLowerCase()) {
                    case 'timestamp':
                        return timestamp;
                    case 'email':
                        return session.customer_details.email;
                    case 'amount':
                        return session.amount_total / 100;
                    case 'payment status':
                        return 'Paid';
                    case 'payment id':
                        return session.payment_intent;
                    default:
                        // For all other fields, check metadata
                        // Convert header to camelCase to match metadata keys
                        const metadataKey = header.replace(/\s+/g, '').toLowerCase();
                        return metadata[metadataKey] || '';
                }
            });
            
            // Append to sheet
            const response = await sheets.spreadsheets.values.append({
                spreadsheetId: process.env.GOOGLE_SHEET_ID,
                range: 'stripe!A:Z',
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS',
                resource: {
                    values: [rowData],
                },
            });
            
            console.log('Sheet updated successfully');
            
        } catch (error) {
            console.error('Error updating sheet:', error);
        }
    }
    
    res.status(200).json({ received: true });
}
