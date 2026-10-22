/**
 * Promote a user to admin: `npm run setadmin -- <email-or-username>`.
 *
 * The only way to create the first admin. Roles are never settable through the
 * public API, so this script is the bootstrap path - run it once against the
 * account you want to own the dashboard, then manage roles from the UI.
 *
 * Accepts either the account's email or its display name (case-insensitive).
 */
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection.js';
import { UserModel } from '../src/db/models/index.js';

const target = (process.argv[2] ?? '').trim();

if (target.length === 0) {
  console.error('Usage: npm run setadmin -- <email-or-username>');
  console.error('Example: npm run setadmin -- admin@example.com');
  process.exit(1);
}

async function run(): Promise<void> {
  await connectToDatabase();

  try {
    const isEmail = target.includes('@');
    const filter = isEmail
      ? { email: target.toLowerCase() }
      : { displayName: { $regex: `^${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } };

    const user = await UserModel.findOne(filter);
    if (!user) {
      console.error(`No account found for "${target}".`);
      console.error(isEmail ? 'Check the email address.' : 'Check the display name.');
      process.exit(1);
    }

    if (user.role === 'admin') {
      console.log(`${user.displayName} (${user.email}) is already an admin.`);
      return;
    }

    user.role = 'admin';
    await user.save();

    console.log(`Promoted ${user.displayName} (${user.email}) to admin.`);
    console.log('They can now sign in and visit /admin to access the dashboard.');
  } finally {
    await disconnectFromDatabase();
  }
}

run().catch((error: unknown) => {
  console.error('Failed:', error);
  process.exit(1);
});
