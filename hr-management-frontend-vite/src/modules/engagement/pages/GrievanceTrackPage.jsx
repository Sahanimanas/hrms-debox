// Public page (no login): check a grievance's status with its tracking code.
import { Link, useSearchParams } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import GrievanceTracker from '../components/GrievanceTracker';

export default function GrievanceTrackPage() {
  const [params] = useSearchParams();
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-start sm:items-center justify-center p-4">
      <Card className="w-full max-w-lg border-0 shadow-lg">
        <CardContent className="p-5 sm:p-8 space-y-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-slate-800 rounded-xl shadow-lg"><ShieldAlert className="w-5 h-5 text-white" /></div>
            <div>
              <h1 className="text-xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>Grievance status</h1>
              <p className="text-xs text-slate-600">Enter the tracking code you received when you filed it.</p>
            </div>
          </div>
          <GrievanceTracker initialCode={params.get('code') || ''} />
          <p className="text-xs text-slate-500 text-center"><Link to="/login" className="text-sky-700 hover:underline">Sign in to Xeno-HR</Link></p>
        </CardContent>
      </Card>
    </div>
  );
}
