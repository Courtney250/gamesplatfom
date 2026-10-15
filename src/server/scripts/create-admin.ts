import { createHash } from "node:crypto";
import { getPool, closePool, withTransaction } from "../db/pool.js";
import { hashPassword } from "../auth/crypto.js";
import { createWalletForUser } from "../ledger/wallet.js";

async function main(): Promise<void> {
  if (process.env.CONFIRM_BOOTSTRAP_ADMIN !== "yes") throw new Error("Set CONFIRM_BOOTSTRAP_ADMIN=yes for this one-time administrative bootstrap.");
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !username || !password || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Provide valid bootstrap admin email, username and password in the execution environment.");
  const passwordHash = await hashPassword(password);
  const userId = createHash("sha256").update(`${email}:${Date.now()}`).digest("hex").slice(0,32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
  await withTransaction(async (client) => {
    const exists = await client.query("SELECT 1 FROM users WHERE role='super_admin' LIMIT 1");
    if (exists.rowCount) throw new Error("A super administrator already exists. Use the audited admin-management flow instead.");
    await client.query("INSERT INTO users(id,email,username,password_hash,role,email_verified_at) VALUES($1,$2,$3,$4,'super_admin',now())", [userId, email, username, passwordHash]);
    await createWalletForUser(client, userId);
    await client.query("INSERT INTO admin_audit_log(actor_user_id,action,target_type,target_id,reason,after_json) VALUES($1,'bootstrap_super_admin','user',$1,'One-time operator bootstrap',jsonb_build_object('role','super_admin'))", [userId]);
  });
  console.info("Super administrator created. Remove bootstrap variables and rotate the password after first login.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Admin bootstrap failed.");
  process.exitCode = 1;
}).finally(() => closePool());
