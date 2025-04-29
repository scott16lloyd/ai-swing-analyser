'use client';

import { useCallback } from 'react';
import { Hand } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Define the DominantHand type
export type DominantHand = 'left' | 'right';

interface DominantHandSelectorProps {
  value: DominantHand;
  onChange: (hand: DominantHand) => void;
  className?: string;
}

export function DominantHandSelector({
  value,
  onChange,
  className,
}: DominantHandSelectorProps) {
  const handleValueChange = useCallback(
    (newValue: string) => {
      onChange(newValue as DominantHand);
    },
    [onChange]
  );

  return (
    <div className={className}>
      <div className="flex flex-col space-y-2">
        <Tabs
          value={value}
          onValueChange={handleValueChange}
          aria-labelledby="dominant-hand-label"
          className="w-full"
        >
          <TabsList className="grid grid-cols-2 w-full rounded-xl bg-white">
            <TabsTrigger
              value="left"
              className="flex items-center justify-center gap-2 rounded-lg"
            >
              {/* Left hand - mirrored version of the Hand icon */}
              <span className="transform scale-x-[-1]">
                <Hand size={16} />
              </span>
              Left
            </TabsTrigger>
            <TabsTrigger
              value="right"
              className="flex items-center justify-center gap-2 rounded-lg"
            >
              {/* Right hand - default Hand icon */}
              <Hand size={16} />
              Right
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
