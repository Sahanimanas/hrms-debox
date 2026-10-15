import React from 'react';
import { StatusBadge } from '@/components/ds';

const RequestStatusBadge = ({ status }) => <StatusBadge status={status || 'pending'} />;

export default RequestStatusBadge;
