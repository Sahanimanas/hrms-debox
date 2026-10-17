import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Calendar, User, Download, UserCheck, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import api from '@/lib/api';
import { format } from 'date-fns';
import { exportCsv } from '@/lib/exportCsv';
import ApprovalChain from '@/modules/leave/components/ApprovalChain';
import { fmtKey, toDateKey } from '@/modules/leave/lib';

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
    if (actionDialog.action === 'reject' && !comments.trim()) {
      toast.error('Please give a reason for rejecting this leave');
      return;
    }

    setSubmitting(true);
    try {
      await api.put(`/leaves/${actionDialog.leave.id}/action`, {
        action: actionDialog.action,
        comments: comments.trim() || undefined,
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
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      manager_approved: 'bg-amber-100 text-amber-800 border-amber-200',
      approved: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      rejected: 'bg-red-100 text-red-800 border-red-200',
    };
    return statusMap[status] || statusMap.pending;
  };

  const getStatusText = (status) => {
    const textMap = {
      pending: 'Pending',
      manager_approved: 'Partly approved',
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
    <div className="p-3 sm:p-6 md:p-10 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 mb-1 sm:mb-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            Pending Approvals
          </h1>
          <p className="text-sm sm:text-lg text-slate-600">Review and approve leave requests</p>
        </div>
        <Button
          variant="outline"
          className="gap-2 w-full sm:w-auto"
          disabled={!leaves.length}
          onClick={() => exportCsv('pending-leave-approvals', leaves, [
            { key: 'employee_name', label: 'Employee' },
            { key: 'employee_email', label: 'Email' },
            { key: 'leave_type', label: 'Leave type' },
            { label: 'Dates', value: (l) => (l.dates || []).map(toDateKey).join(' ') },
            { key: 'days_count', label: 'Days' },
            { key: 'sandwich_days', label: 'Sandwich days' },
            { key: 'status', label: 'Status' },
            { key: 'current_step_name', label: 'Waiting at' },
            { label: 'On behalf of', value: (l) => l.on_behalf_of?.name || '' },
            { key: 'reason', label: 'Reason' },
          ])}
        >
          <Download className="w-4 h-4" /> Export CSV
        </Button>
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
                  className="p-3 sm:p-6 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-4">
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
                    <div className="flex flex-col items-end gap-1">
                      <Badge className={`${getStatusBadge(leave.status)} border`}>{getStatusText(leave.status)}</Badge>
                      {leave.on_behalf_of && (
                        <Badge variant="outline" className="text-[10px] gap-1 border-sky-200 text-sky-700 bg-sky-50">
                          <UserCheck className="w-3 h-3" /> For {leave.on_behalf_of.name}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {Array.isArray(leave.approval_chain) && leave.approval_chain.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <Layers className="w-3.5 h-3.5" /> Approval levels
                      </p>
                      <ApprovalChain chain={leave.approval_chain} />
                    </div>
                  )}

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
                      {leave.sandwich_days > 0 && (
                        <p className="text-xs text-amber-700 mt-1">
                          Includes {leave.sandwich_days} sandwiched day{leave.sandwich_days > 1 ? 's' : ''}: {(leave.sandwich_dates || []).map((d) => fmtKey(d, 'EEE dd MMM')).join(', ')}
                        </p>
                      )}
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
                            <span className={approval.action === 'approve' ? 'text-emerald-600' : approval.action === 'reject' ? 'text-red-600' : 'text-slate-600'}>
                              {approval.action === 'approve' ? 'approved' : approval.action === 'reject' ? 'rejected' : approval.action}
                            </span>
                            {approval.step_name && <span className="text-slate-500"> at {approval.step_name}</span>}
                            {approval.on_behalf_of_name && <span className="text-slate-500"> on behalf of {approval.on_behalf_of_name}</span>}
                            {approval.comments && (
                              <p className="text-slate-600 mt-1">Comment: {approval.comments}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {leave.is_own ? (
                    <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-lg p-3">
                      This is your own leave: another approver must act on it.
                    </p>
                  ) : leave.can_act === false ? (
                    <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-lg p-3">
                      Waiting for {leave.current_step_name || 'another approver'}.
                    </p>
                  ) : (
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
                  )}
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
                {actionDialog.leave.on_behalf_of && (
                  <p className="text-xs text-sky-700 bg-sky-50 border border-sky-100 rounded p-2">
                    You are acting on behalf of {actionDialog.leave.on_behalf_of.name} (delegation).
                  </p>
                )}
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
              <Label htmlFor="comments">
                {actionDialog.action === 'reject' ? 'Reason for rejection *' : 'Comments (Optional)'}
              </Label>
              <Textarea
                id="comments"
                data-testid="action-comments-textarea"
                placeholder={actionDialog.action === 'reject' ? 'Tell the employee why this leave is rejected...' : 'Add any comments...'}
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
                disabled={submitting || (actionDialog.action === 'reject' && !comments.trim())}
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
