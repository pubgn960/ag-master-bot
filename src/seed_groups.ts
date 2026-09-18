import { getDb } from './core/db/index.js';
import { v4 as uuidv4 } from 'uuid';

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

async function run() {
  const db = await getDb();
  let count = 0;
  for (const group of groups) {
    const id = 'unbound-' + uuidv4().replace(/-/g, '').substring(0, 16);
    await db.query(
      `INSERT INTO telegram_groups (id, title, is_active, is_broadcast_enabled, created_at, updated_at) 
       VALUES ($1, $2, TRUE, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, group]
    );
    count++;
  }
  console.log(`Inserted ${count} groups successfully.`);
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
