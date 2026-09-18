import { getDb } from './core/db/index.js';

async function resetStaff() {
  console.log('[RESET] Starting staff data reset...');
  const db = await getDb();

  try {
    await db.transaction(async (tx) => {
      // 0. Safeguard: disassociate any user_permissions granted_by pointers to other users
      console.log('[RESET] Updating user_permissions granted_by...');
      await tx.query(`
        UPDATE user_permissions 
        SET granted_by = NULL 
        WHERE granted_by IS NOT NULL AND granted_by != '00000000-0000-0000-0000-000000000001'
      `);

      // 1. Wipe duplicate / leftover staff records except canonical root owner
      console.log('[RESET] Deleting non-owner user_permissions...');
      const delPerms = await tx.query(`
        DELETE FROM user_permissions 
        WHERE user_id != '00000000-0000-0000-0000-000000000001'
      `);
      console.log(`[RESET] Deleted ${delPerms.rowCount} permission records.`);

      console.log('[RESET] Deleting non-owner users...');
      const delUsers = await tx.query(`
        DELETE FROM users 
        WHERE id != '00000000-0000-0000-0000-000000000001'
      `);
      console.log(`[RESET] Deleted ${delUsers.rowCount} staff user records.`);

      // 2. Cleanly reset root owner credentials
      console.log('[RESET] Resetting root owner credentials...');
      const updOwner = await tx.query(`
        UPDATE users 
        SET role = 'OWNER', 
            telegram_user_id = NULL,
            is_active = TRUE 
        WHERE id = '00000000-0000-0000-0000-000000000001'
      `);
      console.log(`[RESET] Updated root owner (${updOwner.rowCount} rows).`);

      // 3. Set Start From Scratch flag so the server boots in pristine state
      console.log('[RESET] Setting START_FROM_SCRATCH_COMPLETED setting...');
      await tx.query(`
        INSERT INTO system_settings (key, value, updated_at, updated_by)
        VALUES ('START_FROM_SCRATCH_COMPLETED', '"true"', CURRENT_TIMESTAMP, 'Owner')
        ON CONFLICT (key) DO UPDATE SET value = '"true"', updated_at = CURRENT_TIMESTAMP
      `);
      console.log('[RESET] Set START_FROM_SCRATCH_COMPLETED to "true".');
    });

    console.log('\n--- VERIFICATION ---');
    const remainingUsers = await db.query('SELECT id, username, role, telegram_user_id, is_active FROM users');
    console.log('Users in DB:');
    console.table(remainingUsers.rows);

    const remainingPerms = await db.query('SELECT count(*) as c FROM user_permissions');
    console.log('User permissions count:', remainingPerms.rows[0].c);

    const setting = await db.query("SELECT key, value, updated_by, updated_at FROM system_settings WHERE key = 'START_FROM_SCRATCH_COMPLETED'");
    console.log('System setting:');
    console.table(setting.rows);

    console.log('\n[RESET] SUCCESS: Staff data reset completed successfully.');
  } catch (err) {
    console.error('[RESET] ERROR during reset:', err);
    throw err;
  } finally {
    await db.close();
  }
}

resetStaff()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
