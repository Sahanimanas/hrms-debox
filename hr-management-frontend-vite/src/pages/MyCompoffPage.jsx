import React, { useState, useEffect } from 'react';
import { Plus, Calendar, Clock, CheckCircle, XCircle, AlertCircle, Gift, CalendarDays, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { format, addDays } from 'date-fns';

const MyCompOffPage = () => {
  const [compOffs, setCompOffs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [holidays, setHolidays] = useState([]);

  // Form states
  const [formData, setFormData] = useState({
    work_date: '',
    days: '1',
    reason: ''
  });

  useEffect(() => {
    fetchCompOffs();
    fetchHolidays();
  }, []);

  const fetchCompOffs = async () => {
    try {
      setLoading(true);
      const response = await api.get('/comp-off/my-requests');
      setCompOffs(response.data || []);
    } catch (error) {
      toast.error('Failed to load comp-off requests');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const fetchHolidays = async () => {
    try {
      const response = await api.get('/holidays');
      setHolidays(response.data || []);
    } catch (error) {
      console.error('Failed to fetch holidays:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      work_date: '',
      days: '1',
      reason: ''
    });
  };

  const handleSubmit = async () => {
    if (!formData.work_date) {
      toast.error('Please select the date you worked');
      return;
    }
    if (!formData.reason.trim()) {
      toast.error('Please provide a reason');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/comp-off/request', {
        work_date: formData.work_date,
        days: parseFloat(formData.days),
        reason: formData.reason
      });

      toast.success('Comp-off request submitted successfully');
      setShowRequestModal(false);
      resetForm();
      fetchCompOffs();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
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
          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 gap-1 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">
            <CheckCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
            Approved
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
        return <Badge variant="outline" className="text-[10px] sm:text-xs">{status}</Badge>;
    }
  };

  const getAvailableCompOffs = () => {
    return compOffs
      .filter(c => c.status === 'approved' && c.remaining_days > 0)
      .reduce((sum, c) => sum + (c.remaining_days || 0), 0);
  };

  const getPendingCount = () => {
    return compOffs.filter(c => c.status === 'pending').length;
  };

  const getTotalEarned = () => {
    return compOffs
      .filter(c => c.status === 'approved')
      .reduce((sum, c) => sum + (c.days || 0), 0);
  };

  const isHoliday = (dateStr) => {
    return holidays.some(h => {
      const holidayDate = new Date(h.date).toISOString().split('T')[0];
      return holidayDate === dateStr;
    });
  };

  const getHolidayName = (dateStr) => {
    const holiday = holidays.find(h => {
      const holidayDate = new Date(h.date).toISOString().split('T')[0];
      return holidayDate === dateStr;
    });
    return holiday?.name || '';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-3 sm:p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-5 sm:mb-8">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="p-2 sm:p-3 bg-slate-800 rounded-lg sm:rounded-xl shadow-lg">
              <Gift className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
                My Comp-Offs
              </h1>
              <p className="text-xs sm:text-sm text-slate-600">Request compensatory off for working on holidays</p>
            </div>
          </div>
          <Button
            onClick={() => setShowRequestModal(true)}
            className="bg-slate-800 hover:bg-slate-900 rounded-lg sm:rounded-xl shadow-md gap-1.5 sm:gap-2 text-xs sm:text-sm h-9 sm:h-10 w-full sm:w-auto"
          >
            <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            Request Comp-Off
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-5 sm:mb-8">
          <Card className="border-0 shadow-md bg-gradient-to-br from-emerald-50 to-green-50">
            <CardContent className="p-2.5 sm:p-4 md:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="order-2 sm:order-1">
                  <p className="text-[10px] sm:text-xs md:text-sm text-emerald-600 font-medium">Available</p>
                  <p className="text-lg sm:text-2xl md:text-3xl font-bold text-emerald-700">{getAvailableCompOffs()}</p>
                  <p className="text-[10px] sm:text-xs text-emerald-600">days to use</p>
                </div>
                <div className="p-1.5 sm:p-2 md:p-3 bg-emerald-200 rounded-lg sm:rounded-xl order-1 sm:order-2 w-fit">
                  <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-emerald-700" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md bg-gradient-to-br from-amber-50 to-orange-50">
            <CardContent className="p-2.5 sm:p-4 md:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="order-2 sm:order-1">
                  <p className="text-[10px] sm:text-xs md:text-sm text-amber-600 font-medium">Pending</p>
                  <p className="text-lg sm:text-2xl md:text-3xl font-bold text-amber-700">{getPendingCount()}</p>
                  <p className="text-[10px] sm:text-xs text-amber-600">awaiting</p>
                </div>
                <div className="p-1.5 sm:p-2 md:p-3 bg-amber-200 rounded-lg sm:rounded-xl order-1 sm:order-2 w-fit">
                  <Clock className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-amber-700" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md bg-gradient-to-br from-amber-50 to-amber-50">
            <CardContent className="p-2.5 sm:p-4 md:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="order-2 sm:order-1">
                  <p className="text-[10px] sm:text-xs md:text-sm text-amber-600 font-medium">Earned</p>
                  <p className="text-lg sm:text-2xl md:text-3xl font-bold text-amber-700">{getTotalEarned()}</p>
                  <p className="text-[10px] sm:text-xs text-amber-600">approved</p>
                </div>
                <div className="p-1.5 sm:p-2 md:p-3 bg-amber-200 rounded-lg sm:rounded-xl order-1 sm:order-2 w-fit">
                  <Gift className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-amber-700" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Comp-Off List */}
        <Card className="border-0 shadow-md">
          <CardHeader className="border-b border-slate-100 p-3 sm:p-6">
            <CardTitle className="text-base sm:text-lg md:text-xl flex items-center gap-1.5 sm:gap-2">
              <CalendarDays className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
              Comp-Off History
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="text-center py-10 sm:py-16">
                <div className="animate-spin w-8 h-8 sm:w-10 sm:h-10 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-3 sm:mb-4"></div>
                <p className="text-xs sm:text-sm text-slate-500">Loading comp-offs...</p>
              </div>
            ) : compOffs.length === 0 ? (
              <div className="text-center py-10 sm:py-16">
                <div className="w-14 h-14 sm:w-20 sm:h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-4">
                  <Gift className="w-7 h-7 sm:w-10 sm:h-10 text-slate-300" />
                </div>
                <h3 className="text-sm sm:text-lg font-semibold text-slate-700 mb-1.5 sm:mb-2">No Comp-Off Requests</h3>
                <p className="text-xs sm:text-sm text-slate-500 mb-4 sm:mb-6">You haven't requested any comp-offs yet</p>
                <Button
                  onClick={() => setShowRequestModal(true)}
                  className="bg-slate-800 hover:bg-slate-900 text-xs sm:text-sm h-9 sm:h-10"
                >
                  <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                  Request Comp-Off
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {compOffs.map((compOff) => (
                  <div key={compOff.id} className="p-3 sm:p-5 hover:bg-slate-50 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                      <div className="flex gap-2.5 sm:gap-4 flex-1 min-w-0">
                        <div className="p-2 sm:p-3 bg-slate-100 rounded-lg sm:rounded-xl shrink-0">
                          <Calendar className="w-4 h-4 sm:w-6 sm:h-6 text-slate-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-1">
                            <h3 className="font-semibold text-slate-800 text-sm sm:text-base">
                              {format(new Date(compOff.work_date), 'MMM dd, yyyy')}
                            </h3>
                            {getStatusBadge(compOff.status)}
                          </div>
                          <p className="text-[11px] sm:text-sm text-slate-500 mb-1.5 sm:mb-2 line-clamp-2">{compOff.reason}</p>
                          <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-[10px] sm:text-sm">
                            <span className="text-slate-500">
                              Requested: {format(new Date(compOff.created_at), 'MMM dd, yyyy')}
                            </span>
                            {compOff.status === 'approved' && compOff.expiry_date && (
                              <span className="text-amber-600">
                                Expires: {format(new Date(compOff.expiry_date), 'MMM dd, yyyy')}
                              </span>
                            )}
                          </div>
                          {compOff.remarks && (
                            <div className="mt-1.5 sm:mt-2 p-1.5 sm:p-2 bg-slate-100 rounded-lg">
                              <p className="text-[10px] sm:text-xs text-slate-600">
                                <span className="font-medium">Remarks:</span> {compOff.remarks}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 sm:gap-0 shrink-0">
                        <div className="flex items-center sm:block gap-2 sm:text-right">
                          <p className="text-lg sm:text-2xl font-bold text-slate-700">{compOff.days}</p>
                          <p className="text-[10px] sm:text-xs text-slate-500">day{compOff.days !== 1 ? 's' : ''}</p>
                        </div>
                        {compOff.status === 'approved' && (
                          <div className="text-right">
                            <p className="text-[10px] sm:text-xs text-slate-500">Remaining</p>
                            <p className="text-base sm:text-lg font-semibold text-emerald-600">{compOff.remaining_days || compOff.days}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Request Comp-Off Modal */}
        <Dialog open={showRequestModal} onOpenChange={setShowRequestModal}>
          <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto mx-2 sm:mx-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-1.5 sm:gap-2 text-base sm:text-lg">
                <Gift className="w-4 h-4 sm:w-5 sm:h-5 text-slate-700" />
                Request Comp-Off
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3 sm:space-y-4 py-3 sm:py-4">
              {/* Work Date */}
              <div>
                <Label className="text-slate-700 font-medium text-xs sm:text-sm">Date You Worked *</Label>
                <Input
                  type="date"
                  value={formData.work_date}
                  onChange={(e) => setFormData({ ...formData, work_date: e.target.value })}
                  max={format(new Date(), 'yyyy-MM-dd')}
                  className="mt-1 sm:mt-1.5 text-sm h-9 sm:h-10"
                />
                {formData.work_date && isHoliday(formData.work_date) && (
                  <p className="text-[10px] sm:text-xs text-emerald-600 mt-1">
                    ✓ This was a holiday: {getHolidayName(formData.work_date)}
                  </p>
                )}
                {formData.work_date && !isHoliday(formData.work_date) && (
                  <p className="text-[10px] sm:text-xs text-amber-600 mt-1">
                    ⚠ This date is not marked as a holiday in the system
                  </p>
                )}
              </div>

              {/* Days */}
              <div>
                <Label className="text-slate-700 font-medium text-xs sm:text-sm">Comp-Off Days *</Label>
                <div className="flex gap-2 sm:gap-3 mt-1 sm:mt-1.5">
                  <Button
                    type="button"
                    variant={formData.days === '0.5' ? 'default' : 'outline'}
                    className={`flex-1 text-xs sm:text-sm h-9 sm:h-10 ${formData.days === '0.5' ? 'bg-slate-800 hover:bg-slate-900' : ''}`}
                    onClick={() => setFormData({ ...formData, days: '0.5' })}
                  >
                    Half Day
                  </Button>
                  <Button
                    type="button"
                    variant={formData.days === '1' ? 'default' : 'outline'}
                    className={`flex-1 text-xs sm:text-sm h-9 sm:h-10 ${formData.days === '1' ? 'bg-slate-800 hover:bg-slate-900' : ''}`}
                    onClick={() => setFormData({ ...formData, days: '1' })}
                  >
                    Full Day
                  </Button>
                </div>
              </div>

              {/* Reason */}
              <div>
                <Label className="text-slate-700 font-medium text-xs sm:text-sm">Reason *</Label>
                <Textarea
                  placeholder="Describe why you worked on this holiday..."
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  className="mt-1 sm:mt-1.5 text-xs sm:text-sm"
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => {
                  setShowRequestModal(false);
                  resetForm();
                }}
                className="text-xs sm:text-sm h-8 sm:h-10"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="bg-slate-800 hover:bg-slate-900 text-xs sm:text-sm h-8 sm:h-10"
              >
                {submitting ? (
                  <>
                    <div className="animate-spin w-3 h-3 sm:w-4 sm:h-4 border-2 border-white border-t-transparent rounded-full mr-1.5 sm:mr-2"></div>
                    Submitting...
                  </>
                ) : (
                  'Submit Request'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default MyCompOffPage;
