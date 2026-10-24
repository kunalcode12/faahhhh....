import { LoadingRegion, Skeleton } from "../ui/skeleton";

export function AccuracyHeadlineSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,2fr)]">
      <Skeleton className="h-[252px] rounded-3xl" />
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[118px] rounded-3xl" />
        ))}
      </div>
    </div>
  );
}

export function AccuracySkeleton() {
  return (
    <LoadingRegion label="Loading forecast accuracy">
      <div className="space-y-8">
        <div className="space-y-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-14 w-full max-w-3xl" />
          <Skeleton className="h-5 w-full max-w-xl" />
          <div className="flex flex-wrap gap-3 pt-2">
            <Skeleton className="h-12 w-[36rem] max-w-full rounded-2xl" />
            <Skeleton className="h-12 w-80 max-w-full rounded-2xl" />
          </div>
        </div>
        <AccuracyHeadlineSkeleton />
        <Skeleton className="h-[460px] rounded-3xl" />
      </div>
    </LoadingRegion>
  );
}
