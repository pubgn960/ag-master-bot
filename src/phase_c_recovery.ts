import { getDb } from './core/db/index.js';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';

const NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341'; 

const purchaseCosts = [
  { cp: 80, cost: 0.88, sale: 0.90, target: 0.02 },
  { cp: 420, cost: 3.70, sale: 4.50, target: 0.80 },
  { cp: 880, cost: 6.50, sale: 7.50, target: 1.00 },
  { cp: 2400, cost: 14.00, sale: 15.50, target: 1.50 },
  { cp: 4800, cost: 28.50, sale: 28.50, target: 1.50 },
  { cp: 5000, cost: 29.50, sale: 30.50, target: 1.50 },
  { cp: 7200, cost: 40.50, sale: 41.50, target: 1.50 },
  { cp: 9600, cost: 54.00, sale: 55.00, target: 1.50 },
  { cp: 10800, cost: 62.50, sale: 63.50, target: 1.50 },
  { cp: 12000, cost: 67.50, sale: 68.50, target: 1.50 },
  { cp: 14400, cost: 81.00, sale: 82.00, target: 1.50 },
  { cp: 16800, cost: 94.00, sale: 95.00, target: 1.50 },
  { cp: 19200, cost: 108.00, sale: 109.00, target: 1.50 },
  { cp: 21600, cost: 116.50, sale: 117.50, target: 1.50 },
  { cp: 24000, cost: 130.00, sale: 131.00, target: 1.50 },
  { cp: 26400, cost: 143.00, sale: 144.00, target: 1.50 },
  { cp: 28800, cost: 156.00, sale: 157.00, target: 1.50 },
  { cp: 31200, cost: 169.00, sale: 169.50, target: 1.50 },
  { cp: 33600, cost: 182.00, sale: 182.50, target: 1.50 },
  { cp: 36000, cost: 196.00, sale: 196.00, target: 1.50 },
  { cp: 38400, cost: 208.00, sale: 210.00, target: 1.50 },
  { cp: 43200, cost: 225.00, sale: 227.00, target: 1.50 },
  { cp: 48000, cost: 250.00, sale: 252.00, target: 1.50 },
  { cp: 55200, cost: 287.00, sale: 289.00, target: 1.50 },
  { cp: 60000, cost: 312.00, sale: 314.00, target: 1.50 },
  { cp: 72000, cost: 375.00, sale: 377.00, target: 1.50 },
  { cp: 96000, cost: 500.00, sale: 502.00, target: 1.50 },
  { cp: 100800, cost: 525.00, sale: 527.00, target: 1.50 },
  { cp: 108000, cost: 562.00, sale: 564.00, target: 1.50 }
];

const loaders = ['Taha', 'CG-Girl', 'EK', 'Pratik', 'MalharPlays'];

const groups = [
  "𝗖𝗢𝗗𝗠 - ETS Jano", "CODM - MESSY01", "CODM - Muneeb Joiya", "CODM - Itachi Store 🐦⬛", 
  "𝗖𝗢𝗗𝗠 - AMOSahu", "𝗖𝗢𝗗𝗠 - Kyla", "CODM - AVA_Universe1", "CODM - JohnnyStore", 
  "CODM - rubenhilariochuck", "CODM - Ger", "CODM - K K", "CODM - NEXT BOSS", 
  "CODM - Skrill Store", "CODM - Yonathanpp21", "𝗖𝗢𝗗𝗠 - KING_DIABLO", "CODM - KingyanN", 
  "CODM - WrongIvory", "CODM - PINK (JanettGzz)", "𝗖𝗢𝗗𝗠 - MarcosAA", "𝗖𝗢𝗗𝗠- FPL Gaming", 
  "CODM - Lion Shop", "CODM - Ominous (Kakality)", "CODM - Olivio Top Up", "CODM - Michael", 
  "CODM - TV1 CP", "CODM - Pili-CodmVzla1201", "CODM - Peakyblenders", "CODM - Rincon Store", 
  "CODM - Alfa's Store", "𝗖𝗢𝗗𝗠 - Saturno", "CODM - Top Ups Provider", "CODM - Novakhep Store", 
  "𝗖𝗢𝗗𝗠 - NALGONESTOREMX", "CODM - JessAlvarez", "𝗖𝗢𝗗𝗠 - Street", "CODM - Artillero 503", 
  "CODM - Cyber Store", "CODM - DG Hub", "CODM - Kristian517", "𝗖𝗢𝗗𝗠 - Designer010", 
  "CODM - Edu Consuegra", "𝗖𝗢𝗗𝗠 - omaira _carrero12", "𝗖𝗢𝗗𝗠 - Sylvesters", "𝗖𝗢𝗗𝗠 - LpzMich Active", 
  "CODM - SIX.COM", "CODM - Gata Shop", "𝗖𝗢𝗗𝗠 - SOP5oporte", "CODM - Charles STORE", 
  "CODM - HackerV's store", "𝗖𝗢𝗗𝗠 - Cedric_codm", "CODM - Bandit's Castle", "CODM - Anarchy YT", 
  "CODM - CaptEmma KK"
];

