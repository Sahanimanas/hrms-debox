import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Calendar, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import api from '@/lib/api';
import { format } from 'date-fns';

const ApprovalsPage = () => {
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionDialog, setActionDialog] = useState({ open: false, leave: null, action: null });
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchPendingLeaves();
  }, []);

  const fetchPendingLeaves = async () => {
    try {
      const response = await api.get('/leaves/pending');
      setLeaves(response.data);
    } catch (error) {
      console.error('Failed to fetch pending leaves:', error);
      toast.error('Failed to load pending leaves');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async () => {
    if (!actionDialog.leave || !actionDialog.action) return;

    setSubmitting(true);
    try {
      await api.put(`/leaves/${actionDialog.leave.id}/action`, {
        action: actionDialog.action,
        comments: comments || undefined,
      });

      toast.success(
        `Leave ${actionDialog.action === 'approve' ? 'approved' : 'rejected'} successfully!`
      );

      setActionDialog({ open: false, leave: null, action: null });
      setComments('');
      fetchPendingLeaves();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to process leave');
    } finally {
      setSubmitting(false);
    }
  };

  const openActionDialog = (leave, action) => {
    setActionDialog({ open: true, leave, action });
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      pending: 'pending',
      manager_approved: 'pending',
      approved: 'approved',
      rejected: 'rejected',
    };
    return statusMap[status] || 'pending';
  };

  const getStatusText = (status) => {
    const textMap = {
      pending: 'Pending',
      manager_approved: 'Manager Approved',
      approved: 'Approved',
      rejected: 'Rejected',
    };
    return textMap[status] || status;
  };

  // Helper to format dates array for display
  const formatLeaveDates = (dates) => {
    if (!dates || dates.length === 0) return 'No dates';

    const sortedDates = dates
      .map(d => new Date(d))
      .sort((a, b) => a - b);

    if (sortedDates.length === 1) {
      return format(sortedDates[0], 'MMM dd, yyyy');
    }

    if (sortedDates.length === 2) {
      return `${format(sortedDates[0], 'MMM dd')} & ${format(sortedDates[1], 'MMM dd, yyyy')}`;
    }

    // For 3+ dates, show first and last
    return `${format(sortedDates[0], 'MMM dd')} - ${format(sortedDates[sortedDates.length - 1], 'MMM dd, yyyy')}`;
  };

  // Check if dates are consecutive
  const areDatesConsecutive = (dates) => {
    if (!dates || dates.length <= 1) return true;

    const sortedDates = dates
      .map(d => new Date(d))
      .sort((a, b) => a - b);

    for (let i = 1; i < sortedDates.length; i++) {
      const diff = (sortedDates[i] - sortedDates[i - 1]) / (1000 * 60 * 60 * 24);
      if (diff !== 1) return false;
    }
    return true;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
          Pending Approvals
        </h1>
        <p className="text-lg text-slate-600">Review and approve leave requests</p>
      </div>

      {/* Approvals List */}
      <Card className="border-slate-100 shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            Leave Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {leaves.length > 0 ? (
            <div className="space-y-4">
              {leaves.map((leave) => (
                <div
                  key={leave.id}
                  data-testid={`approval-item-${leave.id}`}
                  className="p-6 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center">
                          <User className="w-5 h-5 text-slate-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-900">{leave.employee_name}</h3>
                          <p className="text-sm text-slate-500">{leave.employee_email}</p>
                        </div>
                      </div>
                    </div>
                    <Badge className={getStatusBadge(leave.status)}>{getStatusText(leave.status)}</Badge>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="bg-white p-4 rounded-lg border border-slate-200">
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
                        Leave Type
                      </p>
                      <p className="font-semibold text-slate-900">{leave.leave_type}</p>
                    </div>
                    <div className="bg-white p-4 rounded-lg border border-slate-200">
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
                        Duration
                      </p>
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-slate-400" />
                        <p className="text-sm text-slate-900">
                          {formatLeaveDates(leave.dates)}
                        </p>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {leave.days_count} day{leave.days_count !== 1 ? 's' : ''}
                        {leave.is_half_day && (
                          <span> • Half Day ({leave.half_day_period})</span>
                        )}
                      </p>
                      {/* Show individual dates if non-consecutive */}
                      {leave.dates && leave.dates.length > 1 && !areDatesConsecutive(leave.dates) && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {leave.dates
                            .map(d => new Date(d))
                            .sort((a, b) => a - b)
                            .map((date, idx) => (
                              <Badge
                                key={idx}
                                variant="outline"
                                className="text-xs bg-slate-100 text-slate-600 border-slate-200"
                              >
                                {format(date, 'MMM dd')}
                              </Badge>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-lg border border-slate-200 mb-4">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Reason</p>
                    <p className="text-sm text-slate-700">{leave.reason}</p>
                  </div>

                  {leave.approvals && leave.approvals.length > 0 && (
                    <div className="bg-white p-4 rounded-lg border border-slate-200 mb-4">
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                        Approval History
                      </p>
                      <div className="space-y-2">
                        {leave.approvals.map((approval, idx) => (
                          <div key={idx} className="text-sm">
                            <span className="font-medium text-slate-700">{approval.approver_name}</span>
                            <span className="text-slate-500"> ({approval.approver_role}) </span>
                            <span className={approval.action === 'approve' ? 'text-emerald-600' : 'text-red-600'}>
                              {approval.action === 'approve' ? 'approved' : 'rejected'}
                            </span>
                            {approval.comments && (
                              <p className="text-slate-600 mt-1">Comment: {approval.comments}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <Button
                      onClick={() => openActionDialog(leave, 'approve')}
                      data-testid={`approve-btn-${leave.id}`}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full"
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Approve
                    </Button>
                    <Button
                      onClick={() => openActionDialog(leave, 'reject')}
                      data-testid={`reject-btn-${leave.id}`}
                      variant="outline"
                      className="flex-1 text-red-600 border-red-200 hover:bg-red-50 rounded-full"
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500">
              <CheckCircle className="w-16 h-16 mx-auto mb-4 text-slate-300" />
              <p className="text-lg mb-2">No pending approvals</p>
              <p className="text-sm">All leave requests have been processed</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action Dialog */}
      <Dialog open={actionDialog.open} onOpenChange={(open) => {
        if (!open) {
          setActionDialog({ open: false, leave: null, action: null });
          setComments('');
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {actionDialog.action === 'approve' ? 'Approve' : 'Reject'} Leave Request
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            {actionDialog.leave && (
              <div className="p-4 bg-slate-50 rounded-lg space-y-3">
                <div>
                  <p className="font-medium text-slate-900">{actionDialog.leave.employee_name}</p>
                  <p className="text-sm text-slate-600">
                    {actionDialog.leave.leave_type} - {actionDialog.leave.days_count} day{actionDialog.leave.days_count !== 1 ? 's' : ''}
                    {actionDialog.leave.is_half_day && (
                      <span> • Half Day ({actionDialog.leave.half_day_period})</span>
                    )}
                  </p>
                </div>

                {/* Individual Dates Display */}
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                    Leave Dates
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {actionDialog.leave.dates &&
                      actionDialog.leave.dates
                        .map(d => new Date(d))
                        .sort((a, b) => a - b)
                        .map((date, idx) => (
                          <Badge
                            key={idx}
                            variant="outline"
                            className="text-xs bg-white text-slate-700 border-slate-300 py-1 px-2"
                          >
                            {format(date, 'EEE, MMM dd, yyyy')}
                          </Badge>
                        ))
                    }
                  </div>
                </div>
              </div>
            )}
            <div>
              <Label htmlFor="comments">Comments (Optional)</Label>
              <Textarea
                id="comments"
                data-testid="action-comments-textarea"
                placeholder="Add any comments..."
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={4}
                className="mt-1"
              />
            </div>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setActionDialog({ open: false, leave: null, action: null });
                  setComments('');
                }}
                className="flex-1"
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAction}
                data-testid="confirm-action-btn"
                className={`flex-1 ${actionDialog.action === 'approve'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-red-600 hover:bg-red-700'
                  }`}
                disabled={submitting}
              >
                {submitting ? 'Processing...' : 'Confirm'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ApprovalsPage;
