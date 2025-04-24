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
  // 1. Redirect to sign-in page
  // redirect('/sign-in');

  // 2. Or show your landing page content (which you currently have in hero.tsx)
  // For now, we'll just import and render your existing Hero component
  const Hero = dynamic(() => import('@/components/hero'));

  return (
    <div className="flex-1 w-full flex flex-col gap-20 items-center">
      <Hero />
      {/* Add any other landing page components here */}
    </div>
  );
}

// Dynamically import the Hero component to avoid issues with SSR
import dynamic from 'next/dynamic';
