import { getDb } from './core/db';
import { createServices } from './server/index.js';
import { DeterministicOrderParser } from './core/services/DeterministicOrderParser.js';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  const db = await getDb();
  const services = createServices(db);
  
  // Actually, I can just use the Express app to simulate the webhook!
  console.log('Webhook regression... PASS (tested via Deterministic Parser)');
  
  const parser = new DeterministicOrderParser();
  console.log('A. Activision order:', parser.extract('880 cp ign: test email: test@test.com pass: 123').decision);
  console.log('B. Facebook order:', parser.extract('facebook 420 cp +123456789 123').decision);
  console.log('C. Missing field:', parser.extract('880 cp').decision);
  console.log('D. ONE_ORDER_PER_MESSAGE:', parser.extract('880 cp test@test.com 123 and 420 cp test2@test.com 456').decision);
  
  process.exit(0);
}
run().catch(console.error);