function uuid(name: string) { return uuidv5(name, NAMESPACE); }

async function run() {
  let dbUrl = process.env.DATABASE_URL;
  if (dbUrl && dbUrl.includes('postgres.railway.internal')) {
    dbUrl = dbUrl.replace('postgres.railway.internal:5432', 'altaria.proxy.rlwy.net:12197');
    process.env.DATABASE_URL = dbUrl;
  }
  
  const db = await getDb();
  console.log('Synchronizing Phase C Configuration to Staging...');

  // 1. Products (Login Types)
  await db.query(`INSERT INTO products (id, code, name, description) VALUES 
    ($1, 'ACTIVISION', 'Activision Login', 'Activision Call of Duty Mobile Login'),
    ($2, 'FACEBOOK', 'Facebook Login', 'Facebook Call of Duty Mobile Login')
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`, [uuid('Activision Login'), uuid('Facebook Login')]);

  const actRow = await db.query("SELECT id FROM products WHERE code = 'ACTIVISION'");
  const fbRow = await db.query("SELECT id FROM products WHERE code = 'FACEBOOK'");
  const actId = actRow.rows[0].id;
  const fbId = fbRow.rows[0].id;
  
  const ppRowInsert = await db.query(`INSERT INTO price_profiles (id, code, name, pricing_mode, is_default) VALUES 
    ($1, 'DEFAULT_AUTO', 'Automatic Pricing', 'AUTO_PROFIT', true)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, pricing_mode = EXCLUDED.pricing_mode, is_default = EXCLUDED.is_default RETURNING id`, 
    [uuid('DEFAULT_PRICING')]);
  let ppId = ppRowInsert.rows.length ? ppRowInsert.rows[0].id : (await db.query("SELECT id FROM price_profiles WHERE code = 'DEFAULT_AUTO'")).rows[0].id;

  const payRowInsert = await db.query(`INSERT INTO payment_profiles (id, code, name, is_default) VALUES 
    ($1, 'DEFAULT', 'Default Payment Details', true)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_default = EXCLUDED.is_default RETURNING id`, 
    [uuid('DEFAULT_PAYMENT')]);
  let payId = payRowInsert.rows.length ? payRowInsert.rows[0].id : (await db.query("SELECT id FROM payment_profiles WHERE code = 'DEFAULT'")).rows[0].id;

  const promises: Promise<any>[] = [];

  for (const item of purchaseCosts) {
    const actBundleId = uuid(`ACTIVISION_${item.cp}`);
    const fbBundleId = uuid(`FACEBOOK_${item.cp}`);
    const name = item.cp === 420 ? '420 CP (Slow)' : `${item.cp.toLocaleString()} CP`;
    
    await db.query(`INSERT INTO product_bundles (id, product_id, name, cp_quantity, default_target_profit) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (product_id, cp_quantity) DO UPDATE SET name = EXCLUDED.name, default_target_profit = EXCLUDED.default_target_profit`, 
      [actBundleId, actId, name, item.cp, item.target]);
      
    await db.query(`INSERT INTO product_bundles (id, product_id, name, cp_quantity, default_target_profit) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (product_id, cp_quantity) DO UPDATE SET name = EXCLUDED.name, default_target_profit = EXCLUDED.default_target_profit`, 
      [fbBundleId, fbId, name, item.cp, item.target]);
  }

  // Target Profits & Sale Prices (Price Profile Items)
  for (const item of purchaseCosts) {
    const actRow = await db.query(`SELECT id FROM product_bundles WHERE product_id = $1 AND cp_quantity = $2`, [actId, item.cp]);
    const fbRow = await db.query(`SELECT id FROM product_bundles WHERE product_id = $1 AND cp_quantity = $2`, [fbId, item.cp]);
    const actBundleId = actRow.rows[0].id;
    const fbBundleId = fbRow.rows[0].id;
    
    promises.push(db.query(`INSERT INTO price_profile_items (id, price_profile_id, product_id, bundle_id, fixed_sale_price, target_profit) VALUES
      ($1, $2, $3, $4, $5, $6) ON CONFLICT (price_profile_id, bundle_id) DO UPDATE SET fixed_sale_price = EXCLUDED.fixed_sale_price, target_profit = EXCLUDED.target_profit`,
      [uuid(`ACT_PPI_${item.cp}`), ppId, actId, actBundleId, item.sale, item.target]));
      
    promises.push(db.query(`INSERT INTO price_profile_items (id, price_profile_id, product_id, bundle_id, fixed_sale_price, target_profit) VALUES
      ($1, $2, $3, $4, $5, $6) ON CONFLICT (price_profile_id, bundle_id) DO UPDATE SET fixed_sale_price = EXCLUDED.fixed_sale_price, target_profit = EXCLUDED.target_profit`,
      [uuid(`FB_PPI_${item.cp}`), ppId, fbId, fbBundleId, item.sale, item.target]));
  }
  await Promise.all(promises);
  promises.length = 0;


  // Loaders
  for (const loader of loaders) {
    const loaderId = uuid(`loader_${loader}`);
    const code = loader.toUpperCase().replace(/[^A-Z0-9]/g, '');
    await db.query(`INSERT INTO loaders (id, code, display_name, username) VALUES ($1, $2, $3, $4)
      ON CONFLICT (code) DO UPDATE SET display_name = EXCLUDED.display_name, username = EXCLUDED.username`, 
      [loaderId, code, loader, loader]);
  }

  // Loader Prices
  console.log('Syncing loader prices...');
  const malharRow = await db.query("SELECT id FROM loaders WHERE code = 'MALHARPLAYS'");
  const malharId = malharRow.rows[0]?.id || uuid('loader_MalharPlays');

  for (const loader of loaders) {
    const code = loader.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const loaderRow = await db.query(`SELECT id FROM loaders WHERE code = $1`, [code]);
    const loaderId = loaderRow.rows[0].id;
    
    for (const item of purchaseCosts) {
      const actRow = await db.query(`SELECT id FROM product_bundles WHERE product_id = $1 AND cp_quantity = $2`, [actId, item.cp]);
      const fbRow = await db.query(`SELECT id FROM product_bundles WHERE product_id = $1 AND cp_quantity = $2`, [fbId, item.cp]);
      const actBundleId = actRow.rows[0].id;
      const fbBundleId = fbRow.rows[0].id;
      
      promises.push(db.query(`INSERT INTO loader_prices (id, loader_id, product_id, bundle_id, cost, effective_from) VALUES
        ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) ON CONFLICT (id) DO NOTHING`,
        [uuid(`LCOST_${loader}_ACT_${item.cp}`), loaderId, actId, actBundleId, item.cost]));
        
      promises.push(db.query(`INSERT INTO loader_prices (id, loader_id, product_id, bundle_id, cost, effective_from) VALUES
        ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) ON CONFLICT (id) DO NOTHING`,
        [uuid(`LCOST_${loader}_FB_${item.cp}`), loaderId, fbId, fbBundleId, item.cost]));
    }
  }

  await Promise.all(promises);
  promises.length = 0;
  
  // Groups
  console.log('Syncing groups...');
  
  // Pass 1: Insert Telegram Groups
  for (const group of groups) {
    const groupId = uuid(`group_${group}`);
    promises.push(db.query(`INSERT INTO telegram_groups (id, title, is_active, is_broadcast_enabled, created_at, updated_at) 
       VALUES ($1, $2, TRUE, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title`,
      [groupId, group]));
  }
  await Promise.all(promises);
  promises.length = 0;

  // Pass 2: Insert Relationships
  for (const group of groups) {
    const groupId = uuid(`group_${group}`);
    
    promises.push(db.query(`INSERT INTO group_loader_routes (id, group_id, assigned_loader_id, fulfillment_rule) VALUES
      ($1, $2, $3, 'FULFILL_REGARDLESS_OF_PAYMENT')
      ON CONFLICT (group_id) DO UPDATE SET assigned_loader_id = EXCLUDED.assigned_loader_id, fulfillment_rule = EXCLUDED.fulfillment_rule`,
      [uuid(`route_${groupId}`), groupId, malharId]));
      
    promises.push(db.query(`INSERT INTO group_price_profile_assignments (id, group_id, price_profile_id) VALUES
      ($1, $2, $3)
      ON CONFLICT (group_id) DO UPDATE SET price_profile_id = EXCLUDED.price_profile_id`,
      [uuid(`gpp_${groupId}`), groupId, ppId]));
      
    promises.push(db.query(`INSERT INTO group_payment_profile_assignments (id, group_id, payment_profile_id) VALUES
      ($1, $2, $3)
      ON CONFLICT (group_id) DO UPDATE SET payment_profile_id = EXCLUDED.payment_profile_id`,
      [uuid(`gpa_${groupId}`), groupId, payId]));
  }
  
  await Promise.all(promises);

  console.log('Phase C Staging Recovery Sync complete.');
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
