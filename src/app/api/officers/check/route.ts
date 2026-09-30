import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDB } from '@/lib/db';

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ isOfficer: false }, { status: 401 });
    }

    const DB = await getDB();

    // Check if the user is an officer
    const result = await DB.prepare(
      'SELECT id, name, position FROM officers WHERE email = ?'
    ).bind(session.user.email).first();

    return NextResponse.json({
      isOfficer: !!result,
      officer: result ? {
        id: result.id,
        name: result.name,
        position: result.position
      } : null
    });

  } catch (error) {
    console.error('Error checking officer status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}