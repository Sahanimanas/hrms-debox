import React, { useState } from 'react';
import { ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import api from '@/lib/api';

/**
 * "Scan receipt" — sends the selected receipt file to the OCR endpoint and
 * calls onResult({ amount, date, vendor, suggested_category }) with whatever was
 * read. When scanning isn't configured, tells the user to enter details manually.
 */
export default function ReceiptScanButton({ file, onResult, className = '' }) {
  const [scanning, setScanning] = useState(false);

  const scan = async () => {
    if (!file) {
      toast.error('Attach a receipt first');
      return;
    }
    setScanning(true);
    try {
      const form = new FormData();
      form.append('receipt', file);
      const { data } = await api.post('/v2/assets/receipts/scan', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (!data.configured) {
        toast.info(data.detail || 'Receipt scanning is not set up — please fill in the details manually');
        return;
      }
      if (data.is_receipt === false) {
        toast.warning("That file doesn't look like a receipt — please check the details");
      }
      const found = ['amount', 'date', 'vendor', 'suggested_category'].filter(k => data[k]);
      if (!found.length) {
        toast.warning('Could not read any details from the receipt');
        return;
      }
      onResult(data);
      toast.success(`Filled from receipt${data.confidence === 'low' ? ' (low confidence — please double-check)' : ''}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Receipt scanning failed — please enter the details manually');
    } finally {
      setScanning(false);
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={scan} disabled={scanning || !file} className={`gap-1.5 text-xs ${className}`}>
      <ScanLine className="w-3.5 h-3.5" />
      {scanning ? 'Scanning…' : 'Scan receipt'}
    </Button>
  );
}
