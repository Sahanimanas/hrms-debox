import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mail, MessageCircle, Save, Bell, QrCode, Wifi, WifiOff, Loader2, CheckCircle2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import api from '@/lib/api';

const NOTIFICATION_TYPES = [
  { value: 'leave_applied', label: 'Leave Applied', group: 'Leave' },
  { value: 'leave_approved', label: 'Leave Approved', group: 'Leave' },
  { value: 'leave_rejected', label: 'Leave Rejected', group: 'Leave' },
  { value: 'leave_cancelled', label: 'Leave Cancelled', group: 'Leave' },
  { value: 'compoff_applied', label: 'Comp-Off Applied', group: 'Comp-Off' },
  { value: 'compoff_approved', label: 'Comp-Off Approved', group: 'Comp-Off' },
  { value: 'compoff_rejected', label: 'Comp-Off Rejected', group: 'Comp-Off' },
  { value: 'reimbursement_applied', label: 'Reimbursement Applied', group: 'Reimbursement' },
  { value: 'reimbursement_approved', label: 'Reimbursement Approved', group: 'Reimbursement' },
  { value: 'reimbursement_rejected', label: 'Reimbursement Rejected', group: 'Reimbursement' },
  { value: 'reimbursement_cleared', label: 'Reimbursement Cleared', group: 'Reimbursement' },
  { value: 'leave_balance_adjusted', label: 'Leave Balance Adjusted', group: 'Balance' },
];

