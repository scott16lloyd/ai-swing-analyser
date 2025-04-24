'use client';

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { format } from 'date-fns';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { TrendingUp } from 'lucide-react';

interface SwingAnalysis {
  prediction: string;
  confidence: number;
  score: number;
  feedback: string[];
  date: string;
}

interface PlayerProgressChartProps {
  data: SwingAnalysis[];
  title?: string;
  description?: string;
}

export function PlayerProgressChart({
  data,
  title = 'Swing Progress',
  description = 'Track your swing improvement over time',
}: PlayerProgressChartProps) {
  const chartData = useMemo(() => {
    return data
      .map((item) => {
        // Parse the date - handle both standard ISO strings and the unusual format in the example
        let date;
        try {
          // Try to parse as ISO string first
          date = new Date(item.date);
          // Check if date is valid
          if (isNaN(date.getTime())) {
            throw new Error('Invalid date');
          }
        } catch (e) {
          // Fallback to current date if parsing fails
          console.warn('Could not parse date:', item.date);
          date = new Date();
        }

        return {
          date,
          score: item.score,
          formattedDate: format(date, 'MMM d, yyyy'),
        };
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [data]);

  const maxScore = Math.max(...chartData.map((item) => item.score), 100);
  const minScore = Math.min(...chartData.map((item) => item.score), 0);

  return (
    <Card className="w-full flex-1 flex flex-col overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          {title} <TrendingUp className="h-5 w-5 text-emerald-500" />
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col p-0 pb-2">
        <div className="flex-1 w-full min-h-0">
          <ChartContainer
            config={{
              progress: {
                label: 'Score',
                color: 'hsl(var(--chart-1))',
              },
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 30, left: -10, bottom: 10 }}
                accessibilityLayer
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="formattedDate"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={30}
                  tickFormatter={(value) => value.split(',')[0]}
                />
                <YAxis
                  domain={[
                    Math.max(0, minScore - 10),
                    Math.min(100, maxScore + 10),
                  ]}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(label) => `Date: ${label}`}
                      formatter={(value) => [`Score: ${value}`, ' Score']}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="score"
                  stroke="var(--color-progress)"
                  fill="var(--color-progress)"
                  fillOpacity={0.2}
                  activeDot={{ r: 6 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}
