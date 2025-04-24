import type React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  description?: string;
  className?: string;
}

export function StatCard({
  title,
  value,
  icon,
  description,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

interface ImprovementCardProps {
  currentScore: number;
  previousScore: number;
  className?: string;
}

export function ImprovementCard({
  currentScore,
  previousScore,
  className,
}: ImprovementCardProps) {
  const percentageChange = previousScore
    ? ((currentScore - previousScore) / previousScore) * 100
    : 0;

  const isPositive = percentageChange >= 0;
  const formattedChange = `${isPositive ? '+' : ''}${percentageChange.toFixed(1)}%`;

  return (
    <StatCard
      title="Improvement"
      value={formattedChange}
      icon={
        isPositive ? (
          <ArrowUpIcon className="h-4 w-4 text-emerald-500" />
        ) : (
          <ArrowDownIcon className="h-4 w-4 text-red-500" />
        )
      }
      description={`From previous score of ${previousScore}`}
      className={className}
    />
  );
}

export function CurrentScoreCard({
  score,
  className,
}: {
  score: number;
  className?: string;
}) {
  return (
    <StatCard
      title="Current Score"
      value={score}
      description="Latest swing analysis result"
      className={className}
    />
  );
}
