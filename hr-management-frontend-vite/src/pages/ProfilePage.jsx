import React, { useState, useEffect, useRef } from 'react';
import { User, Mail, Phone, Briefcase, Calendar, Edit2, Save, X, Camera, Upload, FileText, Trash2, Eye, Shield, CheckCircle, Clock, Gift, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import api from '@/lib/api';
import { format, parseISO, differenceInDays } from 'date-fns';

const ProfilePage = () => {
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPfp, setUploadingPfp] = useState(false);
  const [uploadingGovId, setUploadingGovId] = useState(false);
  const [govIdDialogOpen, setGovIdDialogOpen] = useState(false);
  const [viewGovIdDialogOpen, setViewGovIdDialogOpen] = useState(false);
  const [selectedIdType, setSelectedIdType] = useState('Aadhaar Card');
  const [compOffData, setCompOffData] = useState({ total_balance: 0, comp_offs: [] });
  const [compOffDialogOpen, setCompOffDialogOpen] = useState(false);

  const profilePicInputRef = useRef(null);
  const govIdInputRef = useRef(null);

  const [editForm, setEditForm] = useState({
    full_name: '',
    department: '',
    designation: '',
    phone: '',
  });

  const governmentIdTypes = [
    'Aadhaar Card',
    'PAN Card',
    'Passport',
    'Voter ID',
    'Driving License',
    'Other'
  ];

  useEffect(() => {
    fetchProfile();
    fetchCompOffBalance();
  }, []);

  const fetchProfile = async () => {
    try {
      const response = await api.get('/auth/me');
      setEmployee(response.data);
      setEditForm({
        full_name: response.data.full_name,
        department: response.data.department,
        designation: response.data.designation,
        phone: response.data.phone || '',
      });
    } catch (error) {
      console.error('Failed to fetch profile:', error);
      toast.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const fetchCompOffBalance = async () => {
    try {
      const response = await api.get('/comp-off/balance');
      setCompOffData(response.data);
    } catch (error) {
      console.error('Failed to fetch comp-off balance:', error);
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      await api.put(`/employees/${employee.employee_id}`, editForm);
      toast.success('Profile updated successfully!');
      setEditing(false);
      fetchProfile();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update profile');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    setEditForm({
      full_name: employee.full_name,
      department: employee.department,
      designation: employee.designation,
      phone: employee.phone || '',
    });
    setEditing(false);
  };

  const handleProfilePictureUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast.error('Invalid file type. Please upload JPEG, PNG, GIF, or WebP');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 5MB');
      return;
    }

    setUploadingPfp(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      await api.post('/uploads/profile-picture', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      toast.success('Profile picture uploaded successfully!');
      fetchProfile();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to upload profile picture');
    } finally {
      setUploadingPfp(false);
      if (profilePicInputRef.current) {
        profilePicInputRef.current.value = '';
      }
    }
  };

  const handleDeleteProfilePicture = async () => {
    if (!confirm('Are you sure you want to delete your profile picture?')) return;

    try {
      await api.delete('/uploads/profile-picture');
      toast.success('Profile picture deleted');
      fetchProfile();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete profile picture');
    }
  };

  const handleGovernmentIdUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      toast.error('Invalid file type. Please upload JPEG, PNG, GIF, WebP, or PDF');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 10MB');
      return;
    }

    setUploadingGovId(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('id_type', selectedIdType);

      await api.post('/uploads/government-id', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      toast.success('Government ID uploaded successfully!');
      setGovIdDialogOpen(false);
      fetchProfile();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to upload government ID');
    } finally {
      setUploadingGovId(false);
      if (govIdInputRef.current) {
        govIdInputRef.current.value = '';
      }
    }
  };

  const handleDeleteGovernmentId = async () => {
    if (!confirm('Are you sure you want to delete your government ID?')) return;

    try {
      await api.delete('/uploads/government-id');
      toast.success('Government ID deleted');
      fetchProfile();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete government ID');
    }
  };

  const isImageFile = (url) => {
    if (!url) return false;
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    return imageExtensions.some(ext => url.toLowerCase().includes(ext));
  };

  const formatDate = (dateStr) => {
    try {
      return format(parseISO(dateStr), 'MMM dd, yyyy');
    } catch {
      return dateStr;
    }
  };

  const formatShortDate = (dateStr) => {
    try {
      return format(parseISO(dateStr), 'MMM dd');
    } catch {
      return dateStr;
    }
  };

  const getDaysUntilExpiry = (expiryDateStr) => {
    if (!expiryDateStr) return null;
    try {
      const expiryDate = parseISO(expiryDateStr);
      const today = new Date();
      return differenceInDays(expiryDate, today);
    } catch {
      return null;
    }
  };

  const getExpiryStatus = (daysLeft) => {
    if (daysLeft === null) return { color: 'slate', text: 'No expiry' };
    if (daysLeft <= 0) return { color: 'red', text: 'Expired' };
    if (daysLeft <= 7) return { color: 'red', text: `${daysLeft}d left` };
    if (daysLeft <= 30) return { color: 'amber', text: `${daysLeft}d left` };
    return { color: 'emerald', text: `${daysLeft}d left` };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500 text-sm sm:text-base">Loading...</div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500 text-sm sm:text-base">Profile not found</div>
      </div>
    );
  }

  const compOffBalance = employee.leave_balance?.comp_off ?? compOffData.total_balance ?? 0;

  return (
    <div className="p-3 sm:p-6 md:p-10 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 mb-1 sm:mb-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            My Profile
          </h1>
          <p className="text-sm sm:text-base md:text-lg text-slate-600">View and manage your information</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Profile Info Card */}
        <Card className="lg:col-span-2 border-slate-100 shadow-sm">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-lg sm:text-xl md:text-2xl font-semibold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
              Personal Information
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0">
            {editing ? (
              <form onSubmit={handleUpdate} className="space-y-3 sm:space-y-4">
                <div>
                  <Label htmlFor="edit-name" className="text-xs sm:text-sm">Full Name</Label>
                  <Input
                    id="edit-name"
                    data-testid="edit-name-input"
                    value={editForm.full_name}
                    onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                    required
                    className="mt-1 text-sm h-9 sm:h-10"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <Label htmlFor="edit-department" className="text-xs sm:text-sm">Department</Label>
                    <Input
                      id="edit-department"
                      data-testid="edit-department-input"
                      value={editForm.department}
                      onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                      required
                      className="mt-1 text-sm h-9 sm:h-10"
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-designation" className="text-xs sm:text-sm">Designation</Label>
                    <Input
                      id="edit-designation"
                      data-testid="edit-designation-input"
                      value={editForm.designation}
                      onChange={(e) => setEditForm({ ...editForm, designation: e.target.value })}
                      required
                      className="mt-1 text-sm h-9 sm:h-10"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="edit-phone" className="text-xs sm:text-sm">Phone</Label>
                  <Input
                    id="edit-phone"
                    data-testid="edit-phone-input"
                    type="tel"
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    className="mt-1 text-sm h-9 sm:h-10"
                  />
                </div>
                <div className="flex gap-2 sm:gap-3 pt-3 sm:pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancel}
                    className="flex-1 text-xs sm:text-sm h-9 sm:h-10"
                    disabled={submitting}
                  >
                    <X className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    data-testid="save-profile-btn"
                    className="flex-1 bg-slate-800 hover:bg-slate-900 text-xs sm:text-sm h-9 sm:h-10"
                    disabled={submitting}
                  >
                    <Save className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                    {submitting ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="space-y-4 sm:space-y-6">
                {/* Profile Picture Section */}
                <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4 pb-4 sm:pb-6 border-b border-slate-100">
                  <div className="relative group">
                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden ring-4 ring-slate-100">
                      {employee.profile_picture_url ? (
                        <img
                          src={employee.profile_picture_url}
                          alt={employee.full_name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User className="w-10 h-10 sm:w-12 sm:h-12 text-slate-600" />
                      )}
                    </div>
                    <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <label className="cursor-pointer p-2">
                        <Camera className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                        <input
                          ref={profilePicInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/gif,image/webp"
                          className="hidden"
                          onChange={handleProfilePictureUpload}
                          disabled={uploadingPfp}
                        />
                      </label>
                    </div>
                    {uploadingPfp && (
                      <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                        <div className="w-5 h-5 sm:w-6 sm:h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 text-center sm:text-left">
                    <h2 className="text-xl sm:text-2xl font-bold text-slate-900">{employee.full_name}</h2>
                    <Badge className="mt-1.5 sm:mt-2 capitalize text-xs">{employee.role}</Badge>
                    <div className="flex flex-wrap justify-center sm:justify-start gap-2 mt-2 sm:mt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] sm:text-xs h-7 sm:h-8 px-2 sm:px-3"
                        onClick={() => profilePicInputRef.current?.click()}
                        disabled={uploadingPfp}
                      >
                        <Camera className="w-3 h-3 mr-1" />
                        {employee.profile_picture_url ? 'Change' : 'Upload'}
                      </Button>
                      {employee.profile_picture_url && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-[10px] sm:text-xs text-red-600 hover:text-red-700 hover:bg-red-50 h-7 sm:h-8 px-2 sm:px-3"
                          onClick={handleDeleteProfilePicture}
                        >
                          <Trash2 className="w-3 h-3 mr-1" />
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                  <div>
                    <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2">
                      <Mail className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                      <p className="text-[10px] sm:text-sm font-medium text-slate-500 uppercase tracking-wider">Email</p>
                    </div>
                    <p className="text-xs sm:text-base text-slate-900 ml-6 sm:ml-8 break-all">{employee.email}</p>
                  </div>

                  {employee.phone && (
                    <div>
                      <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2">
                        <Phone className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                        <p className="text-[10px] sm:text-sm font-medium text-slate-500 uppercase tracking-wider">Phone</p>
                      </div>
                      <p className="text-xs sm:text-base text-slate-900 ml-6 sm:ml-8">{employee.phone}</p>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2">
                      <Briefcase className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                      <p className="text-[10px] sm:text-sm font-medium text-slate-500 uppercase tracking-wider">Department</p>
                    </div>
                    <p className="text-xs sm:text-base text-slate-900 ml-6 sm:ml-8">{employee.department}</p>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2">
                      <Briefcase className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                      <p className="text-[10px] sm:text-sm font-medium text-slate-500 uppercase tracking-wider">Designation</p>
                    </div>
                    <p className="text-xs sm:text-base text-slate-900 ml-6 sm:ml-8">{employee.designation}</p>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2">
                      <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                      <p className="text-[10px] sm:text-sm font-medium text-slate-500 uppercase tracking-wider">Joining Date</p>
                    </div>
                    <p className="text-xs sm:text-base text-slate-900 ml-6 sm:ml-8">
                      {format(new Date(employee.joining_date), 'MMMM dd, yyyy')}
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2">
                      <User className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                      <p className="text-[10px] sm:text-sm font-medium text-slate-500 uppercase tracking-wider">Employee ID</p>
                    </div>
                    <p className="text-xs sm:text-base text-slate-900 ml-6 sm:ml-8">{employee.employee_id}</p>
                  </div>
                </div>

                {employee.manager_name && (
                  <div className="pt-4 sm:pt-6 border-t border-slate-100">
                    <p className="text-[10px] sm:text-sm font-medium text-slate-500 uppercase tracking-wider mb-1.5 sm:mb-2">Reports To</p>
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-slate-200 flex items-center justify-center">
                        <User className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 text-sm sm:text-base">{employee.manager_name}</p>
                        <p className="text-xs sm:text-sm text-slate-500">{employee.manager_email}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Column */}
        <div className="space-y-4 sm:space-y-6">
          {/* Government ID Card */}
          <Card className="border-slate-100 shadow-sm">
            <CardHeader className="p-3 sm:p-6">
              <CardTitle className="text-base sm:text-xl font-semibold text-slate-900 flex items-center gap-1.5 sm:gap-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
                <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
                Government ID
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
              {employee.government_id_url ? (
                <div className="space-y-3 sm:space-y-4">
                  <div className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                    {isImageFile(employee.government_id_url) ? (
                      <img
                        src={employee.government_id_url}
                        alt="Government ID"
                        className="w-full h-28 sm:h-40 object-cover"
                      />
                    ) : (
                      <div className="w-full h-28 sm:h-40 flex flex-col items-center justify-center">
                        <FileText className="w-8 h-8 sm:w-12 sm:h-12 text-slate-400 mb-1.5 sm:mb-2" />
                        <p className="text-xs sm:text-sm text-slate-500">PDF Document</p>
                      </div>
                    )}
                    <div className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2">
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] sm:text-xs px-1.5 sm:px-2">
                        <CheckCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3 mr-0.5 sm:mr-1" />
                        Uploaded
                      </Badge>
                    </div>
                  </div>

                  <div className="bg-slate-50 rounded-lg p-2 sm:p-3 border border-slate-200">
                    <p className="text-xs sm:text-sm font-medium text-slate-700">{employee.government_id_type || 'Government ID'}</p>
                    {employee.government_id_uploaded_at && (
                      <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5 sm:mt-1">
                        Uploaded on {format(new Date(employee.government_id_uploaded_at), 'MMM dd, yyyy')}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-1.5 sm:gap-2">
                    <Dialog open={viewGovIdDialogOpen} onOpenChange={setViewGovIdDialogOpen}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="flex-1 text-[10px] sm:text-xs h-8 sm:h-9">
                          <Eye className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                          View
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-3xl mx-2 sm:mx-auto max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle className="text-sm sm:text-base">{employee.government_id_type || 'Government ID'}</DialogTitle>
                        </DialogHeader>
                        <div className="mt-3 sm:mt-4">
                          {isImageFile(employee.government_id_url) ? (
                            <img
                              src={employee.government_id_url}
                              alt="Government ID"
                              className="w-full rounded-lg"
                            />
                          ) : (
                            <iframe
                              src={employee.government_id_url}
                              className="w-full h-[400px] sm:h-[600px] rounded-lg border"
                              title="Government ID PDF"
                            />
                          )}
                        </div>
                      </DialogContent>
                    </Dialog>

                    <Dialog open={govIdDialogOpen} onOpenChange={setGovIdDialogOpen}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="flex-1 text-[10px] sm:text-xs h-8 sm:h-9">
                          <Upload className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                          Replace
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="mx-2 sm:mx-auto max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle className="text-sm sm:text-base">Upload Government ID</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
                          <div>
                            <Label className="text-xs sm:text-sm">ID Type</Label>
                            <Select value={selectedIdType} onValueChange={setSelectedIdType}>
                              <SelectTrigger className="mt-1 text-xs sm:text-sm h-9 sm:h-10">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {governmentIdTypes.map(type => (
                                  <SelectItem key={type} value={type} className="text-xs sm:text-sm">{type}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs sm:text-sm">Upload Document</Label>
                            <div className="mt-1.5 sm:mt-2 border-2 border-dashed border-slate-300 rounded-lg p-4 sm:p-6 text-center hover:border-slate-400 transition-colors">
                              <input
                                ref={govIdInputRef}
                                type="file"
                                accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
                                className="hidden"
                                onChange={handleGovernmentIdUpload}
                                disabled={uploadingGovId}
                              />
                              <Upload className="w-6 h-6 sm:w-8 sm:h-8 text-slate-400 mx-auto mb-1.5 sm:mb-2" />
                              <p className="text-xs sm:text-sm text-slate-600 mb-0.5 sm:mb-1">Click to upload or drag and drop</p>
                              <p className="text-[10px] sm:text-xs text-slate-500">JPEG, PNG, GIF, WebP or PDF (max 10MB)</p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="mt-2 sm:mt-3 text-xs h-8"
                                onClick={() => govIdInputRef.current?.click()}
                                disabled={uploadingGovId}
                              >
                                {uploadingGovId ? 'Uploading...' : 'Select File'}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>

                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8 sm:h-9 px-2 sm:px-3"
                      onClick={handleDeleteGovernmentId}
                    >
                      <Trash2 className="w-3 h-3 sm:w-4 sm:h-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 sm:py-6">
                  <Shield className="w-10 h-10 sm:w-12 sm:h-12 text-slate-300 mx-auto mb-2 sm:mb-3" />
                  <p className="text-xs sm:text-sm text-slate-500 mb-3 sm:mb-4">No government ID uploaded</p>

                  <Dialog open={govIdDialogOpen} onOpenChange={setGovIdDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="bg-slate-800 hover:bg-slate-900 text-xs sm:text-sm h-8 sm:h-10">
                        <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                        Upload ID
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="mx-2 sm:mx-auto max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle className="text-sm sm:text-base">Upload Government ID</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
                        <div>
                          <Label className="text-xs sm:text-sm">ID Type</Label>
                          <Select value={selectedIdType} onValueChange={setSelectedIdType}>
                            <SelectTrigger className="mt-1 text-xs sm:text-sm h-9 sm:h-10">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {governmentIdTypes.map(type => (
                                <SelectItem key={type} value={type} className="text-xs sm:text-sm">{type}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs sm:text-sm">Upload Document</Label>
                          <div className="mt-1.5 sm:mt-2 border-2 border-dashed border-slate-300 rounded-lg p-4 sm:p-6 text-center hover:border-slate-400 transition-colors">
                            <input
                              ref={govIdInputRef}
                              type="file"
                              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
                              className="hidden"
                              onChange={handleGovernmentIdUpload}
                              disabled={uploadingGovId}
                            />
                            <Upload className="w-6 h-6 sm:w-8 sm:h-8 text-slate-400 mx-auto mb-1.5 sm:mb-2" />
                            <p className="text-xs sm:text-sm text-slate-600 mb-0.5 sm:mb-1">Click to upload or drag and drop</p>
                            <p className="text-[10px] sm:text-xs text-slate-500">JPEG, PNG, GIF, WebP or PDF (max 10MB)</p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-2 sm:mt-3 text-xs h-8"
                              onClick={() => govIdInputRef.current?.click()}
                              disabled={uploadingGovId}
                            >
                              {uploadingGovId ? 'Uploading...' : 'Select File'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Leave Balance Card */}
          <Card className="border-slate-100 shadow-sm">
            <CardHeader className="p-3 sm:p-6">
              <CardTitle className="text-base sm:text-xl font-semibold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
                Leave Balance
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-1 gap-2 sm:gap-3">
                {/* Sick Leave */}
                <div className="p-2 sm:p-3 bg-red-50 rounded-lg border border-red-100">
                  <p className="text-[10px] sm:text-xs font-medium text-red-700 mb-0.5 sm:mb-1">Sick Leave</p>
                  <p className="text-lg sm:text-2xl font-bold text-red-900">{employee.leave_balance?.sick_leave ?? 0}</p>
                  <p className="text-[10px] sm:text-xs text-red-600">days remaining</p>
                </div>

                {/* Casual Leave */}
                <div className="p-2 sm:p-3 bg-amber-50 rounded-lg border border-amber-100">
                  <p className="text-[10px] sm:text-xs font-medium text-amber-700 mb-0.5 sm:mb-1">Casual Leave</p>
                  <p className="text-lg sm:text-2xl font-bold text-amber-900">{employee.leave_balance?.casual_leave ?? 0}</p>
                  <p className="text-[10px] sm:text-xs text-amber-600">days remaining</p>
                </div>

                {/* Paid Leave */}
                <div className="p-2 sm:p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                  <p className="text-[10px] sm:text-xs font-medium text-emerald-700 mb-0.5 sm:mb-1">Earned Leave</p>
                  <p className="text-lg sm:text-2xl font-bold text-emerald-900">{employee.leave_balance?.earned_leave ?? 0}</p>
                  <p className="text-[10px] sm:text-xs text-emerald-600">days remaining</p>
                </div>

                {/* Unpaid Leave */}
                <div className="p-2 sm:p-3 bg-amber-50 rounded-lg border border-amber-100">
                  <p className="text-[10px] sm:text-xs font-medium text-amber-700 mb-0.5 sm:mb-1">Unpaid Leave</p>
                  <p className="text-lg sm:text-2xl font-bold text-amber-900">{employee.leave_balance?.unpaid_leave ?? 0}</p>
                  <p className="text-[10px] sm:text-xs text-amber-600">days taken</p>
                </div>

                {/* Comp Off - Enhanced with work dates */}
                <div className="col-span-2 sm:col-span-1 p-2 sm:p-3 bg-purple-50 rounded-lg border border-purple-200">
                  <div className="flex items-center justify-between mb-0.5 sm:mb-1">
                    <div className="flex items-center gap-1 sm:gap-1.5">
                      <Gift className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-purple-600" />
                      <p className="text-[10px] sm:text-xs font-medium text-purple-700">Comp Off</p>
                    </div>
                    {compOffData.comp_offs.length > 0 && (
                      <button
                        onClick={() => setCompOffDialogOpen(true)}
                        className="text-[10px] sm:text-xs text-purple-600 hover:text-purple-800 underline"
                      >
                        View Details
                      </button>
                    )}
                  </div>

                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-lg sm:text-2xl font-bold text-purple-900">{compOffBalance}</p>
                      <p className="text-[10px] sm:text-xs text-purple-600">days available</p>
                    </div>
                    {compOffData.comp_offs.length > 0 && (
                      <Badge className="bg-purple-100 text-purple-700 text-[10px] sm:text-xs px-1.5 sm:px-2">
                        {compOffData.comp_offs.length} grant{compOffData.comp_offs.length !== 1 ? 's' : ''}
                      </Badge>
                    )}
                  </div>

                  {/* Work dates preview */}
                  {compOffData.comp_offs.length > 0 && (
                    <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-purple-200 space-y-1 sm:space-y-1.5">
                      <p className="text-[10px] sm:text-xs font-medium text-purple-700">Work Dates:</p>
                      {compOffData.comp_offs.slice(0, 3).map((compOff, idx) => {
                        const daysLeft = getDaysUntilExpiry(compOff.expiry_date);
                        const expiryStatus = getExpiryStatus(daysLeft);

                        return (
                          <div
                            key={compOff.id || idx}
                            className="flex items-center justify-between bg-purple-100/50 px-1.5 sm:px-2 py-1 sm:py-1.5 rounded text-[10px] sm:text-xs"
                          >
                            <div className="flex items-center gap-1 sm:gap-1.5">
                              <Calendar className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-purple-500" />
                              <span className="text-purple-800 font-medium">
                                {formatShortDate(compOff.work_date)}
                              </span>
                              <span className="text-purple-600">
                                ({compOff.remaining_days ?? compOff.days}d)
                              </span>
                            </div>
                            {daysLeft !== null && daysLeft <= 30 && (
                              <span className={`text-[8px] sm:text-[10px] px-1 sm:px-1.5 py-0.5 rounded font-medium
                                ${expiryStatus.color === 'red' ? 'bg-red-100 text-red-700' : ''}
                                ${expiryStatus.color === 'amber' ? 'bg-amber-100 text-amber-700' : ''}
                                ${expiryStatus.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' : ''}
                              `}>
                                {expiryStatus.text}
                              </span>
                            )}
                          </div>
                        );
                      })}
                      {compOffData.comp_offs.length > 3 && (
                        <button
                          onClick={() => setCompOffDialogOpen(true)}
                          className="w-full text-[10px] sm:text-xs text-purple-600 hover:text-purple-800 py-0.5 sm:py-1 text-center"
                        >
                          +{compOffData.comp_offs.length - 3} more...
                        </button>
                      )}
                    </div>
                  )}

                  {compOffData.comp_offs.length === 0 && compOffBalance === 0 && (
                    <p className="text-[10px] sm:text-xs text-purple-500 mt-1.5 sm:mt-2 italic">No comp-off available</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Comp-Off Details Dialog */}
      <Dialog open={compOffDialogOpen} onOpenChange={setCompOffDialogOpen}>
        <DialogContent className="max-w-md mx-2 sm:mx-auto max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 sm:gap-2 text-sm sm:text-base">
              <Gift className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600" />
              Comp-Off Details
            </DialogTitle>
          </DialogHeader>
          <div className="mt-3 sm:mt-4">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-3 sm:mb-4">
              <div className="p-2 sm:p-3 bg-purple-50 rounded-lg text-center border border-purple-200">
                <p className="text-lg sm:text-2xl font-bold text-purple-800">{compOffBalance}</p>
                <p className="text-[10px] sm:text-xs text-purple-600">Available</p>
              </div>
              <div className="p-2 sm:p-3 bg-amber-50 rounded-lg text-center border border-amber-200">
                <p className="text-lg sm:text-2xl font-bold text-amber-800">
                  {compOffData.comp_offs.reduce((sum, c) => sum + (c.days || 0), 0)}
                </p>
                <p className="text-[10px] sm:text-xs text-amber-600">Total Granted</p>
              </div>
              <div className="p-2 sm:p-3 bg-amber-50 rounded-lg text-center border border-amber-200">
                <p className="text-lg sm:text-2xl font-bold text-amber-800">
                  {compOffData.comp_offs.reduce((sum, c) => sum + ((c.days || 0) - (c.remaining_days || c.days || 0)), 0)}
                </p>
                <p className="text-[10px] sm:text-xs text-amber-600">Used</p>
              </div>
            </div>

            {/* List of comp-offs */}
            <div className="space-y-2 sm:space-y-3 max-h-[280px] sm:max-h-[350px] overflow-y-auto">
              {compOffData.comp_offs.length === 0 ? (
                <div className="text-center py-6 sm:py-8 text-slate-500">
                  <Gift className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-2 sm:mb-3 text-slate-300" />
                  <p className="text-xs sm:text-sm">No comp-off records</p>
                </div>
              ) : (
                compOffData.comp_offs.map((compOff, idx) => {
                  const daysLeft = getDaysUntilExpiry(compOff.expiry_date);
                  const expiryStatus = getExpiryStatus(daysLeft);
                  const isExpired = daysLeft !== null && daysLeft <= 0;

                  return (
                    <div
                      key={compOff.id || idx}
                      className={`p-2 sm:p-3 rounded-lg border ${isExpired ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-purple-50 border-purple-200'}`}
                    >
                      <div className="flex items-start justify-between mb-1.5 sm:mb-2">
                        <div>
                          <div className="flex items-center gap-1.5 sm:gap-2">
                            <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-purple-600" />
                            <span className="font-semibold text-purple-900 text-xs sm:text-sm">
                              {formatDate(compOff.work_date)}
                            </span>
                          </div>
                          <p className="text-[10px] sm:text-xs text-purple-600 mt-0.5 sm:mt-1 ml-5 sm:ml-6">
                            {compOff.reason}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-base sm:text-lg font-bold text-purple-800">
                            {compOff.remaining_days ?? compOff.days}
                            <span className="text-xs sm:text-sm font-normal text-purple-600">/{compOff.days}d</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1.5 sm:pt-2 border-t border-purple-200/50">
                        <div className="flex items-center gap-1 sm:gap-1.5 text-[10px] sm:text-xs text-purple-600">
                          <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                          <span>Expires: {compOff.expiry_date ? formatDate(compOff.expiry_date) : 'N/A'}</span>
                        </div>
                        <span className={`text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded font-medium
                          ${expiryStatus.color === 'red' ? 'bg-red-100 text-red-700' : ''}
                          ${expiryStatus.color === 'amber' ? 'bg-amber-100 text-amber-700' : ''}
                          ${expiryStatus.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' : ''}
                          ${expiryStatus.color === 'slate' ? 'bg-slate-100 text-slate-600' : ''}
                        `}>
                          {expiryStatus.text}
                        </span>
                      </div>

                      {isExpired && (
                        <div className="flex items-center gap-1 mt-1.5 sm:mt-2 text-[10px] sm:text-xs text-red-600">
                          <AlertTriangle className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                          <span>This comp-off has expired</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProfilePage;
