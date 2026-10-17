import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Receipt, Calendar, FileText, Image, Clock, CheckCircle, XCircle, Trash2, AlertTriangle, Pencil, Download, Plane, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { format } from 'date-fns';
import { exportCsv } from '@/lib/exportCsv';
import ClaimDialog from '@/modules/assets/components/ClaimDialog';
import PolicyCheckPanel from '@/modules/assets/components/PolicyCheckPanel';
import { EXPENSE_CATEGORIES } from '@/modules/assets/lib';

const safeDate = (value, pattern) => {
  const d = new Date(value);
  return isNaN(d) ? '—' : format(d, pattern);
};

const MyReimbursementsPage = () => {
  const [reimbursements, setReimbursements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState(EXPENSE_CATEGORIES);
  const [trips, setTrips] = useState([]);

  // Apply / edit dialog: null = closed, {} = new claim, claim = editing
  const [claimDialog, setClaimDialog] = useState(null);

  // Delete modal states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const fetchReimbursements = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get('/reimbursements/my');
      setReimbursements(response.data || []);
    } catch (error) {
      toast.error('Failed to load reimbursements');
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOptions = useCallback(async () => {
    const [cats, linkable] = await Promise.allSettled([
      api.get('/v2/assets/expense-categories'),
      api.get('/v2/assets/travel/linkable'),
    ]);
    if (cats.status === 'fulfilled' && Array.isArray(cats.value.data) && cats.value.data.length) setCategories(cats.value.data);
    if (linkable.status === 'fulfilled') setTrips(linkable.value.data || []);
  }, []);

  useEffect(() => {
    fetchReimbursements();
  }, [fetchReimbursements]);

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  const openApply = () => {
    fetchOptions();
    setClaimDialog({});
  };

  const handleEditClick = (reimbursement) => {
    fetchOptions();
    setClaimDialog(reimbursement);
  };

  // Delete handlers
  const handleDeleteClick = (reimbursement) => {
    setDeleteTarget(reimbursement);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;

    setDeleting(true);
    try {
      await api.delete(`/reimbursements/${deleteTarget.id}`);
      toast.success('Reimbursement deleted successfully');
      setShowDeleteModal(false);
      setDeleteTarget(null);
      fetchReimbursements();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete reimbursement');
    } finally {
      setDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteModal(false);
    setDeleteTarget(null);
  };

  const handleExport = () => {
    exportCsv('my-reimbursements', reimbursements, [
      { key: 'title', label: 'Title' },
      { key: 'category', label: 'Category' },
      { key: 'amount', label: 'Amount (INR)' },
      { label: 'Expense date', value: (r) => String(r.expense_date || '').slice(0, 10) },
      { key: 'status', label: 'Status' },
      { key: 'trip_label', label: 'Trip' },
      { label: 'Policy', value: (r) => r.policy_check?.status || '' },
      { label: 'Policy notes', value: (r) => (r.policy_check?.violations || []).map(v => v.message).join('; ') },
      { label: 'Receipt', value: (r) => (r.bill_url ? 'yes' : 'no') },
      { key: 'description', label: 'Description' },
      { key: 'admin_remarks', label: 'Admin remarks' },
      { label: 'Submitted', value: (r) => String(r.created_at || '').slice(0, 10) },
    ]);
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'pending':
        return (
          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 gap-1 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">
            <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
            Pending
          </Badge>
        );
      case 'approved':
        return (
          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 gap-1 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">
            <CheckCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
            Approved
          </Badge>
        );
      case 'cleared':
        return (
          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 gap-1 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">
            <CheckCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
            Cleared
          </Badge>
        );
      case 'rejected':
        return (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100 gap-1 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">
            <XCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
            Rejected
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-[10px] sm:text-xs">{status}</Badge>
        );
    }
  };

  const getTotalPending = () => {
    return reimbursements
      .filter(r => r.status === 'pending' || r.status === 'approved')
      .reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  };

  const getTotalCleared = () => {
    return reimbursements
      .filter(r => r.status === 'cleared')
      .reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  };

  return (
    <div className="min-h-screen bg-canvas p-3 sm:p-4 md:p-8">
      <div className="w-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-5 sm:mb-8">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="p-2 sm:p-3 bg-slate-800 rounded-lg sm:rounded-xl shadow-lg">
              <Receipt className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
                My Reimbursements
              </h1>
              <p className="text-xs sm:text-sm text-slate-600">Track and manage your expense reimbursements</p>
            </div>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={!reimbursements.length}
              className="rounded-lg sm:rounded-xl gap-1.5 text-xs sm:text-sm h-9 sm:h-10 flex-1 sm:flex-none"
            >
              <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              Export CSV
            </Button>
            <Button
              onClick={openApply}
              className="rounded-lg sm:rounded-xl shadow-md gap-1.5 sm:gap-2 text-xs sm:text-sm h-9 sm:h-10 flex-1 sm:flex-none"
            >
              <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              Apply Reimbursement
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-5 sm:mb-8">
          <Card className="border-0 shadow-md bg-gradient-to-br from-amber-50 to-orange-50">
            <CardContent className="p-2.5 sm:p-4 md:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="order-2 sm:order-1">
                  <p className="text-[10px] sm:text-xs md:text-sm text-amber-600 font-medium">Pending</p>
                  <p className="text-sm sm:text-xl md:text-2xl font-bold text-amber-700">₹{getTotalPending().toLocaleString()}</p>
                </div>
                <div className="p-1.5 sm:p-2 md:p-3 bg-amber-200 rounded-lg sm:rounded-xl order-1 sm:order-2 w-fit">
                  <Clock className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-amber-700" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md bg-gradient-to-br from-emerald-50 to-green-50">
            <CardContent className="p-2.5 sm:p-4 md:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="order-2 sm:order-1">
                  <p className="text-[10px] sm:text-xs md:text-sm text-emerald-600 font-medium">Cleared</p>
                  <p className="text-sm sm:text-xl md:text-2xl font-bold text-emerald-700">₹{getTotalCleared().toLocaleString()}</p>
                </div>
                <div className="p-1.5 sm:p-2 md:p-3 bg-emerald-200 rounded-lg sm:rounded-xl order-1 sm:order-2 w-fit">
                  <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-emerald-700" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md bg-gradient-to-br from-amber-50 to-amber-50">
            <CardContent className="p-2.5 sm:p-4 md:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="order-2 sm:order-1">
                  <p className="text-[10px] sm:text-xs md:text-sm text-amber-600 font-medium">Requests</p>
                  <p className="text-sm sm:text-xl md:text-2xl font-bold text-amber-700">{reimbursements.length}</p>
                </div>
                <div className="p-1.5 sm:p-2 md:p-3 bg-amber-200 rounded-lg sm:rounded-xl order-1 sm:order-2 w-fit">
                  <FileText className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-amber-700" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Reimbursement List */}
        <div className="space-y-3 sm:space-y-4">
          {loading ? (
            <div className="text-center py-10 sm:py-16">
              <div className="animate-spin w-8 h-8 sm:w-10 sm:h-10 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-3 sm:mb-4"></div>
              <p className="text-xs sm:text-sm text-slate-500">Loading reimbursements...</p>
            </div>
          ) : reimbursements.length === 0 ? (
            <Card className="border-0 shadow-md">
              <CardContent className="p-8 sm:p-16 text-center">
                <div className="w-14 h-14 sm:w-20 sm:h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-4">
                  <Receipt className="w-7 h-7 sm:w-10 sm:h-10 text-slate-300" />
                </div>
                <h3 className="text-sm sm:text-lg font-semibold text-slate-700 mb-1.5 sm:mb-2">No Reimbursements Yet</h3>
                <p className="text-xs sm:text-sm text-slate-500 mb-4 sm:mb-6">You haven't submitted any reimbursement requests</p>
                <Button
                  onClick={openApply}
                  className="text-xs sm:text-sm h-9 sm:h-10"
                >
                  <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                  Apply for Reimbursement
                </Button>
              </CardContent>
            </Card>
          ) : (
            reimbursements.map((reimbursement) => (
              <Card key={reimbursement.id} className="border-0 shadow-md hover:shadow-lg transition-shadow">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                    <div className="flex gap-2.5 sm:gap-4 flex-1 min-w-0">
                      <div className="p-2 sm:p-3 bg-slate-100 rounded-lg sm:rounded-xl shrink-0">
                        <Receipt className="w-4 h-4 sm:w-6 sm:h-6 text-slate-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-slate-800 text-sm sm:text-lg truncate">{reimbursement.title}</h3>
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-3 mt-1">
                          <Badge variant="outline" className="text-[10px] sm:text-xs px-1.5 sm:px-2">
                            {reimbursement.category}
                          </Badge>
                          <span className="text-[10px] sm:text-sm text-slate-500 flex items-center gap-0.5 sm:gap-1">
                            <Calendar className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5" />
                            {safeDate(reimbursement.expense_date, 'MMM dd, yyyy')}
                          </span>
                          {reimbursement.trip_label && (
                            <span className="text-[10px] sm:text-xs text-sky-700 flex items-center gap-0.5">
                              <Plane className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                              {reimbursement.trip_label}
                            </span>
                          )}
                          {reimbursement.policy_flagged && (
                            <Badge className="bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-50 gap-1 text-[10px] sm:text-xs px-1.5">
                              <ShieldAlert className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                              Policy exception
                            </Badge>
                          )}
                        </div>
                        {reimbursement.description && (
                          <p className="text-[11px] sm:text-sm text-slate-500 mt-1.5 sm:mt-2 line-clamp-2">{reimbursement.description}</p>
                        )}
                        {reimbursement.policy_flagged && reimbursement.status === 'pending' && (
                          <PolicyCheckPanel check={reimbursement.policy_check} compact />
                        )}
                        {reimbursement.admin_remarks && (
                          <div className="mt-1.5 sm:mt-2 p-1.5 sm:p-2 bg-slate-50 rounded-lg">
                            <p className="text-[10px] sm:text-xs text-slate-500">
                              <span className="font-medium">Admin Remarks:</span> {reimbursement.admin_remarks}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 sm:gap-0 sm:text-right shrink-0">
                      <div className="flex items-center sm:block gap-2">
                        <p className="text-lg sm:text-2xl font-bold text-slate-800">₹{parseFloat(reimbursement.amount).toLocaleString()}</p>
                        <div className="sm:mt-2">
                          {getStatusBadge(reimbursement.status)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 sm:gap-2 sm:mt-2">
                        {reimbursement.bill_url && (
                          <a
                            href={reimbursement.bill_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 sm:gap-1 text-[10px] sm:text-xs text-amber-600 hover:text-amber-700"
                          >
                            {reimbursement.bill_type === 'application/pdf'
                              ? <FileText className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                              : <Image className="w-2.5 h-2.5 sm:w-3 sm:h-3" />}
                            View Bill
                          </a>
                        )}
                        {/* Show edit and delete buttons only for pending reimbursements */}
                        {reimbursement.status === 'pending' && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditClick(reimbursement)}
                              className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 h-6 w-6 sm:h-7 sm:w-auto p-0 sm:px-2"
                              aria-label="Edit"
                            >
                              <Pencil className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteClick(reimbursement)}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 h-6 w-6 sm:h-7 sm:w-auto p-0 sm:px-2"
                              aria-label="Delete"
                            >
                              <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Apply / Edit Reimbursement Modal */}
        {claimDialog && (
          <ClaimDialog
            key={claimDialog.id || 'new'}
            open={!!claimDialog}
            onOpenChange={(open) => { if (!open) setClaimDialog(null); }}
            claim={claimDialog.id ? claimDialog : null}
            categories={categories}
            trips={trips}
            onSaved={fetchReimbursements}
          />
        )}

        {/* Delete Confirmation Modal */}
        <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
          <DialogContent className="sm:max-w-md mx-2 sm:mx-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600 text-base sm:text-lg">
                <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5" />
                Delete Reimbursement
              </DialogTitle>
            </DialogHeader>

            <div className="py-3 sm:py-4">
              <p className="text-xs sm:text-sm text-slate-600 mb-3 sm:mb-4">
                Are you sure you want to delete this reimbursement request? This action cannot be undone.
              </p>

              {deleteTarget && (
                <div className="bg-slate-50 rounded-lg p-3 sm:p-4 border border-slate-200">
                  <div className="flex items-start gap-2 sm:gap-3">
                    <div className="p-1.5 sm:p-2 bg-white rounded-lg border border-slate-200">
                      <Receipt className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-slate-800 text-sm sm:text-base truncate">{deleteTarget.title}</h4>
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-1">
                        <Badge variant="outline" className="text-[10px] sm:text-xs px-1.5">
                          {deleteTarget.category}
                        </Badge>
                        <span className="text-[10px] sm:text-sm text-slate-500">
                          {safeDate(deleteTarget.expense_date, 'MMM dd, yyyy')}
                        </span>
                      </div>
                      <p className="text-base sm:text-lg font-bold text-slate-800 mt-1.5 sm:mt-2">
                        ₹{parseFloat(deleteTarget.amount).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={handleCancelDelete}
                disabled={deleting}
                className="text-xs sm:text-sm h-8 sm:h-10"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-700 text-white text-xs sm:text-sm h-8 sm:h-10"
              >
                {deleting ? (
                  <>
                    <div className="animate-spin w-3 h-3 sm:w-4 sm:h-4 border-2 border-white border-t-transparent rounded-full mr-1.5 sm:mr-2"></div>
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                    Delete
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default MyReimbursementsPage;
