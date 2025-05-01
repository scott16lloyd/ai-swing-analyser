'use client';

import type React from 'react';

import { useState, useEffect } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ClipboardCheck, Trophy, ChevronUp, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function CoachingPage() {
  // Added YouTube video URLs for each drill
  const dummyDrillSuggestions = [
    {
      text: 'Work on keeping your shoulders more level at setup.',
      videoUrl: 'https://www.youtube.com/embed/OCuK7nWvHt0?si=7y0uSfVHufQA5NF4', // Placeholder URLs
    },
    {
      text: 'Initiate downswing with your lower body, feeling like your hips lead the movement.',
      videoUrl: 'https://www.youtube.com/embed/OCuK7nWvHt0?si=7y0uSfVHufQA5NF4',
    },
    {
      text: 'Practice the sequence: hips first, then torso, then arms and club.',
      videoUrl: 'https://www.youtube.com/embed/OCuK7nWvHt0?si=7y0uSfVHufQA5NF4',
    },
    {
      text: 'Focus on maintaining better extension of your lead arm throughout the swing.',
      videoUrl: 'https://www.youtube.com/embed/OCuK7nWvHt0?si=7y0uSfVHufQA5NF4',
    },
    {
      text: 'Focus on creating a full shoulder turn while maintaining spine angle.',
      videoUrl: 'https://www.youtube.com/embed/OCuK7nWvHt0?si=7y0uSfVHufQA5NF4',
    },
  ];

  // State to track completed drills
  const [completedDrills, setCompletedDrills] = useState<
    Record<number, boolean>
  >({});
  const [progress, setProgress] = useState(0);
  // New state to track which drill's video is expanded
  const [expandedDrill, setExpandedDrill] = useState<number | null>(null);

  // Calculate progress whenever completedDrills changes
  useEffect(() => {
    const completedCount =
      Object.values(completedDrills).filter(Boolean).length;
    const totalCount = dummyDrillSuggestions.length;
    setProgress((completedCount / totalCount) * 100);
  }, [completedDrills]);

  // Toggle completion status
  const toggleDrillCompletion = (index: number) => {
    setCompletedDrills((prev) => {
      const newState = { ...prev };
      newState[index] = !prev[index];
      return newState;
    });
  };

  // Toggle video expansion
  const toggleVideoExpansion = (index: number, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent the card click from triggering
    setExpandedDrill(expandedDrill === index ? null : index);
  };

  // Get reversed drill list and filter out completed ones
  const uncompletedDrills = dummyDrillSuggestions
    .slice()
    .reverse()
    .map((drill, reversedIndex) => {
      const originalIndex = dummyDrillSuggestions.length - 1 - reversedIndex;
      return { drill, originalIndex };
    })
    .filter(({ originalIndex }) => !completedDrills[originalIndex]);

  const completedCount = Object.values(completedDrills).filter(Boolean).length;
  const totalCount = dummyDrillSuggestions.length;

  return (
    <div className="w-full h-full min-h-screen flex flex-col">
      <div className="container max-w-3xl mx-auto py-6 px-4 sm:py-12 flex-grow overflow-y-auto no-scrollbar">
        <div className="bg-card dark:bg-card/50 rounded-xl p-6 sm:p-8 mb-6 sm:mb-8 shadow-sm border border-border">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-primary/10 p-2 rounded-full">
              <ClipboardCheck className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
              Coaching Drills
            </h1>
          </div>

          <p className="text-muted-foreground mb-6">
            Complete these drills to improve your swing technique. Click on a
            drill to mark it as completed. Tap the video icon to watch a
            demonstration.
          </p>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium text-foreground">Your progress</span>
              <span className="text-muted-foreground">
                {completedCount} of {totalCount} completed
              </span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        </div>

        <div className="space-y-4 pb-20">
          <AnimatePresence>
            {uncompletedDrills.length > 0 ? (
              uncompletedDrills.map(({ drill, originalIndex }) => (
                <motion.div
                  key={originalIndex}
                  initial={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  layout
                  transition={{ duration: 0.2 }}
                >
                  <Card className="overflow-hidden border-l-4 border-l-primary/70 shadow-sm">
                    <div className="p-4 sm:p-5 transition-all hover:bg-accent/50 flex items-center justify-between gap-4">
                      <label
                        htmlFor={`drill-${originalIndex}`}
                        className="text-base cursor-pointer flex-1 font-medium text-foreground"
                      >
                        {drill.text}
                      </label>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                          onClick={(e) =>
                            toggleVideoExpansion(originalIndex, e)
                          }
                          aria-label={
                            expandedDrill === originalIndex
                              ? 'Hide video'
                              : 'Show video'
                          }
                        >
                          {expandedDrill === originalIndex ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </button>
                        <div className="h-6 w-6 flex items-center justify-center hover:bg-primary/10">
                          <Checkbox
                            id={`drill-${originalIndex}`}
                            checked={completedDrills[originalIndex] || false}
                            onCheckedChange={() => {
                              toggleDrillCompletion(originalIndex);
                            }}
                            className="h-6 w-6 data-[state=checked]:bg-primary data-[state=checked]:border-primary rounded-md"
                          />
                        </div>
                      </div>
                    </div>
                    <AnimatePresence>
                      {expandedDrill === originalIndex && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3 }}
                          className="border-t border-border overflow-hidden"
                        >
                          <div className="p-4 bg-accent/20">
                            <div className="aspect-video w-full rounded-md overflow-hidden">
                              <iframe
                                src={drill.videoUrl}
                                title={`Drill demonstration: ${drill.text}`}
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                                className="w-full h-full"
                              ></iframe>
                            </div>
                            <p className="text-sm text-muted-foreground mt-3">
                              Watch this video demonstration to better
                              understand the drill technique.
                            </p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Card>
                </motion.div>
              ))
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-12 sm:py-16 bg-card dark:bg-card/50 rounded-xl shadow-sm border border-border"
              >
                <div className="flex justify-center mb-4">
                  <div className="bg-primary/10 p-4 rounded-full">
                    <Trophy className="h-10 w-10 sm:h-12 sm:w-12 text-primary" />
                  </div>
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2">
                  All drills completed!
                </h3>
                <p className="text-muted-foreground">
                  Great job on completing all your coaching drills.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
