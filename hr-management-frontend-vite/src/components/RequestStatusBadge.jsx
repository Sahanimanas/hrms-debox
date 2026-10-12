import React from 'react';
import { Clock, CheckCircle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const RequestStatusBadge = ({ status }) => {
  const map = {
    pending: { cls: 'bg-amber-100 text-amber-700', icon: Clock, label: 'Pending' },
    approved: { cls: 'bg-emerald-100 text-emerald-700', icon: CheckCircle, label: 'Approved' },
    rejected: { cls: 'bg-red-100 text-red-700', icon: XCircle, label: 'Rejected' },
  };
  const { cls, icon, label } = map[status] || map.pending;
  const Icon = icon;
  return (
    <Badge className={`${cls} hover:opacity-90 gap-1 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5`}>
      <Icon className="w-3 h-3" />
      {label}
    </Badge>
  );
};

export default RequestStatusBadge;
