// components/BottomNavBar.jsx
'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, History, Camera, BarChart, UserCheck } from 'lucide-react';

const BottomNavBar = () => {
  const pathname = usePathname();

  // Navigation items with their corresponding icons and paths
  const navItems = [
    { name: 'History', icon: History, path: '/history' },
    { name: 'Analyse', icon: Camera, path: '/analyse' },
    { name: 'Coaching', icon: UserCheck, path: '/coaching' },
    { name: 'Progress', icon: BarChart, path: '/progress' },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-black border-t border-gray-700 shadow-lg">
      <div className="h-px bg-gray-600 w-full"></div>{' '}
      {/* Small outline at the top */}
      <div className="flex justify-around items-center h-16">
        {navItems.map((item) => {
          const isActive = pathname === item.path;
          const IconComponent = item.icon;

          return (
            <Link
              href={item.path}
              key={item.name}
              className={`flex flex-col items-center justify-center w-full h-full ${
                isActive ? 'text-blue-400' : 'text-gray-300'
              }`}
            >
              <IconComponent size={24} />
              <span className="text-xs mt-1">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default BottomNavBar;