const NotificationSettingsPage = () => {
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  const [emailConfig, setEmailConfig] = useState({
    smtp_host: '',
    smtp_port: '587',
    smtp_username: '',
    smtp_password: '',
    from_email: '',
    from_name: 'HRMS System',
  });

  const [whatsappConfig, setWhatsappConfig] = useState({
    api_key: '',
    phone_number_id: '',
    business_account_id: '',
  });

  // Baileys state
  const [whatsappProvider, setWhatsappProvider] = useState('twilio');
  const [baileysStatus, setBaileysStatus] = useState('disconnected');
  const [baileysQR, setBaileysQR] = useState(null);
  const [baileysPhone, setBaileysPhone] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [notificationTypes, setNotificationTypes] = useState([]);
  const [testPhone, setTestPhone] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const pollingRef = useRef(null);

  const pollStatus = useCallback(async () => {
    try {
      const response = await api.get('/whatsapp/status');
      const { status, qr, phone } = response.data;
      setBaileysStatus(status);
      setBaileysQR(qr);
      setBaileysPhone(phone);

      if (status === 'connected') {
        setIsPolling(false);
      }
    } catch (error) {
      console.error('Failed to poll WhatsApp status:', error);
    }
  }, []);

  // Polling effect
  useEffect(() => {
    if (isPolling) {
      pollStatus();
      pollingRef.current = setInterval(pollStatus, 3000);
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isPolling, pollStatus]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await api.get('/notification-settings');
        const settings = response.data;

        setEmailEnabled(settings.email_enabled || false);
        setWhatsappEnabled(settings.whatsapp_enabled || false);
        setWhatsappProvider(settings.whatsapp_provider || 'twilio');
        setNotificationTypes(settings.whatsapp_notification_types || []);

        if (settings.smtp_host) {
          setEmailConfig({
            smtp_host: settings.smtp_host || '',
            smtp_port: String(settings.smtp_port || 587),
            smtp_username: settings.smtp_username || '',
            smtp_password: settings.smtp_password || '',
            from_email: settings.from_email || '',
            from_name: settings.from_name || 'HRMS System',
          });
        }

        if (settings.twilio_account_sid) {
          setWhatsappConfig({
            api_key: settings.twilio_account_sid || '',
            phone_number_id: settings.twilio_phone_number || '',
            business_account_id: settings.business_account_id || '',
          });
        }

        // Fetch initial Baileys status
        try {
          const statusRes = await api.get('/whatsapp/status');
          setBaileysStatus(statusRes.data.status);
          setBaileysQR(statusRes.data.qr);
          setBaileysPhone(statusRes.data.phone);
        } catch (e) {
          // Baileys status endpoint may not be available if not connected
        }
      } catch (error) {
        console.error('Failed to load notification settings:', error);
      }
    };

    loadSettings();
  }, []);

  const buildSettingsPayload = () => ({
    email_enabled: emailEnabled,
    whatsapp_enabled: whatsappEnabled,
    smtp_host: emailConfig.smtp_host,
    smtp_port: parseInt(emailConfig.smtp_port),
    smtp_username: emailConfig.smtp_username,
    smtp_password: emailConfig.smtp_password,
    from_email: emailConfig.from_email,
    from_name: emailConfig.from_name,
    twilio_account_sid: whatsappConfig.api_key,
    twilio_auth_token: whatsappConfig.api_key,
    twilio_phone_number: whatsappConfig.phone_number_id,
    whatsapp_provider: whatsappProvider,
    whatsapp_notification_types: notificationTypes,
  });

  const handleSaveEmail = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      if (emailEnabled) {
        if (!emailConfig.smtp_host || !emailConfig.smtp_username || !emailConfig.smtp_password || !emailConfig.from_email) {
          toast.error('Please fill all required SMTP fields');
          setSaving(false);
          return;
        }
      }

      await api.post('/notification-settings', buildSettingsPayload());
      toast.success('Email settings saved successfully!');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save email settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveWhatsApp = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      if (whatsappEnabled && whatsappProvider === 'twilio') {
        if (!whatsappConfig.api_key || !whatsappConfig.phone_number_id) {
          toast.error('Please fill all required Twilio fields');
          setSaving(false);
          return;
        }
      }

      await api.post('/notification-settings', buildSettingsPayload());
      toast.success('WhatsApp settings saved successfully!');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save WhatsApp settings');
    } finally {
      setSaving(false);
    }
  };

  const handleBaileysConnect = async () => {
    try {
      await api.post('/whatsapp/connect');
      setIsPolling(true);
      toast.success('Connecting... Please wait for QR code.');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to connect WhatsApp');
    }
  };

  const handleBaileysDisconnect = async (clearSession = false) => {
    try {
      await api.post('/whatsapp/disconnect', { clear_session: clearSession });
      setBaileysStatus('disconnected');
      setBaileysQR(null);
      setBaileysPhone(null);
      setIsPolling(false);
      toast.success(clearSession ? 'Disconnected and session cleared' : 'Disconnected');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to disconnect');
    }
  };

  const handleSendTest = async () => {
    if (!testPhone.trim()) {
      toast.error('Please enter a phone number');
      return;
    }

    setSendingTest(true);
    try {
      if (whatsappProvider === 'baileys') {
        await api.post('/whatsapp/send-test', { to_phone: testPhone });
      } else {
        await api.post('/notification-settings/test-whatsapp', { to_phone: testPhone });
      }
      toast.success('Test message sent!');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send test message');
    } finally {
      setSendingTest(false);
    }
  };

  const handleToggleNotificationType = (typeValue) => {
    setNotificationTypes(prev =>
      prev.includes(typeValue)
        ? prev.filter(t => t !== typeValue)
        : [...prev, typeValue]
    );
  };

  const handleSelectAll = () => {
    setNotificationTypes(NOTIFICATION_TYPES.map(t => t.value));
  };

  const handleDeselectAll = () => {
    setNotificationTypes([]);
  };

  const renderBaileysSection = () => {
    if (baileysStatus === 'connected') {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
            <div>
              <p className="font-semibold text-green-900">Connected</p>
              {baileysPhone && <p className="text-sm text-green-700">Phone: +{baileysPhone}</p>}
            </div>
            <Badge variant="outline" className="ml-auto border-green-500 text-green-700">Active</Badge>
          </div>

          {/* Test message */}
          <div className="space-y-2">
            <Label htmlFor="test-phone">Send Test Message</Label>
            <div className="flex gap-2">
              <Input
                id="test-phone"
                placeholder="Phone number (e.g. 9876543210)"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
              />
              <Button
                onClick={handleSendTest}
                disabled={sendingTest}
                className="bg-green-600 hover:bg-green-700"
              >
                {sendingTest ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          {/* Disconnect buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => handleBaileysDisconnect(false)}
              className="flex-1"
            >
              <WifiOff className="w-4 h-4 mr-2" />
              Disconnect
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleBaileysDisconnect(true)}
              className="flex-1"
            >
              <WifiOff className="w-4 h-4 mr-2" />
              Disconnect & Clear Session
            </Button>
          </div>
        </div>
      );
    }

    if (baileysStatus === 'qr_ready' && baileysQR) {
      return (
        <div className="space-y-4">
          <div className="flex flex-col items-center p-6 bg-slate-50 border border-slate-200 rounded-lg">
            <QrCode className="w-8 h-8 text-slate-600 mb-2" />
            <p className="text-sm text-slate-600 mb-4 text-center">
              Open WhatsApp on your phone → Linked Devices → Link a Device → Scan this QR code
            </p>
            <img
              src={baileysQR}
              alt="WhatsApp QR Code"
              className="w-64 h-64 border border-slate-300 rounded-lg"
            />
            <p className="text-xs text-slate-500 mt-3">QR code refreshes automatically</p>
          </div>
        </div>
      );
    }

    if (baileysStatus === 'connecting') {
      return (
        <div className="flex items-center justify-center p-8 bg-slate-50 border border-slate-200 rounded-lg">
          <Loader2 className="w-6 h-6 animate-spin text-slate-600 mr-3" />
          <span className="text-slate-600">Connecting to WhatsApp...</span>
        </div>
      );
    }

    // Disconnected
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg">
          <WifiOff className="w-6 h-6 text-slate-400" />
          <div>
            <p className="font-semibold text-slate-700">Not Connected</p>
            <p className="text-sm text-slate-500">Click below to connect your WhatsApp</p>
          </div>
        </div>
        <Button
          onClick={handleBaileysConnect}
          className="w-full bg-green-600 hover:bg-green-700"
        >
          <Wifi className="w-4 h-4 mr-2" />
          Connect WhatsApp
        </Button>
      </div>
    );
  };

  // Group notification types
  const groups = {};
  NOTIFICATION_TYPES.forEach(nt => {
    if (!groups[nt.group]) groups[nt.group] = [];
    groups[nt.group].push(nt);
  });

  return (
    <div className="p-6 md:p-10 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
          Notification Settings
        </h1>
        <p className="text-lg text-slate-600">Configure email and WhatsApp notifications for leave applications</p>
      </div>

      <Tabs defaultValue="email" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="email" className="flex items-center gap-2">
            <Mail className="w-4 h-4" />
            Email (SMTP)
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4" />
            WhatsApp
          </TabsTrigger>
        </TabsList>

        {/* Email Configuration */}
        <TabsContent value="email">
          <Card className="border-slate-100 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-2xl font-semibold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
                  <Mail className="w-6 h-6" />
                  Email Notifications
                </span>
                <div className="flex items-center gap-2">
                  <Label htmlFor="email-toggle" className="text-sm text-slate-600">Enable</Label>
                  <Switch
                    id="email-toggle"
                    checked={emailEnabled}
                    onCheckedChange={setEmailEnabled}
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveEmail} className="space-y-4">
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 mb-4">
                  <p className="text-sm text-amber-900">
                    <strong>When enabled:</strong> Automatic emails will be sent when employees apply for leave and when managers/admins approve or reject leaves.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="smtp-host">SMTP Host *</Label>
                    <Input
                      id="smtp-host"
                      placeholder="smtp.gmail.com"
                      value={emailConfig.smtp_host}
                      onChange={(e) => setEmailConfig({ ...emailConfig, smtp_host: e.target.value })}
                      disabled={!emailEnabled}
                      className="mt-1"
                    />
                    <p className="text-xs text-slate-500 mt-1">Gmail: smtp.gmail.com | Mailjet: in-v3.mailjet.com | Office365: smtp.office365.com</p>
                  </div>
                  <div>
                    <Label htmlFor="smtp-port">SMTP Port *</Label>
                    <Input
                      id="smtp-port"
                      placeholder="587"
                      value={emailConfig.smtp_port}
                      onChange={(e) => setEmailConfig({ ...emailConfig, smtp_port: e.target.value })}
                      disabled={!emailEnabled}
                      className="mt-1"
                    />
                    <p className="text-xs text-slate-500 mt-1">Usually 587 for TLS or 465 for SSL</p>
                  </div>
                </div>

                <div>
                  <Label htmlFor="smtp-username">SMTP Username / API Key *</Label>
                  <Input
                    id="smtp-username"
                    type="text"
                    placeholder="your-email@gmail.com or API key"
                    value={emailConfig.smtp_username}
                    onChange={(e) => setEmailConfig({ ...emailConfig, smtp_username: e.target.value })}
                    disabled={!emailEnabled}
                    className="mt-1"
                  />
                  <p className="text-xs text-slate-500 mt-1">For Mailjet: Use API Key here</p>
                </div>

                <div>
                  <Label htmlFor="smtp-password">SMTP Password / Secret Key *</Label>
                  <Input
                    id="smtp-password"
                    type="password"
                    placeholder="••••••••••••••••"
                    value={emailConfig.smtp_password}
                    onChange={(e) => setEmailConfig({ ...emailConfig, smtp_password: e.target.value })}
                    disabled={!emailEnabled}
                    className="mt-1"
                  />
                  <p className="text-xs text-slate-500 mt-1">Gmail: App Password | Mailjet: Secret Key</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="from-email">From Email *</Label>
                    <Input
                      id="from-email"
                      type="email"
                      placeholder="noreply@company.com"
                      value={emailConfig.from_email}
                      onChange={(e) => setEmailConfig({ ...emailConfig, from_email: e.target.value })}
                      disabled={!emailEnabled}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="from-name">From Name</Label>
                    <Input
                      id="from-name"
                      placeholder="HRMS System"
                      value={emailConfig.from_name}
                      onChange={(e) => setEmailConfig({ ...emailConfig, from_name: e.target.value })}
                      disabled={!emailEnabled}
                      className="mt-1"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200">
                  <Button
                    type="submit"
                    className="w-full bg-slate-800 hover:bg-slate-900 rounded-full"
                    disabled={saving}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {saving ? 'Saving...' : 'Save Email Settings'}
                  </Button>
                </div>
              </form>

              {/* Setup Guides */}
              <div className="mt-6 space-y-4">
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <h4 className="font-semibold text-slate-900 mb-2">Gmail Setup:</h4>
                  <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside">
                    <li>Go to Google Account → Security → 2-Step Verification</li>
                    <li>Scroll to "App passwords" and create one</li>
                    <li>Host: smtp.gmail.com | Port: 587 | Username: Your Gmail</li>
                  </ol>
                </div>

                <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
                  <h4 className="font-semibold text-emerald-900 mb-2">Mailjet Setup:</h4>
                  <ol className="text-sm text-emerald-800 space-y-1 list-decimal list-inside">
                    <li>Sign up at mailjet.com and verify your sender email</li>
                    <li>Go to Account Settings → SMTP & Send API Settings</li>
                    <li>Host: in-v3.mailjet.com | Port: 587</li>
                    <li>Username: Your API Key | Password: Your Secret Key</li>
                    <li>From Email: Your verified sender email</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* WhatsApp Configuration */}
        <TabsContent value="whatsapp">
          <Card className="border-slate-100 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-2xl font-semibold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
                  <MessageCircle className="w-6 h-6" />
                  WhatsApp Notifications
                </span>
                <div className="flex items-center gap-2">
                  <Label htmlFor="whatsapp-toggle" className="text-sm text-slate-600">Enable</Label>
                  <Switch
                    id="whatsapp-toggle"
                    checked={whatsappEnabled}
                    onCheckedChange={setWhatsappEnabled}
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveWhatsApp} className="space-y-6">
                <div className="bg-green-50 border border-green-100 rounded-lg p-4">
                  <p className="text-sm text-green-900">
                    <strong>When enabled:</strong> WhatsApp messages will be sent to managers and employees for leave applications and approvals.
                  </p>
                </div>

                {/* Provider Selection */}
                <div className="space-y-3">
                  <Label className="text-base font-semibold">WhatsApp Provider</Label>
                  <RadioGroup
                    value={whatsappProvider}
                    onValueChange={setWhatsappProvider}
                    className="space-y-3"
                    disabled={!whatsappEnabled}
                  >
                    <div className={`flex items-start space-x-3 p-4 border rounded-lg transition-colors ${whatsappProvider === 'twilio' ? 'border-amber-300 bg-amber-50/50' : 'border-slate-200'} ${!whatsappEnabled ? 'opacity-50' : ''}`}>
                      <RadioGroupItem value="twilio" id="provider-twilio" disabled={!whatsappEnabled} />
                      <div className="flex-1">
                        <Label htmlFor="provider-twilio" className="font-semibold text-slate-900 cursor-pointer">
                          Twilio API (Cloud)
                        </Label>
                        <p className="text-sm text-slate-500 mt-0.5">
                          Use Twilio's WhatsApp Business API. Requires a paid Twilio account and approved templates.
                        </p>
                      </div>
                    </div>
                    <div className={`flex items-start space-x-3 p-4 border rounded-lg transition-colors ${whatsappProvider === 'baileys' ? 'border-green-300 bg-green-50/50' : 'border-slate-200'} ${!whatsappEnabled ? 'opacity-50' : ''}`}>
                      <RadioGroupItem value="baileys" id="provider-baileys" disabled={!whatsappEnabled} />
                      <div className="flex-1">
                        <Label htmlFor="provider-baileys" className="font-semibold text-slate-900 cursor-pointer">
                          QR Code (Baileys - Direct)
                        </Label>
                        <p className="text-sm text-slate-500 mt-0.5">
                          Free! Link your own WhatsApp by scanning a QR code. Messages sent directly from your number.
                        </p>
                      </div>
                    </div>
                  </RadioGroup>
                </div>

                {/* Twilio Config */}
                {whatsappProvider === 'twilio' && (
                  <div className="space-y-4 pt-2">
                    <div>
                      <Label htmlFor="whatsapp-api-key">Twilio Account SID *</Label>
                      <Input
                        id="whatsapp-api-key"
                        type="password"
                        placeholder="Enter your Twilio Account SID"
                        value={whatsappConfig.api_key}
                        onChange={(e) => setWhatsappConfig({ ...whatsappConfig, api_key: e.target.value })}
                        disabled={!whatsappEnabled}
                        className="mt-1"
                      />
                    </div>

                    <div>
                      <Label htmlFor="phone-number-id">Twilio Phone Number *</Label>
                      <Input
                        id="phone-number-id"
                        placeholder="Your Twilio WhatsApp phone number"
                        value={whatsappConfig.phone_number_id}
                        onChange={(e) => setWhatsappConfig({ ...whatsappConfig, phone_number_id: e.target.value })}
                        disabled={!whatsappEnabled}
                        className="mt-1"
                      />
                    </div>

                    {/* Twilio Setup Guide */}
                    <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                      <h4 className="font-semibold text-slate-900 mb-2">Twilio WhatsApp Setup:</h4>
                      <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside">
                        <li>Sign up at twilio.com and get your Account SID</li>
                        <li>Enable WhatsApp Sandbox or register a WhatsApp Business number</li>
                        <li>Enter your Account SID and phone number above</li>
                      </ol>
                    </div>
                  </div>
                )}

                {/* Baileys Connection */}
                {whatsappProvider === 'baileys' && whatsappEnabled && (
                  <div className="space-y-4 pt-2">
                    <div className="border border-slate-200 rounded-lg p-4">
                      <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                        <QrCode className="w-5 h-5" />
                        WhatsApp Connection
                      </h4>
                      {renderBaileysSection()}
                    </div>
                  </div>
                )}

                {/* Save Button */}
                <div className="pt-4 border-t border-slate-200">
                  <Button
                    type="submit"
                    className="w-full bg-slate-800 hover:bg-slate-900 rounded-full"
                    disabled={saving}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {saving ? 'Saving...' : 'Save WhatsApp Settings'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Notification Triggers */}
          {whatsappEnabled && (
            <Card className="border-slate-100 shadow-sm mt-6">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xl font-semibold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
                    <Bell className="w-5 h-5" />
                    WhatsApp Notification Triggers
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleSelectAll}>
                      Select All
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDeselectAll}>
                      Deselect All
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-500 mb-4">
                  Choose which events should trigger WhatsApp messages. If none are selected, all events will trigger messages.
                </p>

                <div className="space-y-6">
                  {Object.entries(groups).map(([group, types]) => (
                    <div key={group}>
                      <h5 className="text-sm font-semibold text-slate-700 mb-2 uppercase tracking-wider">{group}</h5>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {types.map(nt => (
                          <label
                            key={nt.value}
                            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                              notificationTypes.includes(nt.value)
                                ? 'border-green-300 bg-green-50'
                                : 'border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <Checkbox
                              checked={notificationTypes.includes(nt.value)}
                              onCheckedChange={() => handleToggleNotificationType(nt.value)}
                            />
                            <span className="text-sm text-slate-900">{nt.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-4 mt-4 border-t border-slate-200">
                  <Button
                    onClick={async () => {
                      setSaving(true);
                      try {
                        await api.post('/notification-settings', buildSettingsPayload());
                        toast.success('Notification triggers saved!');
                      } catch (error) {
                        toast.error(error.response?.data?.detail || 'Failed to save');
                      } finally {
                        setSaving(false);
                      }
                    }}
                    className="w-full bg-slate-800 hover:bg-slate-900 rounded-full"
                    disabled={saving}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {saving ? 'Saving...' : 'Save Notification Triggers'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Notification Events */}
      <Card className="border-slate-100 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl font-semibold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            <Bell className="w-6 h-6" />
            Notification Events
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <span className="text-slate-900">When employee applies for leave</span>
              <span className="text-sm text-emerald-600 font-medium">→ Notify Manager</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <span className="text-slate-900">When manager approves leave</span>
              <span className="text-sm text-emerald-600 font-medium">→ Notify Admin & Employee</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <span className="text-slate-900">When admin approves leave (final)</span>
              <span className="text-sm text-emerald-600 font-medium">→ Notify Employee</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <span className="text-slate-900">When leave is rejected</span>
              <span className="text-sm text-emerald-600 font-medium">→ Notify Employee</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default NotificationSettingsPage;
