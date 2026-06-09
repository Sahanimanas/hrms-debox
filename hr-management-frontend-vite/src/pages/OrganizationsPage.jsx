import React, { useState, useEffect } from 'react';
import { Building2, Plus, Pencil, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';

const OrganizationsPage = () => {
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingOrg, setEditingOrg] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    logo_url: '',
    description: ''
  });

  useEffect(() => {
    fetchOrganizations();
  }, []);

  const fetchOrganizations = async () => {
    try {
      const response = await api.get('/organizations');
      setOrganizations(response.data);
    } catch (error) {
      toast.error('Failed to load organizations');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      if (editingOrg) {
        await api.put(`/organizations/${editingOrg.id}`, formData);
        toast.success('Organization updated successfully');
      } else {
        await api.post('/organizations', formData);
        toast.success('Organization created successfully');
      }
      
      setShowModal(false);
      setEditingOrg(null);
      setFormData({ name: '', logo_url: '', description: '' });
      fetchOrganizations();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save organization');
    }
  };

  const handleEdit = (org) => {
    setEditingOrg(org);
    setFormData({
      name: org.name,
      logo_url: org.logo_url || '',
      description: org.description || ''
    });
    setShowModal(true);
  };

  const handleDelete = async (orgId) => {
    if (!window.confirm('Are you sure you want to delete this organization? This will fail if there are employees assigned.')) {
      return;
    }
    
    try {
      await api.delete(`/organizations/${orgId}`);
      toast.success('Organization deleted successfully');
      fetchOrganizations();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete organization');
    }
  };

  const handleAddNew = () => {
    setEditingOrg(null);
    setFormData({ name: '', logo_url: '', description: '' });
    setShowModal(true);
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image size should be less than 2MB');
      return;
    }

    setUploading(true);

    const reader = new FileReader();
    reader.onloadend = () => {
      setFormData({ ...formData, logo_url: reader.result });
      setUploading(false);
      toast.success('Logo uploaded successfully');
    };
    reader.onerror = () => {
      toast.error('Failed to upload logo');
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  if (loading) {
    return <div className="p-8 text-slate-500">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-4xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
              Organizations
            </h1>
            <p className="text-slate-600 mt-2">Manage your organizations and their settings</p>
          </div>
          
          <Button
            onClick={handleAddNew}
            className="bg-slate-800 hover:bg-slate-900 rounded-full"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Organization
          </Button>
        </div>

        {/* Organizations Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {organizations.map((org) => (
            <Card key={org.id} className="border-slate-100 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  {org.logo_url ? (
                    <img
                      src={org.logo_url}
                      alt={org.name}
                      className="w-16 h-16 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-slate-200 flex items-center justify-center">
                      <Building2 className="w-8 h-8 text-slate-600" />
                    </div>
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-900 text-lg truncate">{org.name}</h3>
                    {org.description && (
                      <p className="text-sm text-slate-600 mt-1 line-clamp-2">{org.description}</p>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEdit(org)}
                    className="flex-1"
                  >
                    <Pencil className="w-3 h-3 mr-1" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDelete(org.id)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {organizations.length === 0 && (
          <Card className="p-12 text-center border-slate-100">
            <Building2 className="w-16 h-16 mx-auto text-slate-300 mb-4" />
            <h3 className="text-xl font-semibold text-slate-900 mb-2">No organizations yet</h3>
            <p className="text-slate-600 mb-6">Create your first organization to get started</p>
            <Button onClick={handleAddNew} className="bg-slate-800 hover:bg-slate-900 rounded-full">
              <Plus className="w-4 h-4 mr-2" />
              Add Organization
            </Button>
          </Card>
        )}

        {/* Add/Edit Modal */}
        <Dialog open={showModal} onOpenChange={setShowModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingOrg ? 'Edit Organization' : 'Add New Organization'}
              </DialogTitle>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div>
                <Label htmlFor="org-name">Organization Name *</Label>
                <Input
                  id="org-name"
                  placeholder="Acme Corporation"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="org-logo">Organization Logo</Label>
                <div className="mt-2 space-y-3">
                  {/* Logo Preview */}
                  {formData.logo_url && (
                    <div className="flex items-center gap-4">
                      <img
                        src={formData.logo_url}
                        alt="Logo preview"
                        className="w-16 h-16 rounded-lg object-cover border border-slate-200"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setFormData({ ...formData, logo_url: '' })}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                  
                  {/* Upload Button */}
                  <div className="flex items-center gap-2">
                    <Input
                      id="logo-upload"
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => document.getElementById('logo-upload').click()}
                      disabled={uploading}
                      className="w-full"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {uploading ? 'Uploading...' : 'Upload Logo'}
                    </Button>
                  </div>
                  <p className="text-xs text-slate-500">Upload an image (max 2MB, PNG/JPG)</p>
                </div>
              </div>

              <div>
                <Label htmlFor="org-description">Description</Label>
                <textarea
                  id="org-description"
                  placeholder="Brief description of the organization..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-md text-sm"
                  rows={3}
                />
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowModal(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-slate-800 hover:bg-slate-900"
                >
                  {editingOrg ? 'Update' : 'Create'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default OrganizationsPage;
