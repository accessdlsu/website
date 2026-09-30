import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getDB } from '@/lib/db';
import LinkShortenerClient from './LinkShortenerClient';

export default async function LinkShortenerPage() {
  const session = await auth();

  if (!session?.user?.email) {
    redirect('/');
  }

  const DB = await getDB();

  // Check if the user is an officer
  const result = await DB.prepare(
    'SELECT id, name, position FROM officers WHERE email = ?'
  ).bind(session.user.email).first();

  if (!result) {
    redirect('/');
  }

  return (
    <main className="pt-32 pb-20 px-6 max-w-7xl mx-auto">
      <section className="course-card relative overflow-hidden p-10 md:p-14 mb-8">
        <div className="absolute inset-0 bg-gradient-to-br from-green-500/10 via-transparent to-emerald-500/10 pointer-events-none" />
        <div className="relative text-center space-y-6">
          <div className="inline-flex items-center rounded-full border border-green-500/20 bg-green-500/10 px-4 py-1 text-sm font-semibold text-green-700 dark:text-green-300" style={{ fontFamily: 'var(--font-manrope)' }}>
            Officer Tools
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-zinc-950 dark:text-white" style={{ fontFamily: 'var(--font-poppins)' }}>
            Link Shortener
          </h1>
          <p className="text-xl text-zinc-700 dark:text-gray-300 max-w-3xl mx-auto" style={{ fontFamily: 'var(--font-manrope)' }}>
            Create and manage shortened links for ACCESS resources and events.
          </p>
        </div>
      </section>

        <LinkShortenerClient />
    </main>
  );
}