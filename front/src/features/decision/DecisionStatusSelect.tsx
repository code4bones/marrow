import { useMutation } from '@apollo/client/react';
import { Select, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { UPDATE_DECISION_STATUS } from '../../shared/api/queries';

// "superseded" is deliberately not selectable here -- the backend rejects
// setting it directly (see decisions.mixin.ts's updateDecisionStatus):
// that transition only happens as a side effect of decision.supersede,
// paired with the replacement decision and the supersedes link.
function options(t: (key: string) => string) {
  return [
    { label: t('statusDraft'), value: 'draft' },
    { label: t('statusAccepted'), value: 'accepted' },
    { label: t('statusRejected'), value: 'rejected' },
    { label: t('statusArchived'), value: 'archived' },
  ];
}

interface Props {
  id: string;
  value: string;
  onDone?: () => void;
}

export function DecisionStatusSelect({ id, value, onDone }: Props) {
  const { t } = useTranslation('decisions');
  const [mutate, { loading }] = useMutation(UPDATE_DECISION_STATUS, {
    onCompleted: () => { message.success(t('statusUpdated')); onDone?.(); },
    onError: (e) => message.error(e.message),
  });

  // "superseded" itself has no matching option above -- a decision already
  // in that state falls through to antd's own "not a valid option" render,
  // which is fine: it's read-only in practice (the mutation would reject
  // it anyway), same as this component simply not being shown at all would
  // convey.
  return (
    <Select
      value={value}
      size="small"
      loading={loading}
      style={{ minWidth: 130 }}
      options={options(t)}
      onChange={(status) => mutate({ variables: { id, status } })}
    />
  );
}
