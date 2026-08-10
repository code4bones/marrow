import { useMutation } from '@apollo/client/react';
import { Select, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { UPDATE_MEMORY } from '../../shared/api/queries';

function options(t: (key: string) => string) {
  return [
    { label: t('statusCurrent'), value: 'current' },
    { label: t('statusDraft'), value: 'draft' },
    { label: t('statusArchived'), value: 'archived' },
    { label: t('statusSuperseded'), value: 'superseded' },
    { label: t('statusRejected'), value: 'rejected' },
  ];
}

interface Props {
  id: string;
  value: string;
  onDone?: () => void;
}

export function MemoryStatusSelect({ id, value, onDone }: Props) {
  const { t } = useTranslation('memory');
  const [mutate, { loading }] = useMutation(UPDATE_MEMORY, {
    onCompleted: () => { message.success(t('statusUpdated')); onDone?.(); },
    onError: (e) => message.error(e.message),
  });

  return (
    <Select
      value={value}
      size="small"
      loading={loading}
      style={{ minWidth: 130 }}
      options={options(t)}
      onChange={(status) => mutate({ variables: { input: { id, status } } })}
    />
  );
}
