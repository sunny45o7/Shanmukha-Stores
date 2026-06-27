const pool = require("./config/db");

async function run() {
  try {
    const res = await pool.query("UPDATE users SET role = 'admin' WHERE email = 'chnishith051@gmail.com'");
    console.log(`Updated ${res.rowCount} users to admin.`);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

run();
