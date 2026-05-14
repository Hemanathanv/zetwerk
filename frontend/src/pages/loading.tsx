import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center gap-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-lg bg-primary flex items-center justify-center glow-primary">
                <Loader2 className="w-8 h-8 text-primary-foreground animate-spin" />
              </div>
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-400 rounded-full border-2 border-white animate-pulse" />
            </div>
            
            <div className="text-center">
              <h1 className="text-2xl font-bold text-gray-900">Loading</h1>
              <p className="mt-2 text-sm text-gray-600">
                Please wait while we load your content...
              </p>
            </div>
            
            <div className="w-full max-w-[200px] h-1 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-primary animate-pulse w-full" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}