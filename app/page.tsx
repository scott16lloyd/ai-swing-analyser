import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';

export default async function RootPage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // If user is authenticated, redirect to /analyse
  if (session) {
    redirect('/analyse');
  }

  // If user is not authenticated, you can either:
  // Redirect to sign-in page
  redirect('/sign-in');

  return (
    <div className="flex-1 w-full flex flex-col gap-20 items-center">
      {/* Add any other landing page components here */}
    </div>
  );
}
