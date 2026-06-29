import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PublicCOAVerifier from './PublicCOAVerifier';

export default function PublicCOAVerifierPage() {
  const { coaId = '' } = useParams();
  const navigate = useNavigate();

  return (
    <PublicCOAVerifier
      coaId={coaId}
      onBackToApp={() => navigate('/login')}
    />
  );
}
